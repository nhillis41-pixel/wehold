"""WeHold Plus "Bill breakdown": official facts for every bill WeHold highlights, from Congress.gov.

    CONGRESS_API_KEY=... python pipeline/bills.py            # (falls back to FEC_API_KEY: both are api.data.gov keys)
    python pipeline/bills.py --offline                         # rebuild only the roll-call part from data/rolls

Writes site/data/bills/<key>.json (key like "119-hr-2347") and site/data/bills/index.json.
Each file holds: title, sponsor, status, the official Congressional Research Service summary, Congressional
Budget Office cost estimates, text versions, amendments, the bill's path (major actions), and every recorded
roll call on the bill in either chamber with each member's position.

The plain-English, section-by-section write-up and both sides' arguments are editorial and live in
site/bills/<key>.json, written by WeHold's daily task (see README).
"""
import argparse
import datetime
import glob
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE, CURATED, SITE_DATA, load_config, read_json, write_json  # noqa: E402

API = "https://api.congress.gov/v3/"
OUT = os.path.join(SITE_DATA, "bills")
TYPES = {"HR": "hr", "S": "s", "HRES": "hres", "SRES": "sres", "HJRES": "hjres", "SJRES": "sjres", "HCONRES": "hconres", "SCONRES": "sconres"}
URLTYPE = {"hr": "house-bill", "s": "senate-bill", "hres": "house-resolution", "sres": "senate-resolution", "hjres": "house-joint-resolution",
           "sjres": "senate-joint-resolution", "hconres": "house-concurrent-resolution", "sconres": "senate-concurrent-resolution"}
LABEL = {"hr": "H.R.", "s": "S.", "hres": "H.Res.", "sres": "S.Res.", "hjres": "H.J.Res.", "sjres": "S.J.Res.", "hconres": "H.Con.Res.", "sconres": "S.Con.Res."}
# Actions worth showing on the bill's path (Library of Congress action types).
PATH_TYPES = {"IntroReferral", "Committee", "Calendars", "Floor", "Discharge", "ResolvingDifferences", "President", "BecameLaw", "Veto", "NotUsed"}


def parse_bill(label):
    """'H.R. 2347', 'H R 2347', 'H.Con.Res. 89', 'S.J.Res. 55' -> ('hr', 2347). None for nominations etc."""
    s = re.sub(r"[\s.]", "", str(label or "")).upper()
    m = re.fullmatch(r"([A-Z]+?)(\d+)", s)
    if not m or m.group(1) not in TYPES:
        return None
    return TYPES[m.group(1)], int(m.group(2))


def key_of(congress, t, n):
    return f"{congress}-{t}-{n}"


def clean_html(s):
    """CRS summaries come as simple HTML. Keep paragraphs and list items as plain text blocks."""
    s = re.sub(r"(?i)<\s*(br|/p|/li|/h\d)\s*/?>", "\n", s or "")
    s = re.sub(r"(?i)<\s*li[^>]*>", "• ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return [p.strip() for p in re.split(r"\n\s*\n|\n", s) if p.strip()]


class Congress:
    def __init__(self, key, pace=0.8, opener=None):
        self.key, self.pace, self.last, self.calls = key, pace, 0.0, 0
        self.opener = opener or (lambda url: urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "WeHold civic data bot/1.0 (+https://weholdllc.com)", "Accept": "application/json"}), timeout=60).read())

    def get(self, path, **params):
        params.update(api_key=self.key, format="json")
        url = API + path + "?" + urllib.parse.urlencode(params)
        for attempt in range(5):
            wait = self.pace - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.calls += 1
            try:
                return json.loads(self.opener(url))
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return {}
                if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(10 * (attempt + 1))
                    continue
                raise
        return {}


def rolls_for(congress, t, n):
    """Every recorded vote on this bill in either chamber, from WeHold's own roll-call data."""
    out = []
    for f in sorted(glob.glob(os.path.join(CACHE, "rolls", f"*-{congress}-*.json"))):
        R = (read_json(f, {}) or {}).get("rolls") or {}
        for r in (R.values() if isinstance(R, dict) else R):
            if parse_bill(r.get("bill")) == (t, n):
                out.append({"id": r["id"], "ch": r.get("ch"), "date": r.get("date"), "roll": r.get("roll"), "question": r.get("question"),
                            "result": r.get("result"), "title": r.get("title"), "totals": r.get("totals"), "url": r.get("url"),
                            "pos": r.get("votes") or {}})
    out.sort(key=lambda r: (r["date"] or "", r["ch"] or "", r["roll"] or 0))
    return out


def fetch_bill(api, congress, t, n):
    b = (api.get(f"bill/{congress}/{t}/{n}") or {}).get("bill") or {}
    if not b:
        return None
    acts = (api.get(f"bill/{congress}/{t}/{n}/actions", limit=250) or {}).get("actions") or []
    sums = (api.get(f"bill/{congress}/{t}/{n}/summaries", limit=50) or {}).get("summaries") or []
    texts = (api.get(f"bill/{congress}/{t}/{n}/text", limit=50) or {}).get("textVersions") or []
    amends = []
    if ((b.get("amendments") or {}).get("count") or 0) > 0:
        amends = (api.get(f"bill/{congress}/{t}/{n}/amendments", limit=250) or {}).get("amendments") or []

    # The path: major actions, oldest first, one line per distinct step.
    seen, path = set(), []
    for a in sorted(acts, key=lambda a: (a.get("actionDate") or "", a.get("actionTime") or "")):
        if a.get("type") not in PATH_TYPES:
            continue
        txt = re.sub(r"\s+", " ", a.get("text") or "").strip()
        sig = (a.get("actionDate"), txt[:80].lower())
        if not txt or sig in seen:
            continue
        seen.add(sig)
        votes = [{"chamber": v.get("chamber"), "roll": v.get("rollNumber"), "date": (v.get("date") or "")[:10]} for v in a.get("recordedVotes") or []]
        path.append({"date": a.get("actionDate"), "text": txt, "type": a.get("type"), **({"votes": votes} if votes else {})})

    summary = None
    if sums:
        s = sorted(sums, key=lambda s: (s.get("actionDate") or "", s.get("updateDate") or ""))[-1]
        summary = {"version": s.get("actionDesc"), "date": s.get("actionDate"), "paras": clean_html(s.get("text"))}

    sp = (b.get("sponsors") or [{}])[0]
    out = {
        "congress": congress, "type": t, "number": n, "label": f"{LABEL[t]} {n}",
        "title": b.get("title"), "introduced": b.get("introducedDate"),
        "policyArea": (b.get("policyArea") or {}).get("name"),
        "sponsor": {"name": sp.get("fullName"), "party": sp.get("party"), "state": sp.get("state"), "bioguide": sp.get("bioguideId")} if sp else None,
        "cosponsors": (b.get("cosponsors") or {}).get("count") or 0,
        "latest": {"date": (b.get("latestAction") or {}).get("actionDate"), "text": (b.get("latestAction") or {}).get("text")},
        "laws": [{"type": l.get("type"), "number": l.get("number")} for l in b.get("laws") or []],
        "cbo": [{"title": c.get("title"), "date": (c.get("pubDate") or "")[:10], "url": c.get("url"), "about": " ".join(clean_html(c.get("description")))} for c in b.get("cboCostEstimates") or []],
        "summary": summary,
        "texts": [{"type": x.get("type"), "date": (x.get("date") or "")[:10], "url": next((f.get("url") for f in x.get("formats") or [] if f.get("type") == "Formatted Text"), None) or next((f.get("url") for f in x.get("formats") or []), None)} for x in texts][:12],
        "amendments": [{"label": f'{(a.get("type") or "").upper()} {a.get("number")}', "purpose": re.sub(r"\s+", " ", a.get("purpose") or a.get("description") or "").strip(), "latest": (a.get("latestAction") or {}).get("text")} for a in amends][:60],
        "amendmentCount": (b.get("amendments") or {}).get("count") or 0,
        "path": path[-60:],
        "url": f"https://www.congress.gov/bill/{congress}th-congress/{URLTYPE[t]}/{n}",
    }
    return out


def highlighted_bills(congress):
    cur = read_json(os.path.join(CURATED, "votes.json"), {}) or {}
    seen = []
    for v in cur.get("votes", []):
        p = parse_bill((v.get("bill") or {}).get("label"))
        if p and p not in seen:
            seen.append(p)
    return seen


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="only refresh roll calls from data/rolls")
    ap.add_argument("--only", nargs="*", help="bill labels, e.g. 'H.R. 2347'")
    a = ap.parse_args(argv)
    cfg = load_config()
    congress = cfg["congress"]
    key = os.environ.get("CONGRESS_API_KEY") or os.environ.get("FEC_API_KEY")
    bills = [parse_bill(x) for x in a.only] if a.only else highlighted_bills(congress)
    bills = [b for b in bills if b]
    api = Congress(key) if key and not a.offline else None
    os.makedirs(OUT, exist_ok=True)
    index = read_json(os.path.join(OUT, "index.json"), {}) or {}
    done = failed = 0
    for t, n in bills:
        k = key_of(congress, t, n)
        path = os.path.join(OUT, k + ".json")
        rec = read_json(path, None)
        try:
            if api:
                fresh = fetch_bill(api, congress, t, n)
                if fresh:
                    rec = fresh
            if not rec:
                rec = {"congress": congress, "type": t, "number": n, "label": f"{LABEL[t]} {n}", "url": None}
            rec["key"] = k
            rec["rolls"] = rolls_for(congress, t, n)
            rec["checked"] = datetime.date.today().isoformat()
        except Exception as e:  # one bill's problem never blocks the rest
            failed += 1
            print(f"  {k}: {e}")
            continue
        write_json(path, rec)
        ed = read_json(os.path.join(os.path.dirname(SITE_DATA), "bills", k + ".json"), None) or {}
        index[k] = {"label": rec.get("label"), "title": ed.get("title") or rec.get("title"), "plain": bool(ed.get("sections")), "latest": (rec.get("latest") or {}).get("date"), "rolls": len(rec["rolls"])}
        done += 1
    write_json(os.path.join(OUT, "index.json"), index)
    print(f"Bills: refreshed {done} ({failed} failed){f', {api.calls} Congress.gov requests' if api else ''}.")
    return 1 if failed and not done else 0


if __name__ == "__main__":
    sys.exit(main())
