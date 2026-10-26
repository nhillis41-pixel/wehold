"""Build the member roster from the public-domain unitedstates/congress-legislators dataset.

Includes everyone who has served in the current Congress, so votes cast by members who
later left office still have a name attached.
"""
import datetime
import os
import subprocess

import yaml

from common import ROOT, load_config

TERRITORIES = {"AS", "GU", "MP", "PR", "VI", "DC"}
PARTY = {"Republican": "R", "Democrat": "D", "Independent": "I", "Libertarian": "L"}


def congress_start(congress):
    # The 1st Congress began in 1789; each Congress starts Jan 3 of odd years (since 1935).
    return datetime.date(1789 + 2 * (congress - 1), 1, 3)


def legislators_dir(cfg):
    d = os.environ.get("LEGISLATORS_DIR") or os.path.join(ROOT, ".cache", "congress-legislators")
    if not os.path.exists(os.path.join(d, "legislators-current.yaml")):
        os.makedirs(os.path.dirname(d), exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", cfg["legislatorsRepo"], d], check=True)
    return d


def _member(rec, term, today):
    name = rec["name"]
    full = name.get("official_full") or f'{name.get("first", "")} {name.get("last", "")}'.strip()
    chamber = "Senate" if term["type"] == "sen" else "House"
    state = term["state"]
    end = datetime.date.fromisoformat(term["end"])
    m = {
        "id": rec["id"]["bioguide"],
        "name": full,
        "last": name.get("last"),
        "party": PARTY.get(term.get("party"), (term.get("party") or "?")[:1]),
        "state": state,
        "chamber": chamber,
        "start": term["start"],
        "end": term["end"],
        "phone": term.get("phone"),
        "url": term.get("url"),
        "contact": term.get("contact_form") or term.get("url"),
        "current": end > today,
    }
    if rec["id"].get("lis"):
        m["lis"] = rec["id"]["lis"]
    if chamber == "House":
        m["district"] = int(term.get("district") or 0)
        if state in TERRITORIES:
            m["title"] = "Resident Commissioner" if state == "PR" else "Delegate"
        else:
            m["title"] = "Representative"
    else:
        m["title"] = "Senator"
        m["class"] = term.get("class")
    return m


def build_members(cfg, today=None, extra_ids=()):
    """extra_ids: bioguide IDs found in vote records that must be included even if no term
    overlaps this Congress (e.g. a member-elect listed on the opening-day quorum call who never
    took the seat)."""
    today = today or datetime.date.today()
    extra_ids = set(extra_ids)
    extra = {}
    d = legislators_dir(cfg)
    start = congress_start(cfg["congress"])
    out = {}
    for fname in ("legislators-historical.yaml", "legislators-current.yaml"):
        with open(os.path.join(d, fname)) as f:
            recs = yaml.load(f, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
        for rec in recs:
            if rec["id"].get("bioguide") in extra_ids and rec.get("terms"):
                extra[rec["id"]["bioguide"]] = _member(rec, rec["terms"][-1], today)
            for term in rec.get("terms", []):
                if datetime.date.fromisoformat(term["end"]) <= start:
                    continue
                m = _member(rec, term, today)
                prev = out.get(m["id"])
                # Keep the most recent qualifying term (e.g. a House member who moved to the Senate).
                if not prev or m["start"] >= prev["start"]:
                    out[m["id"]] = m
    for bid, m in extra.items():
        if bid not in out:
            m["note"] = "Listed in this Congress's vote records but did not serve a term in it"
            out[bid] = m
    for m in out.values():
        if not m["current"] and "note" not in m:
            m["note"] = "Left office " + m["end"]
    return sorted(out.values(), key=lambda m: (m["state"], m["chamber"], m.get("district", 0), m["last"] or ""))
