import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import attendance  # noqa: E402
import validate  # noqa: E402
import votes  # noqa: E402
import zips  # noqa: E402
from build import passed  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), "rb") as f:
        return f.read()


MEMBERS = {b: {"id": b} for b in ["B001309", "C001068", "O000175", "J000299", "B001243", "H000601", "S000148"]}
LIS = {"S396": "B001243", "S407": "H000601", "S270": "S000148"}


def test_house_parse():
    rec, _ = votes.parse_house(fixture("house_roll.xml"))
    assert rec["id"] == "H-119-2-314"
    assert rec["date"] == "2026-09-16"
    assert rec["votes"] == {"B001309": "Y", "C001068": "Y", "O000175": "N", "J000299": "X"}
    assert rec["speaker"] == "J000299"
    assert rec["totals"] == {"yea": 2, "nay": 1, "present": 0, "nv": 1}
    assert rec["url"] == "https://clerk.house.gov/Votes/2026314"


def test_senate_parse():
    rec, unknown = votes.parse_senate(fixture("senate_roll.xml"), LIS)
    assert not unknown
    assert rec["id"] == "S-119-2-256"
    assert rec["date"] == "2026-09-30"
    assert rec["votes"] == {"B001243": "X", "H000601": "Y", "S000148": "Y"}
    assert rec["totals"] == {"yea": 2, "nay": 0, "present": 0, "nv": 1}
    assert rec["url"].endswith("vote1192/vote_119_2_00256.htm")


def test_validation_and_attendance():
    h, _ = votes.parse_house(fixture("house_roll.xml"))
    s, _ = votes.parse_senate(fixture("senate_roll.xml"), LIS)
    rolls = {h["id"]: h, s["id"]: s}
    errors, _ = validate.check_rolls(rolls, MEMBERS)
    assert errors == []
    # A tampered count must be caught.
    bad = dict(h, totals={"yea": 3, "nay": 1, "present": 0, "nv": 0})
    errors, _ = validate.check_rolls({bad["id"]: bad}, MEMBERS)
    assert errors and "does not match" in errors[0]
    att = attendance.compute(rolls, MEMBERS)
    assert att["members"]["B001243"]["missed"] == 1
    assert att["members"]["B001243"]["missedRolls"] == ["S-119-2-256"]
    assert att["members"]["J000299"]["speaker"] is True
    assert att["members"]["H000601"]["missed"] == 0


def test_vote_codes():
    assert votes.vote_code("Aye") == "Y"
    assert votes.vote_code("No") == "N"
    assert votes.vote_code("Present, Giving Live Pair") == "P"
    assert votes.vote_code("Jeffries") == "O"


def test_zip_table():
    text = (
        "OID_CD119_20|GEOID_CD119_20|NAMELSAD_CD119_20|AREALAND_CD119_20|AREAWATER_CD119_20|MTFCC_CD119_20|FUNCSTAT_CD119_20|"
        "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|AREALAND_PART|AREAWATER_PART\n"
        "1|4702|District 2|0|0|G5200|N|9|37902|ZCTA5 37902|0|0|G6350|B5|S|1000|0\n"
        "2|4702|District 2|0|0|G5200|N|9|37920|ZCTA5 37920|0|0|G6350|B5|S|700|0\n"
        "3|4703|District 3|0|0|G5200|N|9|37920|ZCTA5 37920|0|0|G6350|B5|S|300|0\n"
        "4|5000|At large|0|0|G5200|N|9|05401|ZCTA5 05401|0|0|G6350|B5|S|10|0\n"
        "5|1198|Delegate|0|0|G5200|N|9|20001|ZCTA5 20001|0|0|G6350|B5|S|10|0\n"
    )
    t = zips.build_zip_table(text)
    assert t["37902"] == [["TN", 2, 100]]
    assert t["37920"] == [["TN", 2, 70], ["TN", 3, 30]]
    assert t["05401"] == [["VT", 0, 100]]
    assert t["20001"] == [["DC", 0, 100]]


def test_passed():
    assert passed("Passed") and passed("Nomination Confirmed") and passed("Agreed to")
    assert not passed("Failed") and not passed("Cloture Motion Rejected") and not passed("Not Agreed to")


if __name__ == "__main__":  # run without pytest: python pipeline/tests/test_pipeline.py
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
