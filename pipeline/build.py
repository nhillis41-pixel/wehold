"""Run the whole WeHold data update.

    python pipeline/build.py              # full update (network)
    python pipeline/build.py --offline    # rebuild site data from cached rolls only
    python pipeline/build.py --skip-zips  # skip the ZIP table download

Nothing is written to site/data unless every validation check passes.
"""
import argparse
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import attendance  # noqa: E402
import members as members_mod  # noqa: E402
import validate  # noqa: E402
import votes as votes_mod  # noqa: E402
import zips  # noqa: E402
from common import CURATED, SITE_DATA, load_config, read_json, write_json  # noqa: E402


def passed(result):
    r = result.lower()
    if any(w in r for w in ("fail", "reject", "not agreed", "not confirmed", "not sustained", "not passed")):
        return False
    return any(w in r for w in ("pass", "agreed", "confirmed", "adopted", "sustained"))


def curated_with_positions(curated, rolls, members_by_id):
    out = []
    for v in curated["votes"]:
        r = rolls[v["id"]]
        t = r.get("totals") or {}
        pos = {}
        for bid, code in r["votes"].items():
            pos[bid] = {"Y": "Yea", "N": "Nay", "P": "Present", "X": "NV"}.get(code, "Other")
        out.append({
            **v,
            "ch": r["ch"],
            "roll": r["roll"],
            "date": r["date"],
            "result": r["result"],
            "pass": passed(r["result"]),
            "tally": f"{t.get('yea', 0)}–{t.get('nay', 0)}",
            "nv": t.get("nv", 0),
            "rec": r["url"],
            "pos": pos,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--skip-zips", action="store_true")
    args = ap.parse_args()
    cfg = load_config()
    today = datetime.date.today()

    print("Loading member roster…")
    members = members_mod.build_members(cfg, today)
    by_id = {m["id"]: m for m in members}
    lis = {m["lis"]: m["id"] for m in members if m.get("lis")}
    print(f"  {len(members)} members ({sum(m['current'] for m in members)} serving now)")

    if not args.offline:
        votes_mod.update_house(cfg, by_id)
        votes_mod.update_senate(cfg, lis)
    rolls = votes_mod.load_all_rolls(cfg)
    print(f"Roll calls on file: {len(rolls)}")

    curated = read_json(os.path.join(CURATED, "votes.json"))
    errors, warnings = validate.check_rolls(rolls, by_id)
    errors += validate.check_curated(curated, rolls)
    att = attendance.compute(rolls, by_id)
    warnings += validate.check_attendance(att, members, today)

    for w in warnings:
        print("WARNING:", w)
    if errors:
        for e in errors:
            print("ERROR:", e)
        print(f"\n{len(errors)} problem(s) found. Site data was NOT updated.")
        sys.exit(1)

    zip_info = None
    if not args.offline and not args.skip_zips:
        zip_info = zips.update(cfg)

    write_json(os.path.join(SITE_DATA, "members.json"), members)
    write_json(os.path.join(SITE_DATA, "attendance.json"), att)
    index = {rid: [r["ch"], r["date"], r["question"], r["title"], r["result"], r["url"]] for rid, r in rolls.items()}
    write_json(os.path.join(SITE_DATA, "rolls.json"), index)
    write_json(os.path.join(SITE_DATA, "votes.json"), {
        "votes": curated_with_positions(curated, rolls, by_id),
        "questions": curated["questions"],
    })
    meta = read_json(os.path.join(SITE_DATA, "meta.json"), {})
    meta.update({
        "congress": cfg["congress"],
        "electionDay": cfg["electionDay"],
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "rolls": {"House": att["chambers"]["House"]["rolls"], "Senate": att["chambers"]["Senate"]["rolls"]},
        "latest": {ch: max((r["date"] for r in rolls.values() if r["ch"] == ch), default=None) for ch in ("House", "Senate")},
        "warnings": len(warnings),
    })
    if zip_info:
        meta["zips"] = zip_info
    write_json(os.path.join(SITE_DATA, "meta.json"), meta, compact=False)
    print("Site data updated.")


if __name__ == "__main__":
    main()
