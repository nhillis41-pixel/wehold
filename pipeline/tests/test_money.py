"""Tests for pipeline/money.py with sample FEC responses (no network)."""
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import money  # noqa: E402

M = {"id": "T000001", "name": "Test Senator", "chamber": "Senate", "state": "TN"}


def fake_fec(routes):
    calls = []

    def opener(url):
        u = urllib.parse.urlparse(url)
        path = u.path.replace("/v1/", "", 1)
        q = urllib.parse.parse_qs(u.query)
        calls.append((path, q))
        for match, fn in routes:
            if path == match:
                return json.dumps(fn(q)).encode()
        raise AssertionError("unexpected FEC call " + path)
    return opener, calls


def pac_page(q):
    # Two pages of PAC receipts; the second is the last. One memo entry is skipped.
    if "last_index" not in q:
        rows = [{"contributor_id": "C00000001", "contributor_name": "ACME ENERGY PAC", "contribution_receipt_amount": 5000, "memo_code": None}] * 60
        rows += [{"contributor_id": "C00000002", "contributor_name": "WORKERS UNION PAC", "contribution_receipt_amount": 1000}] * 40
        return {"results": rows, "pagination": {"last_indexes": {"last_index": "x1", "last_contribution_receipt_date": "2026-01-01"}}}
    return {"results": [{"contributor_id": "C00000003", "contributor_name": "SEN. SMITH LEADERSHIP PAC", "contribution_receipt_amount": 2500},
                        {"contributor_id": "C00000003", "contributor_name": "SEN. SMITH LEADERSHIP PAC", "contribution_receipt_amount": 999, "memo_code": "X"}],
            "pagination": {"last_indexes": None}}


ROUTES = [
    ("candidate/S0TN00001/totals/", lambda q: {"results": [{"cycle": 2026, "receipts": 2000000, "disbursements": 900000, "last_cash_on_hand_end_period": 5000000,
                                                            "individual_itemized_contributions": 1200000, "individual_unitemized_contributions": 300000,
                                                            "other_political_committee_contributions": 400000, "political_party_committee_contributions": 5000,
                                                            "candidate_contribution": 0, "coverage_start_date": "2025-01-01T00:00:00", "coverage_end_date": "2026-09-30T00:00:00"}]}),
    ("candidate/H8TN00002/totals/", lambda q: {"results": [{"cycle": 2026, "receipts": 10}]}),
    ("candidate/S0TN00001/committees/", lambda q: {"results": [{"committee_id": "C00999999", "name": "FRIENDS OF TEST"}]}),
    ("schedules/schedule_a/by_size/by_candidate/", lambda q: {"results": [{"size": 0, "total": 100000}, {"size": 200, "total": 200000}, {"size": 2000, "total": 900000}]}),
    ("schedules/schedule_a/by_state/by_candidate/", lambda q: {"results": [{"state": "TN", "total": 700000}, {"state": "TX", "total": 300000}, {"state": "NY", "total": 200000}]}),
    ("schedules/schedule_a/by_employer/", lambda q: {"results": [{"employer": "RETIRED", "total": 99999, "count": 500}, {"employer": "ACME ENERGY", "total": 50000, "count": 20},
                                                                  {"employer": "Self-Employed", "total": 40000, "count": 30}, {"employer": "STATE OF TENNESSEE", "total": 20000, "count": 12}, {"employer": "NULL", "total": 9000, "count": 3}, {"employer": "INFORMATION REQUESTED PER BEST EFFORTS", "total": 8000, "count": 9}]}),
    ("schedules/schedule_a/", pac_page),
    ("committees/", lambda q: {"results": [{"committee_id": "C00000001", "name": "ACME ENERGY PAC", "committee_type": "Q", "designation": "B", "organization_type": "C"},
                                          {"committee_id": "C00000002", "name": "WORKERS UNION PAC", "committee_type": "Q", "designation": "U", "organization_type": "L"},
                                          {"committee_id": "C00000003", "name": "SEN. SMITH LEADERSHIP PAC", "committee_type": "N", "designation": "D", "organization_type": None}]}),
]


def test_member_record():
    opener, calls = fake_fec(ROUTES)
    api = money.FEC("KEY", budget=100, pace=0, opener=opener)
    cache = {}
    rec = money.build_member(api, M, ["H8TN00002", "S0TN00001"], 2026, cache)
    money.check(rec)
    assert rec["fec"] == "S0TN00001", "uses the Senate id, not the old House one"
    assert not any(p == "candidate/H8TN00002/totals/" for p, _ in calls), "skips ids for the other chamber"
    assert rec["committee"] == "C00999999"
    assert rec["totals"]["raised"] == 2000000 and rec["totals"]["pac"] == 400000 and rec["through"] == "2026-09-30"
    sizes = {s["label"]: s["total"] for s in rec["sizes"]}
    assert sizes["Under $200"] == 400000, "unitemized gifts added to the smallest bracket"
    assert rec["states"]["home"] == 700000 and rec["states"]["total"] == 1200000
    names = [e["name"] for e in rec["employers"]]
    assert names == ["ACME ENERGY", "STATE OF TENNESSEE"], "retired/self-employed are not employers"
    pacs = {p["id"]: p for p in rec["pacs"]["list"]}
    assert pacs["C00000001"]["total"] == 300000 and pacs["C00000001"]["kind"] == "C"
    assert pacs["C00000002"]["kind"] == "L"
    assert pacs["C00000003"]["total"] == 2500 and pacs["C00000003"]["kind"] == "leadership", "memo entry skipped"
    assert rec["pacs"]["byKind"] == {"C": 300000, "L": 40000, "leadership": 2500}
    assert not rec["pacs"]["truncated"]
    q = [qq for p, qq in calls if p == "schedules/schedule_a/"][0]
    assert q["line_number"] == ["F3-11C"], "PAC contributions only (line 11C), not transfers"
    assert all("api_key" in qq for _, qq in calls)
    bc = [qq for p, qq in calls if p.endswith("/by_candidate/")]
    assert bc and all(qq.get("election_full") == ["false"] for qq in bc), "two-year cycle, not the senator's whole term"
    assert len(cache) == 3
    # No individual donor names anywhere in what we publish.
    assert "contributor_name" not in json.dumps(rec)


def test_budget_stops_cleanly():
    opener, _ = fake_fec(ROUTES)
    api = money.FEC("KEY", budget=2, pace=0, opener=opener)
    try:
        money.build_member(api, M, ["S0TN00001"], 2026, {})
        raise AssertionError("expected Budget")
    except money.Budget:
        pass


def test_no_fec_record():
    opener, _ = fake_fec([("candidate/S0TN00009/totals/", lambda q: {"results": []})])
    api = money.FEC("KEY", budget=10, pace=0, opener=opener)
    rec = money.build_member(api, M, ["S0TN00009"], 2026, {})
    assert rec["none"] is True
    money.check(rec)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
