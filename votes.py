"""Download and parse every recorded roll-call vote from the official House and Senate sources.

House:  https://clerk.house.gov/evs/<year>/roll<NNN>.xml
Senate: https://www.senate.gov/legislative/LIS/roll_call_votes/vote<C><S>/vote_<C>_<S>_<NNNNN>.xml

Parsed votes are cached in data/rolls/ so each run only downloads what is new.
"""
import datetime
import os
import re
import xml.etree.ElementTree as ET

from common import CACHE, NotFound, fetch, read_json, write_json

CODE = {"yea": "Y", "aye": "Y", "nay": "N", "no": "N", "not voting": "X"}


def vote_code(text):
    t = (text or "").strip().lower()
    if t in CODE:
        return CODE[t]
    if t.startswith("present"):
        return "P"
    return "O"  # any other response (e.g. a name in a Speaker election, "Guilty") still counts as voting


def _int(el):
    try:
        return int((el.text or "").strip())
    except (AttributeError, ValueError):
        return None


class BadDocument(Exception):
    """The server answered, but not with the vote record we asked for."""


def _snippet(data):
    return data[:300].decode("utf-8", "replace").replace("\n", " ").strip()


def xml_root(data, expected):
    if data[:2] == b"\x1f\x8b":  # gzip-compressed response
        import gzip
        data = gzip.decompress(data)
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise BadDocument("not XML: " + _snippet(data))
    for el in root.iter():  # ignore XML namespaces if the publisher adds them
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    if root.tag != expected:
        raise BadDocument(f"expected <{expected}>, got <{root.tag}>: " + _snippet(data))
    return root


def _text(root, path):
    el = root.find(path)
    return re.sub(r"\s+", " ", (el.text or "")).strip() if el is not None and el.text else ""


# ---------------- House ----------------

def parse_house(xml_bytes):
    try:
        return _parse_house(xml_bytes)
    except (ValueError, AttributeError, TypeError) as e:
        raise BadDocument(f"unreadable House record ({e}): " + _snippet(xml_bytes))


def _parse_house(xml_bytes):
    root = xml_root(xml_bytes, "rollcall-vote")
    meta = root.find("vote-metadata")
    if meta is None:
        raise BadDocument("no <vote-metadata>: " + _snippet(xml_bytes))
    congress = int(_text(meta, "congress"))
    session = int(re.sub(r"\D", "", _text(meta, "session")) or 0)
    roll = int(_text(meta, "rollcall-num"))
    date = datetime.datetime.strptime(_text(meta, "action-date"), "%d-%b-%Y").date().isoformat()
    tot = meta.find("vote-totals/totals-by-vote")
    totals = None
    if tot is not None:
        totals = {
            "yea": _int(tot.find("yea-total")),
            "nay": _int(tot.find("nay-total")),
            "present": _int(tot.find("present-total")),
            "nv": _int(tot.find("not-voting-total")),
        }
    votes, speaker, names = {}, None, {}
    for rv in root.iter("recorded-vote"):
        leg = rv.find("legislator")
        bid = leg.get("name-id")
        votes[bid] = vote_code(_text(rv, "vote"))
        names[bid] = leg.get("unaccented-name") or (leg.text or "").strip()
        if (leg.get("role") or "").lower() == "speaker":
            speaker = bid
    year = int(date[:4])
    rec = {
        "id": f"H-{congress}-{session}-{roll}",
        "ch": "House",
        "congress": congress,
        "session": session,
        "roll": roll,
        "date": date,
        "question": _text(meta, "vote-question"),
        "title": _text(meta, "vote-desc") or _text(meta, "legis-num"),
        "bill": _text(meta, "legis-num"),
        "result": _text(meta, "vote-result"),
        "totals": totals,
        "votes": votes,
        "url": f"https://clerk.house.gov/Votes/{year}{roll}",
    }
    if speaker:
        rec["speaker"] = speaker
    return rec, names


def update_house(cfg, members_by_id, log=print):
    new = 0
    for s in cfg["sessions"]:
        path = os.path.join(CACHE, "rolls", f"H-{cfg['congress']}-{s['session']}.json")
        cache = read_json(path, {"rolls": {}})
        n = max([int(k) for k in cache["rolls"]] or [0]) + 1
        misses, first_bad = 0, None
        while misses < 2:  # stop after two missing roll numbers in a row
            url = f"https://clerk.house.gov/evs/{s['year']}/roll{n:03d}.xml"
            try:
                rec, _ = parse_house(fetch(url))
            except (NotFound, BadDocument) as e:
                # The Clerk answers a not-yet-existing roll number with an error page, so a bad
                # document after the last real vote is normal. One on the very first roll is not.
                if isinstance(e, BadDocument) and first_bad is None:
                    first_bad = f"{url} -> {e}"
                misses += 1
                n += 1
                continue
            misses = 0
            if rec["congress"] != cfg["congress"]:
                log(f"  skipping House {s['year']} roll {n}: belongs to Congress {rec['congress']}")
            else:
                cache["rolls"][str(rec["roll"])] = rec
                new += 1
            n += 1
        if not cache["rolls"] and first_bad:
            raise RuntimeError("The House Clerk did not return vote data. First response: " + first_bad)
        write_json(path, cache)
    log(f"House: {new} new roll calls")
    return new


# ---------------- Senate ----------------

def parse_senate(xml_bytes, lis_to_bioguide):
    try:
        return _parse_senate(xml_bytes, lis_to_bioguide)
    except (ValueError, AttributeError, TypeError) as e:
        raise BadDocument(f"unreadable Senate record ({e}): " + _snippet(xml_bytes))


def _parse_senate(xml_bytes, lis_to_bioguide):
    root = xml_root(xml_bytes, "roll_call_vote")
    congress = int(_text(root, "congress"))
    session = int(_text(root, "session"))
    roll = int(_text(root, "vote_number"))
    m = re.search(r"([A-Za-z]+ \d{1,2}, \d{4})", _text(root, "vote_date"))
    date = datetime.datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
    cnt = root.find("count")
    totals = None
    if cnt is not None:
        totals = {
            "yea": _int(cnt.find("yeas")) or 0,
            "nay": _int(cnt.find("nays")) or 0,
            "present": _int(cnt.find("present")) or 0,
            "nv": _int(cnt.find("absent")) or 0,
        }
    votes, unknown = {}, []
    for mem in root.iter("member"):
        lis = _text(mem, "lis_member_id")
        bid = lis_to_bioguide.get(lis)
        if not bid:
            unknown.append(f"{lis} {_text(mem, 'member_full')}")
            bid = "lis:" + lis
        votes[bid] = vote_code(_text(mem, "vote_cast"))
    rec = {
        "id": f"S-{congress}-{session}-{roll}",
        "ch": "Senate",
        "congress": congress,
        "session": session,
        "roll": roll,
        "date": date,
        "question": _text(root, "vote_question_text") or _text(root, "question"),
        "title": _text(root, "vote_title") or _text(root, "vote_document_text"),
        "bill": _text(root, "document/document_name"),
        "result": _text(root, "vote_result") or _text(root, "vote_result_text"),
        "totals": totals,
        "tieBreaker": bool(_text(root, "tie_breaker/by_whom")),
        "votes": votes,
        "url": f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{roll:05d}.htm",
    }
    return rec, unknown


def senate_menu(congress, session):
    url = f"https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml"
    data = fetch(url)
    try:
        root = xml_root(data, "vote_summary")
    except BadDocument as e:
        raise RuntimeError(f"The Senate did not return its vote list ({url}): {e}")
    out = {}
    for v in root.iter("vote"):
        n = int(_text(v, "vote_number"))
        out[n] = {"yea": _int(v.find("vote_tally/yeas")), "nay": _int(v.find("vote_tally/nays"))}
    return out


def update_senate(cfg, lis_to_bioguide, log=print):
    new, problems = 0, []
    c = cfg["congress"]
    for s in cfg["sessions"]:
        path = os.path.join(CACHE, "rolls", f"S-{c}-{s['session']}.json")
        cache = read_json(path, {"rolls": {}})
        try:
            menu = senate_menu(c, s["session"])
        except NotFound:
            log(f"  Senate session {s['session']} has no vote list yet")
            continue
        try:
            for n in sorted(menu):
                if str(n) in cache["rolls"]:
                    continue
                url = f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{c}{s['session']}/vote_{c}_{s['session']}_{n:05d}.xml"
                try:
                    rec, unknown = parse_senate(fetch(url), lis_to_bioguide)
                except BadDocument as e:
                    raise RuntimeError(f"The Senate did not return vote data ({url}): {e}")
                rec["menuTally"] = menu[n]
                if unknown:
                    problems.append(f"{rec['id']}: unknown senators {unknown}")
                cache["rolls"][str(n)] = rec
                new += 1
        finally:
            write_json(path, cache)  # keep whatever was downloaded before any failure
    log(f"Senate: {new} new roll calls")
    for p in problems:
        log("WARNING " + p)
    return new


def load_all_rolls(cfg):
    rolls = {}
    for ch in ("H", "S"):
        for s in cfg["sessions"]:
            data = read_json(os.path.join(CACHE, "rolls", f"{ch}-{cfg['congress']}-{s['session']}.json"), {"rolls": {}})
            for rec in data["rolls"].values():
                rolls[rec["id"]] = rec
    return rolls


def load_manual_senate(curated_dir, lis_to_bioguide, rolls):
    """Key Senate votes transcribed from senate.gov by the WeHold editor, used while senate.gov
    blocks automated downloads. Official downloaded records always take precedence. These cover
    only highlighted votes, so they are marked "manual" and left out of attendance figures."""
    added, problems = 0, []
    # Files may sit in curated/senate/, curated/, or the repo's top level (where web uploads land).
    paths = {}
    for d in (os.path.dirname(curated_dir), curated_dir, os.path.join(curated_dir, "senate")):
        if os.path.isdir(d):
            for name in os.listdir(d):
                if re.fullmatch(r"S-\d+-\d+-\d+\.json", name):
                    paths[name] = os.path.join(d, name)  # later folders win
    for name in sorted(paths):
        rec = read_json(paths[name])
        if rec["id"] in rolls:
            continue
        votes = {}
        for lis, code in rec.pop("votesByLis").items():
            bid = lis_to_bioguide.get(lis)
            if not bid:
                problems.append(f"{rec['id']}: unknown senator {lis}")
                bid = "lis:" + lis
            votes[bid] = code
        rec["votes"] = votes
        rolls[rec["id"]] = rec
        added += 1
    return added, problems
