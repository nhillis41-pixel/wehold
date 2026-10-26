"""Checks that must pass before anything is published.

Errors stop the update (the site keeps its last good data and GitHub emails the owner).
Warnings are printed in the run log but do not block publishing.
"""
import datetime


def check_rolls(rolls, members_by_id):
    errors, warnings = [], []
    for r in rolls.values():
        counts = {"Y": 0, "N": 0, "P": 0, "X": 0, "O": 0}
        for code in r["votes"].values():
            counts[code] += 1
        t = r.get("totals")
        if t and all(v is not None for v in t.values()) and counts["O"] == 0:
            got = {"yea": counts["Y"], "nay": counts["N"], "present": counts["P"], "nv": counts["X"]}
            if r.get("tieBreaker"):
                # The Vice President's tie-breaking vote is in the tally but not in the member list.
                ok = all(got[k] == t[k] or (k in ("yea", "nay") and abs(got[k] - t[k]) == 1) for k in got)
            else:
                ok = got == t
            if not ok:
                errors.append(f"{r['id']}: member-by-member count {got} does not match official totals {t}")
        menu = r.get("menuTally")
        if menu and menu.get("yea") is not None and t and not r.get("tieBreaker"):
            if (menu["yea"], menu["nay"]) != (t["yea"], t["nay"]):
                errors.append(f"{r['id']}: Senate vote list tally {menu} disagrees with the vote record {t}")
        for bid in r["votes"]:
            if bid.startswith("lis:") or bid not in members_by_id:
                errors.append(f"{r['id']}: no member record for {bid}")
                break
    return errors, warnings


def check_curated(curated, rolls, skip_missing=()):
    """skip_missing: chamber prefixes ("S", "H") whose source was unreachable this run."""
    errors, warnings = [], []
    ids = set()
    for v in curated["votes"]:
        if v["id"] in ids:
            errors.append(f"curated vote {v['id']} is listed twice")
        ids.add(v["id"])
        if v["id"] not in rolls:
            if v["id"][0] in skip_missing:
                warnings.append(f"curated vote {v['id']} skipped: its chamber's data is unavailable")
            else:
                errors.append(f"curated vote {v['id']} is not in the official roll-call data")
        for field in ("title", "sum", "tags"):
            if not v.get(field):
                errors.append(f"curated vote {v['id']} is missing '{field}'")
    for q in curated["questions"]:
        for link in q["votes"]:
            if link["vote"] not in ids:
                errors.append(f"question {q['id']} points to unknown vote {link['vote']}")
            if link["yes"] not in ("Yea", "Nay"):
                errors.append(f"question {q['id']} has an invalid 'yes' value {link['yes']}")
    return errors, warnings


def check_attendance(att, members, today=None):
    warnings = []
    today = today or datetime.date.today()
    for m in members:
        if not m["current"] or m.get("title") in ("Delegate", "Resident Commissioner"):
            continue  # delegates cannot vote on most House roll calls
        started = datetime.date.fromisoformat(m["start"])
        if (today - started).days > 60 and att["chambers"][m["chamber"]]["rolls"] > 0:
            if m["id"] not in att["members"]:
                warnings.append(f"{m['name']} ({m['state']}) has no recorded votes since taking office")
    return warnings
