"""Tests for pipeline/bills.py with sample Congress.gov responses (no network)."""
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import bills  # noqa: E402


def test_parse_labels():
    assert bills.parse_bill("H.R. 2347") == ("hr", 2347)
    assert bills.parse_bill("H R 8800") == ("hr", 8800)
    assert bills.parse_bill("H.Con.Res. 89") == ("hconres", 89)
    assert bills.parse_bill("S.J.Res. 55") == ("sjres", 55)
    assert bills.parse_bill("H RES 1655") == ("hres", 1655)
    assert bills.parse_bill("PN1129") is None and bills.parse_bill("QUORUM") is None and bills.parse_bill("") is None


def test_clean_html():
    assert bills.clean_html("<p>This bill does <strong>two</strong> things.</p><ul><li>One &amp; more</li><li>Two</li></ul>") == ["This bill does two things.", "• One & more", "• Two"]


def test_fetch_bill():
    calls = []
    R = {
        "bill/119/hr/2347": {"bill": {"title": "Survivor Justice Tax Prevention Act", "introducedDate": "2025-03-26", "policyArea": {"name": "Taxation"},
                                       "sponsors": [{"fullName": "Rep. Smucker, Lloyd [R-PA-11]", "party": "R", "state": "PA", "bioguideId": "S001199"}],
                                       "cosponsors": {"count": 40}, "latestAction": {"actionDate": "2026-11-10", "text": "Motion to proceed agreed to."},
                                       "cboCostEstimates": [{"title": "H.R. 2347", "pubDate": "2026-03-20T10:00:00Z", "url": "https://www.cbo.gov/publication/1", "description": "<p>As ordered reported</p>"}],
                                       "amendments": {"count": 1}}},
        "bill/119/hr/2347/actions": {"actions": [
            {"actionDate": "2025-03-26", "text": "Introduced in House", "type": "IntroReferral"},
            {"actionDate": "2025-03-26", "text": "Introduced in House", "type": "IntroReferral"},
            {"actionDate": "2026-04-27", "text": "Passed/agreed to in House: On passage Passed by recorded vote: 410 - 5 (Roll no. 150).", "type": "Floor", "recordedVotes": [{"chamber": "House", "rollNumber": 150, "date": "2026-04-27T20:00:00Z"}]},
            {"actionDate": "2026-04-28", "text": "Received in the Senate.", "type": "IntroReferral"},
            {"actionDate": "2026-04-28", "text": "Some internal step", "type": "Other"}]},
        "bill/119/hr/2347/summaries": {"summaries": [{"actionDate": "2025-03-26", "actionDesc": "Introduced in House", "text": "<p>Old.</p>"},
                                                     {"actionDate": "2026-04-27", "actionDesc": "Passed House", "text": "<p>This bill excludes settlements.</p>"}]},
        "bill/119/hr/2347/text": {"textVersions": [{"type": "Engrossed in House", "date": "2026-04-28T04:00:00Z", "formats": [{"type": "PDF", "url": "https://x/pdf"}, {"type": "Formatted Text", "url": "https://x/htm"}]}]},
        "bill/119/hr/2347/amendments": {"amendments": [{"type": "SAMDT", "number": 4000, "purpose": "In the nature of a substitute.", "latestAction": {"text": "Proposed"}}]},
    }

    def opener(url):
        u = urllib.parse.urlparse(url)
        path = u.path.replace("/v3/", "", 1)
        calls.append(urllib.parse.parse_qs(u.query))
        return json.dumps(R[path]).encode()

    b = bills.fetch_bill(bills.Congress("KEY", pace=0, opener=opener), 119, "hr", 2347)
    assert b["label"] == "H.R. 2347" and b["sponsor"]["party"] == "R" and b["policyArea"] == "Taxation"
    assert b["summary"]["version"] == "Passed House" and b["summary"]["paras"] == ["This bill excludes settlements."], "latest CRS summary"
    assert [p["text"] for p in b["path"]][0] == "Introduced in House" and len(b["path"]) == 3, "major actions only, duplicates merged"
    assert b["path"][1]["votes"] == [{"chamber": "House", "roll": 150, "date": "2026-04-27"}]
    assert b["cbo"][0]["about"] == "As ordered reported" and b["cbo"][0]["date"] == "2026-03-20"
    assert b["texts"][0]["url"] == "https://x/htm", "prefers the readable text version"
    assert b["amendments"][0]["label"] == "SAMDT 4000"
    assert b["url"] == "https://www.congress.gov/bill/119th-congress/house-bill/2347"
    assert all(q.get("api_key") == ["KEY"] and q.get("format") == ["json"] for q in calls)


def test_rolls_from_repo_data():
    rolls = bills.rolls_for(119, "hr", 2347)
    ids = [r["id"] for r in rolls]
    assert "S-119-2-257" in ids and "S-119-2-258" in ids, "finds the Senate votes on H.R. 2347"
    r = next(r for r in rolls if r["id"] == "S-119-2-257")
    assert r["pos"] and all(v in ("Y", "N", "X", "P") for v in r["pos"].values())


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
