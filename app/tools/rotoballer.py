#!/usr/bin/env python3
"""RotoBaller PPR rankings import. Usage: python3 tools/rotoballer.py roto.csv ecr.csv week.json
The file ranks RB, WR, and TE first and lists every QB after them, so its overall rank says nothing about QBs.
K and DST are dropped. RotoBaller's QB order goes into the overall slots where FantasyPros ECR puts its top QBs."""
import csv, json, sys
roto, ecr, out = sys.argv[1:4]
R = [r for r in csv.DictReader(open(roto, newline=""))]
skill = [r for r in R if r["Pos"] in ("RB", "WR", "TE")]
qbs = [r for r in R if r["Pos"] == "QB"]
assert [int(r["RK"]) for r in skill] == sorted(int(r["RK"]) for r in skill)
E_ = [r for r in csv.DictReader(open(ecr, newline="")) if (r.get("RK") or "").strip().isdigit() and not r["POS"].startswith(("K", "DST"))]
slots = [i for i, r in enumerate(E_) if r["POS"].startswith("QB")][:len(qbs)]
n = len(skill) + len(qbs); merged = [None] * n
q = iter(qbs); s = iter(skill)
for i in slots:
    if i < n: merged[i] = next(q)
for i in range(n):
    if merged[i] is None:
        merged[i] = next(s, None) or next(q)
rows = [{"name": r["Player"].strip(), "pos": r["Pos"], "team": "" if r["Team"] in ("FA", "") else r["Team"], "rk": i + 1, "v": 1000 - (i + 1)} for i, r in enumerate(merged)]
wk = json.load(open(out)); wk["sources"]["rotoballer"]["rows"] = rows; json.dump(wk, open(out, "w"), indent=0)
print(len(rows), "rows;", len(qbs), "QBs, first at", [r["rk"] for r in rows if r["pos"] == "QB"][:4], "from raw rank", qbs[0]["RK"])
