"""ZIP code -> congressional district lookup table.

Source: Census Bureau "119th Congressional District to 2020 ZCTA" relationship file.
ZCTAs (ZIP Code Tabulation Areas) approximate USPS ZIP codes. A ZIP that overlaps more than
one district lists every district with its share of land area, and the app then asks for a
street address (Census Geocoder) to pin down the right one. PO-box-only ZIPs have no ZCTA,
so the app falls back to the address lookup for those too.
"""
import csv
import io
import os

from common import SITE_DATA, fetch, write_json

FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
    "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
    "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
}


def district_from_geoid(geoid):
    """'4702' -> ('TN', 2). At-large '00' and delegate '98' both map to district 0."""
    st = FIPS.get(geoid[:2])
    cd = geoid[2:]
    if not st or not cd.isdigit():
        return None
    n = int(cd)
    return st, 0 if n in (0, 98) else n


def build_zip_table(text):
    rows = csv.DictReader(io.StringIO(text), delimiter="|")
    table = {}
    for row in rows:
        z = (row.get("GEOID_ZCTA5_20") or "").strip()
        g = (row.get("GEOID_CD119_20") or "").strip()
        if len(z) != 5 or not g:
            continue
        d = district_from_geoid(g)
        if not d:
            continue
        land = int(row.get("AREALAND_PART") or 0)
        table.setdefault(z, {}).setdefault(d, 0)
        table[z][d] += land
    out = {}
    for z, parts in table.items():
        total = sum(parts.values()) or 1
        lst = sorted(([st, n, round(100 * a / total)] for (st, n), a in parts.items()), key=lambda x: -x[2])
        # Drop slivers under 1% of the ZIP's land; they are usually boundary noise.
        kept = [x for x in lst if x[2] >= 1] or lst[:1]
        out[z] = kept
    return out


def update(cfg, log=print):
    raw = fetch(cfg["zipRelationshipUrl"]).decode("utf-8-sig")
    table = build_zip_table(raw)
    if len(table) < 30000:
        raise RuntimeError(f"ZIP table looks too small ({len(table)} ZIPs); refusing to publish it")
    shards = {}
    for z, v in table.items():
        shards.setdefault(z[0], {})[z] = v
    for k, v in shards.items():
        write_json(os.path.join(SITE_DATA, "zips", f"{k}.json"), v)
    split = sum(1 for v in table.values() if len(v) > 1)
    log(f"ZIPs: {len(table)} ZIP areas, {split} split across districts")
    return {"zips": len(table), "split": split}
