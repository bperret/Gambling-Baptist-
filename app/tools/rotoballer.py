#!/usr/bin/env python3
"""RotoBaller rest-of-season PPR rankings import. Usage: python3 tools/rotoballer.py roto.csv week.json
Use the ROS file: it lists every position on one overall scale and keeps teams on a bye.
The one-week file leaves bye teams out and lists QBs after everyone else, so it does not fit."""
import csv, json, sys
roto, out = sys.argv[1:3]
TEAM = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR"}
R = [r for r in csv.DictReader(open(roto, newline="")) if r["Pos"] in ("QB", "RB", "WR", "TE")]
assert any(r["Opp"] == "BYE" for r in R), "no bye team listed: this looks like the one-week file"
rows = [{"name": r["Player"].strip(), "pos": r["Pos"], "team": TEAM.get(r["Team"], r["Team"]), "rk": int(r["RK"]), "v": 1000 - int(r["RK"])} for r in R]
assert [x["rk"] for x in rows] == sorted(x["rk"] for x in rows), "ranks out of order"
wk = json.load(open(out))
wk["sources"]["rotoballer"] = {"name": "RotoBaller", "kind": "rank", "w": 0.25, "rows": rows}
json.dump(wk, open(out, "w"), indent=0)
print(len(rows), "rows; first QB at", next(x["rk"] for x in rows if x["pos"] == "QB"))
