#!/usr/bin/env python3
# FantasyPros ROS ECR import. Usage: python3 ecr.py ecr.csv week.json
# Adds sources.ecr to the week file and sets weights: ECR 50%, the other two sources 25% each.
import csv, json, re, sys
TEAM = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR"}
src, out = sys.argv[1], sys.argv[2]
rows = []
with open(src, newline="") as f:
    for r in csv.DictReader(f):
        rk = (r.get("RK") or "").strip()
        if not rk.isdigit(): continue
        pos = re.sub(r"\d+$", "", r["POS"].strip())
        pos = "DEF" if pos == "DST" else pos
        team = TEAM.get(r["TEAM"].strip(), r["TEAM"].strip())
        m = re.match(r"(\d) out of 5", r.get("SOS PLAYOFFS") or "")
        rows.append({"name": r["PLAYER NAME"].strip(), "pos": pos, "team": "" if team == "FA" else team,
                     "rk": int(rk), "v": 1000 - int(rk), "sosPO": int(m.group(1)) if m else None})
ranks = [x["rk"] for x in rows]
assert ranks == sorted(ranks) and len(set(ranks)) == len(ranks), "ranks out of order"
wk = json.load(open(out))
wk["sources"]["ecr"] = {"name": "FantasyPros ECR", "kind": "rank", "w": 0.5, "rows": rows}
for k in wk["sources"]:
    if k != "ecr": wk["sources"][k]["w"] = 0.25
json.dump(wk, open(out, "w"), indent=0)
print(len(rows), "ECR rows;", sum(1 for x in rows if x["pos"] in ("K", "DEF")), "K/DEF")
