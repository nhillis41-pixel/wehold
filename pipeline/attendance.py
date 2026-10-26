"""Attendance: how many recorded votes each member missed in the current Congress.

Rules (shown to users on the site):
- A member is only counted for roll calls on which they appear in the official record,
  so someone sworn in mid-term starts at zero and departed members stop counting.
- "Not Voting" counts as missed. "Present" counts as showing up.
- The Speaker of the House traditionally votes rarely; the site labels this.
"""
import statistics


def compute(rolls, members_by_id):
    stats = {}
    speaker_ids = set()
    rolls = {k: r for k, r in rolls.items() if not r.get("manual")}  # partial (key votes only)
    for r in rolls.values():
        if r.get("speaker"):
            speaker_ids.add(r["speaker"])
        for bid, code in r["votes"].items():
            s = stats.setdefault(bid, {"eligible": 0, "missed": 0, "present": 0, "missedRolls": [], "ch": r["ch"]})
            s["eligible"] += 1
            if code == "X":
                s["missed"] += 1
                s["missedRolls"].append(r["id"])
            elif code == "P":
                s["present"] += 1
    for bid, s in stats.items():
        s["pct"] = round(100 * s["missed"] / s["eligible"], 1) if s["eligible"] else 0.0
        s["missedRolls"].sort(key=lambda rid: (rolls[rid]["date"], rolls[rid]["roll"]), reverse=True)
        if bid in speaker_ids:
            s["speaker"] = True
    chambers = {}
    for ch in ("House", "Senate"):
        rates = [s["pct"] for bid, s in stats.items() if s["ch"] == ch and s["eligible"] >= 20 and not s.get("speaker")]
        n_rolls = sum(1 for r in rolls.values() if r["ch"] == ch)
        chambers[ch] = {"rolls": n_rolls, "medianPct": round(statistics.median(rates), 1) if rates else None}
    return {"chambers": chambers, "members": stats}
