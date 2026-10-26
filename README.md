# WeHold — the power

**They hold office. We hold the power.**

WeHold shows any American how their two senators and their representative vote, how often they show up,
and how their record lines up with what the user believes — then helps them tell their officials where
they stand. It is independent and nonpartisan, and not affiliated with any government agency or political party.

## How it works

| Piece | What it does |
|---|---|
| `pipeline/` | Daily job (Python). Downloads every roll-call vote from the House Clerk and the Senate, the member roster from the public-domain [congress-legislators](https://github.com/unitedstates/congress-legislators) project, and the Census Bureau's ZIP-to-district table. |
| `data/rolls/` | Parsed roll calls, kept in the repo so each day only downloads what's new. |
| `curated/votes.json` | The editorial layer: which votes we highlight, plain-English summaries, stance questions. |
| `site/` | The web app (plain HTML/CSS/JS, no build step). Published with GitHub Pages. |
| `.github/workflows/` | Runs the pipeline every morning, checks it, commits new data and republishes the site. |

### Checks before anything is published

1. Every member's vote on every roll call is added up and must equal the official totals.
2. Senate votes must also match the tally on the Senate's own vote list.
3. Every highlighted vote and stance question must point at a real roll call.
4. Every vote must belong to a known member.

If any check fails, the run stops, the site keeps its last good data, and GitHub emails the repo owner.

### Attendance rules

- Counts every recorded roll call the member was eligible for in the current Congress.
- "Not Voting" = missed. "Present" = showed up.
- Members who join mid-term are counted from their first vote; departed members stop counting.
- The Speaker traditionally votes rarely; the site says so.

### Finding a user's officials

ZIP → district comes from the Census 119th-Congress/ZCTA relationship file. When a ZIP crosses
district lines (or is a PO-box ZIP with no ZCTA), the app asks for a street address and checks it with
the Census Geocoder directly from the browser. Addresses are never stored.

## Running it yourself

```bash
pip install -r pipeline/requirements.txt
python pipeline/tests/test_pipeline.py   # unit tests
python pipeline/build.py                 # full update (needs internet)
cd site && python -m http.server 8000    # then open http://localhost:8000
```

## When a new Congress starts (January 2027)

Update `config.json`: the Congress number, session years, next Election Day, and the ZIP relationship
file for the new district maps. Several states use new maps starting with the 120th Congress.

## Editorial rules for `curated/votes.json`

- Plain, neutral language. No loaded terms; no characterizing anyone's motives.
- Where the parties disagreed, give each side's main argument briefly and evenly.
- Add a `caution` when a single vote bundles unrelated issues.
- Stance questions must be answerable by someone of any party.

## License

Code: MIT. Vote and member data come from U.S. government records and the CC0 congress-legislators project.
