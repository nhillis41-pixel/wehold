"""WeHold Plus "Follow the money": campaign finance facts for every member of Congress, from the FEC.

    FEC_API_KEY=... python pipeline/money.py              # refresh members whose data is oldest (rate-limited)
    FEC_API_KEY=... python pipeline/money.py --only B001323 C001035

Writes site/data/money/<bioguide>.json per member and site/data/money/index.json.
FEC rule: names of individual donors may not be used for selling or soliciting, so WeHold keeps none.
Only totals, size brackets, states, donor employers (aggregated) and PAC (committee) names are stored.

Rate: the FEC allows 1,000 requests an hour per key. Each run spends at most --budget requests, pacing
itself, and refreshes the members whose data is oldest, so all members are covered every week or so.
"""
import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yaml  # noqa: E402

from common import ROOT, SITE_DATA, load_config, read_json, write_json  # noqa: E402
from members import legislators_dir  # noqa: E402

API = "https://api.open.fec.gov/v1/"
OUT = os.path.join(SITE_DATA, "money")
COMMITTEE_CACHE = os.path.join(ROOT, "data", "fec_committees.json")
PAC_PAGES = 10          # up to 1,000 PAC contributions per member per cycle
PACE = 3.7              # seconds between requests (keeps under 1,000/hour)

# How the FEC describes the PAC that gave, in plain words. Facts from the PAC's own registration.
KIND = {
    "leadership": "Leadership PACs (run by other politicians)",
    "C": "Corporate PACs", "W": "Corporate PACs",
    "L": "Labor union PACs",
    "T": "Trade association PACs",
    "M": "Membership group PACs",
    "V": "Cooperative PACs",
    "nonconnected": "Independent and issue PACs",
    "other": "Other committees",
}


class Budget(Exception):
    pass


class FEC:
    def __init__(self, key, budget, pace=PACE, opener=None):
        self.key, self.left, self.pace, self.last = key, budget, pace, 0.0
        self.opener = opener or (lambda url: urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "WeHold civic data bot/1.0 (+https://weholdllc.com)"}), timeout=60).read())
        self.calls = 0

    def get(self, path, **params):
        if self.left <= 0:
            raise Budget()
        q = [("api_key", self.key)]
        for k, v in params.items():
            for x in (v if isinstance(v, (list, tuple)) else [v]):
                if x is not None:
                    q.append((k, str(x)))
        url = API + path + "?" + urllib.parse.urlencode(q)
        for attempt in range(5):
            wait = self.pace - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.left -= 1
            self.calls += 1
            try:
                return json.loads(self.opener(url))
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(60 * (attempt + 1))
                    continue
                if e.code in (500, 502, 503, 504) and attempt < 4:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
        raise RuntimeError("FEC kept rate-limiting " + path)


def fec_ids(cfg):
    """bioguide -> list of FEC candidate ids, from congress-legislators."""
    d = legislators_dir(cfg)
    with open(os.path.join(d, "legislators-current.yaml")) as f:
        recs = yaml.load(f, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
    return {r["id"]["bioguide"]: r["id"].get("fec") or [] for r in recs}


def num(x):
    try:
        return round(float(x or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def pick_candidate(api, ids, chamber, cycle):
    """Among a member's FEC ids, the one for their current office with the most money this cycle."""
    prefix = "S" if chamber == "Senate" else "H"
    best = None
    for cid in sorted(ids, key=lambda c: (not c.startswith(prefix), c)):
        if not cid.startswith(prefix):
            continue
        res = api.get(f"candidate/{cid}/totals/", cycle=cycle, per_page=5).get("results") or []
        res = [r for r in res if int(r.get("cycle") or 0) == cycle] or res
        if res and (best is None or num(res[0].get("receipts")) > num(best[1].get("receipts"))):
            best = (cid, res[0])
    return best


def principal_committee(api, cid, cycle):
    res = api.get(f"candidate/{cid}/committees/", cycle=cycle, designation="P", per_page=5).get("results") or []
    if not res:
        res = api.get(f"candidate/{cid}/committees/", designation="P", per_page=5).get("results") or []
    return (res[0]["committee_id"], res[0].get("name")) if res else (None, None)


SIZE_LABEL = {0: "Under $200", 200: "$200–$499", 500: "$500–$999", 1000: "$1,000–$1,999", 2000: "$2,000 and up"}
JUNK_EMPLOYERS = {"", "NONE", "NULL", "DISABLED", "N.A", "NOT EMPLOYED/RETIRED", "RETIRED/NOT EMPLOYED", "INFO REQUESTED", "BEST EFFORTS", "N/A", "NA", "RETIRED", "SELF-EMPLOYED", "SELF EMPLOYED", "SELF", "NOT EMPLOYED", "UNEMPLOYED",
                  "INFORMATION REQUESTED", "INFORMATION REQUESTED PER BEST EFFORTS", "REQUESTED", "HOMEMAKER", "STUDENT", "NOT APPLICABLE"}


def pac_contributions(api, committee_id, cycle):
    """PAC (other political committee) contributions: FEC Form 3, line 11C. Memo entries skipped."""
    by = {}
    params = dict(committee_id=committee_id, two_year_transaction_period=cycle, line_number="F3-11C", per_page=100, sort="-contribution_receipt_date")
    truncated = False
    for page in range(PAC_PAGES):
        r = api.get("schedules/schedule_a/", **params)
        for row in r.get("results") or []:
            if (row.get("memo_code") or "").upper() == "X":
                continue
            cid = row.get("contributor_id") or ("name:" + (row.get("contributor_name") or "Unknown").upper())
            o = by.setdefault(cid, {"id": cid, "name": row.get("contributor_name") or "Unknown", "total": 0.0, "n": 0})
            o["total"] = round(o["total"] + num(row.get("contribution_receipt_amount")), 2)
            o["n"] += 1
        last = (r.get("pagination") or {}).get("last_indexes")
        if not last or not r.get("results") or len(r["results"]) < 100:
            break
        params.update(last)
        if page == PAC_PAGES - 1:
            truncated = True
    return [x for x in by.values() if x["total"] > 0], truncated


def committee_kinds(api, ids, cache):
    """FEC registration facts for each contributing PAC (cached in data/fec_committees.json)."""
    need = [i for i in ids if i not in cache and not i.startswith("name:")]
    for k in range(0, len(need), 100):
        chunk = need[k:k + 100]
        r = api.get("committees/", committee_id=chunk, per_page=100)
        for c in r.get("results") or []:
            cache[c["committee_id"]] = {"name": c.get("name"), "type": c.get("committee_type"), "designation": c.get("designation"),
                                        "org": c.get("organization_type"), "connected": c.get("affiliated_committee_name") or None}
        for i in chunk:
            cache.setdefault(i, {"name": None, "type": None, "designation": None, "org": None})
    return cache


def kind_of(info):
    if not info:
        return "other"
    if (info.get("designation") or "") == "D":
        return "leadership"
    if info.get("org") in ("C", "W", "L", "T", "M", "V"):
        return info["org"]
    if (info.get("type") or "") in ("N", "Q", "V", "W"):
        return "nonconnected"
    return "other"


def build_member(api, m, ids, cycle, cache):
    picked = pick_candidate(api, ids, m["chamber"], cycle)
    if not picked:
        return {"id": m["id"], "cycle": cycle, "none": True}
    cid, t = picked
    com, com_name = principal_committee(api, cid, cycle)
    totals = {
        "raised": num(t.get("receipts")),
        "spent": num(t.get("disbursements")),
        "cash": num(t.get("last_cash_on_hand_end_period") or t.get("cash_on_hand_end_period")),
        "debts": num(t.get("last_debts_owed_by_committee") or t.get("debts_owed_by_committee")),
        "indItemized": num(t.get("individual_itemized_contributions")),
        "indUnitemized": num(t.get("individual_unitemized_contributions")),
        "pac": num(t.get("other_political_committee_contributions")),
        "party": num(t.get("political_party_committee_contributions")),
        "self": num(t.get("candidate_contribution")) + num(t.get("loans_made_by_candidate") or t.get("loans_received_from_candidate")),
        "transfers": num(t.get("transfers_from_other_authorized_committee")),
    }
    out = {"id": m["id"], "fec": cid, "committee": com, "committeeName": com_name, "cycle": cycle,
           "from": t.get("coverage_start_date", "")[:10] or None, "through": (t.get("coverage_end_date") or "")[:10] or None, "totals": totals}

    # Gift sizes and donor states from the campaign committee's own two-year totals. They must reconcile with the
    # FEC's individual-contribution totals; if they don't, the section is left out rather than shown wrong.
    ind = totals["indItemized"] + totals["indUnitemized"]
    out["sizes"] = None
    out["states"] = None
    if com:
        sz = api.get("schedules/schedule_a/by_size/", committee_id=com, cycle=cycle, per_page=20).get("results") or []
        sizes = {k: 0.0 for k in SIZE_LABEL}
        for r in sz:
            k = int(r.get("size") or 0)
            if k in sizes:
                sizes[k] = round(sizes[k] + num(r.get("total")), 2)
        if sizes[0] + 1 < totals["indUnitemized"]:  # this summary left out gifts too small to itemize
            sizes[0] = round(sizes[0] + totals["indUnitemized"], 2)
        if ind > 0 and abs(sum(sizes.values()) - ind) <= 0.1 * ind + 1000:
            out["sizes"] = [{"label": SIZE_LABEL[k], "total": v} for k, v in sizes.items()]
        else:
            print(f"  {m['id']}: gift sizes left out (sizes add to {sum(sizes.values()):,.0f}; individual gifts {ind:,.0f}; raw {[(r.get('size'), r.get('total')) for r in sz]})")
        st = api.get("schedules/schedule_a/by_state/", committee_id=com, cycle=cycle, per_page=100).get("results") or []
        home = sum(num(r.get("total")) for r in st if r.get("state") == m["state"])
        allst = sum(num(r.get("total")) for r in st)
        if not (allst > 0 and allst <= totals["indItemized"] * 1.1 + 1000):
            print(f"  {m['id']}: states left out (states add to {allst:,.0f}; itemized gifts {totals['indItemized']:,.0f})")
        if allst > 0 and allst <= totals["indItemized"] * 1.1 + 1000:
            out["states"] = {"home": round(home, 2), "total": round(allst, 2),
                             "top": [{"state": r.get("state"), "total": num(r.get("total"))} for r in sorted(st, key=lambda r: -num(r.get("total")))[:5] if r.get("state")]}

    if com:
        emp = api.get("schedules/schedule_a/by_employer/", committee_id=com, cycle=cycle, sort="-total", per_page=40).get("results") or []
        def real(e):
            e = (e or "").strip().upper().rstrip(".")
            return e not in JUNK_EMPLOYERS and not any(w in e for w in ("REQUESTED", "RETIRED", "NOT EMPLOYED", "SELF EMPLOYED", "SELF-EMPLOYED"))
        emp = [r for r in emp if real(r.get("employer"))]
        out["employers"] = [{"name": r.get("employer"), "total": num(r.get("total")), "n": int(r.get("count") or 0)} for r in emp[:10]]
        pacs, truncated = pac_contributions(api, com, cycle)
        committee_kinds(api, [p["id"] for p in pacs], cache)
        by_kind = {}
        for p in pacs:
            p["kind"] = kind_of(cache.get(p["id"]))
            by_kind[p["kind"]] = round(by_kind.get(p["kind"], 0) + p["total"], 2)
        pacs.sort(key=lambda p: -p["total"])
        out["pacs"] = {"total": round(sum(p["total"] for p in pacs), 2), "count": len(pacs), "truncated": truncated,
                       "byKind": by_kind, "list": [{"id": p["id"], "name": p["name"], "total": p["total"], "kind": p["kind"]} for p in pacs]}
    return out


def check(rec):
    """Sanity checks before anything is published."""
    if rec.get("none"):
        return
    t = rec["totals"]
    for k, v in t.items():
        assert v >= -1, f"{rec['id']}: negative {k}"
    if rec.get("pacs") and t["pac"] > 0:
        # Our itemized PAC sum should not exceed the FEC's own PAC total by more than rounding/refunds.
        assert rec["pacs"]["total"] <= t["pac"] * 1.25 + 500, f"{rec['id']}: PAC detail exceeds FEC total"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--budget", type=int, default=int(os.environ.get("FEC_BUDGET", "900")))
    ap.add_argument("--max-age-days", type=int, default=6)
    a = ap.parse_args(argv)
    key = os.environ.get("FEC_API_KEY")
    if not key:
        print("FEC_API_KEY is not set; skipping.")
        return 0
    cfg = load_config()
    cycle = max(s["year"] for s in cfg["sessions"])
    cycle += cycle % 2  # FEC cycles end in even years
    members = [m for m in read_json(os.path.join(SITE_DATA, "members.json"), []) if m.get("current")]
    ids = fec_ids(cfg)
    os.makedirs(OUT, exist_ok=True)
    index = read_json(os.path.join(OUT, "index.json"), {}) or {}
    cache = read_json(COMMITTEE_CACHE, {}) or {}
    today = datetime.date.today()

    def age(mid):
        d = (index.get(mid) or {}).get("fetched")
        return (today - datetime.date.fromisoformat(d)).days if d else 10 ** 6

    todo = [m for m in members if (not a.only or m["id"] in a.only)]
    if not a.only:
        todo = [m for m in todo if age(m["id"]) >= a.max_age_days]
    todo.sort(key=lambda m: -age(m["id"]))
    api = FEC(key, a.budget)
    done = failed = 0
    for m in todo:
        try:
            rec = build_member(api, m, ids.get(m["id"], []), cycle, cache)
            check(rec)
        except Budget:
            break
        except Exception as e:  # one member's problem never blocks the rest
            failed += 1
            print(f"  {m['id']} {m['name']}: {e}")
            continue
        rec["fetched"] = today.isoformat()
        write_json(os.path.join(OUT, m["id"] + ".json"), rec)
        index[m["id"]] = {"fetched": rec["fetched"], "through": rec.get("through"), "none": bool(rec.get("none"))}
        done += 1
    write_json(os.path.join(OUT, "index.json"), index)
    write_json(COMMITTEE_CACHE, cache)
    left = sum(1 for m in members if age(m["id"]) >= a.max_age_days and m["id"] not in {k for k, v in index.items() if v.get("fetched") == today.isoformat()})
    print(f"Money: refreshed {done} members ({failed} failed), {api.calls} FEC requests, {left} still due.")
    return 1 if failed and not done else 0


if __name__ == "__main__":
    sys.exit(main())
