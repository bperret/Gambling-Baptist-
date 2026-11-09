"""Test data for the Monday Night Vigil. Not real.
Week 9 pairings from the schedule, Week 8 lineups and points. Bills and Vikings players have not played.
One leader's played starter is zeroed and tagged Out, so a lineup confession shows.
Usage: python3 checks/vigil_fixture.py data.json sim/data.json [ISO time of the export]"""
import json, sys, copy
src, dst = sys.argv[1], sys.argv[2]
at = sys.argv[3] if len(sys.argv) > 3 else "2026-11-09T22:00:00Z"
d = json.load(open(src))
s = [x for x in d["seasons"] if x["league"]["season"] == d["state"]["season"]][0]
wk = str(max(map(int, s["matchups"])))
nxt = str(int(wk) + 1)
pair = {r["roster_id"]: r["matchup_id"] for r in s["schedule"][nxt]}
P, LEFT = d["players"], {"BUF", "MIN"}
team = lambda pid: (P.get(pid) or ["", "", ""])[2] if (P.get(pid) or ["", ""])[1] != "DEF" else pid
rows = []
for r in s["matchups"][wk]:
    r = copy.deepcopy(r); r["matchup_id"] = pair[r["roster_id"]]
    pp = r.get("players_points") or {}
    for pid in list(pp):
        if team(pid) in LEFT: pp[pid] = 0
    r["starters_points"] = [0 if team(p) in LEFT else (r["starters_points"][i] or 0) for i, p in enumerate(r["starters"])]
    r["points"] = round(sum(r["starters_points"]), 2)
    rows.append(r)
teams = {}
for w in d["projections"]["usage"]["weeks"][wk].values():
    if w[0]: teams[w[0]] = {"opp": None, "date": None, "left": False}
teams["BUF"] = {"opp": "MIN", "date": "2026-11-09", "left": True}
teams["MIN"] = {"opp": "BUF", "date": "2026-11-09", "left": True}
# Lineup confession: the leader of the closest game that is still live zeroes a played WR tagged Out
inj = d.setdefault("injuries", {})
by = {}
for r in rows: by.setdefault(r["matchup_id"], []).append(r)
done = False
for a, b in sorted(by.values(), key=lambda p: abs(p[0]["points"] - p[1]["points"])):
    lead, trail = (a, b) if a["points"] >= b["points"] else (b, a)
    if not any(team(p) in LEFT for p in trail["starters"]): continue
    for i, pid in enumerate(lead["starters"]):
        pos = (P.get(pid) or ["", ""])[1]
        if pos == "WR" and team(pid) not in LEFT and lead["starters_points"][i] < 12:
            bench = [p for p in lead["players"] if p not in lead["starters"] and (P.get(p) or ["", ""])[1] in ("WR", "RB", "TE") and team(p) not in LEFT and lead["players_points"].get(p, 0) >= 5]
            if not bench: continue
            lead["players_points"][pid] = 0; lead["starters_points"][i] = 0
            lead["points"] = round(sum(lead["starters_points"]), 2)
            inj[pid] = {"s": "Out", "pr": None}
            print("confession:", lead["roster_id"], P[pid][0]); done = True; break
    if done: break
d["live"] = {"week": int(nxt), "at": at, "statsOk": True, "rows": rows, "teams": teams, "pteam": {}, "test": True}
json.dump(d, open(dst, "w"))
print("live rows", len(rows), "week", nxt)
