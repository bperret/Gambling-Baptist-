"""Measure 2026 teammate and opponent correlations in league scoring, from the export's actual points.

Usage: python3 checks/corr_calib.py data.json [src/app.js]

Each player's weekly points become z-scores against his own 2026 games (4+ games, a starter-level average).
Pairs are pooled by position pair and relation: same NFL team that week, or opponents that week.
Within a team, receivers are ranked WR1/WR2/WR3 and backs RB1/RB2 by season average.
With src/app.js, it prints the app's CORR table beside the measured values.
"""
import json, re, sys, math
from collections import defaultdict

d = json.load(open(sys.argv[1]))
P, pr = d["players"], d["projections"]
act, usage = pr["act"], pr["usage"]["weeks"]
src = open(sys.argv[2] if len(sys.argv) > 2 else "src/app.js").read()
sched = json.loads(re.search(r"const NFL26 = (\{.*?\});", src).group(1))

def games_of(w):
    opp = {}
    for g in sched.get(str(w), "").split():
        a, h = g.split("@"); opp[a] = h; opp[h] = a
    return opp

MIN = {"QB": 12, "RB": 7, "WR": 7, "TE": 5, "K": 5, "DEF": 3}
weeks = sorted(int(w) for w in act)
log = defaultdict(dict)  # pid -> {w: (team, pts)}
for w in weeks:
    opp = games_of(w); a = act[str(w)]; u = usage.get(str(w), {})
    for pid, v in a.items():
        meta = P.get(pid)
        if not meta: continue
        pos = meta[1]
        if pos in ("K", "DEF"):
            t = meta[2] if pos == "K" else pid
            if t in opp: log[pid][w] = (t, v)
        elif pos in ("QB", "RB", "WR", "TE"):
            x = u.get(pid)
            if x and x[1] and x[1] > 0 and x[0] in opp: log[pid][w] = (x[0], v)

stat = {}
for pid, g in log.items():
    v = [x[1] for x in g.values()]
    if len(v) < 4: continue
    m = sum(v) / len(v); sd = math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))
    pos = P[pid][1]
    if m < MIN[pos] or sd <= 0: continue
    stat[pid] = (m, sd, pos)

# Roles within team-week: WR1..3 and RB1..2 by season average
def role(pid, mates):
    m, sd, pos = stat[pid]
    if pos not in ("WR", "RB"): return pos
    same = sorted([q for q in mates if stat[q][2] == pos], key=lambda q: -stat[q][0])
    i = same.index(pid) + 1
    return pos + str(min(i, 3 if pos == "WR" else 2))

pairs = defaultdict(list)
for w in weeks:
    opp = games_of(w)
    byteam = defaultdict(list)
    for pid in stat:
        e = log[pid].get(w)
        if e: byteam[e[0]].append(pid)
    z = {pid: (log[pid][w][1] - stat[pid][0]) / stat[pid][1] for t in byteam for pid in byteam[t]}
    for t, ps in byteam.items():
        rl = {pid: role(pid, ps) for pid in ps}
        for i in range(len(ps)):
            for j in range(i + 1, len(ps)):
                a, b = ps[i], ps[j]
                key = tuple(sorted((stat[a][2], stat[b][2])))
                pairs[("same",) + key].append((z[a], z[b]))
                rk = tuple(sorted((rl[a], rl[b])))
                if rk != key: pairs[("same",) + rk].append((z[a], z[b]))
        o = opp.get(t)
        if o and t < o:
            for a in ps:
                for b in byteam.get(o, []):
                    key = tuple(sorted((stat[a][2], stat[b][2])))
                    pairs[("opp",) + key].append((z[a], z[b]))

def corr(xy):
    n = len(xy)
    if n < 3: return None
    mx = sum(x for x, _ in xy) / n; my = sum(y for _, y in xy) / n
    sxy = sum((x - mx) * (y - my) for x, y in xy); sx = math.sqrt(sum((x - mx) ** 2 for x, _ in xy)); sy = math.sqrt(sum((y - my) ** 2 for _, y in xy))
    return sxy / (sx * sy) if sx and sy else None

app = {}
m = re.search(r"const CORR_PRIOR = (\{.*?\});", src, re.S)
if m: app = json.loads(m.group(1))
print(f"weeks {weeks[0]}-{weeks[-1]}, players {len(stat)}")
print(f"{'relation':6} {'pair':10} {'n':>5} {'r':>6} {'se':>5}  prior")
out = {}
for k in sorted(pairs, key=lambda k: (k[0], k[1], k[2])):
    r = corr(pairs[k]); n = len(pairs[k])
    if r is None: continue
    key = k[0] + ":" + k[1] + "-" + k[2]
    out[key] = {"n": n, "r": round(r, 3)}
    pv = app.get(key)
    print(f"{k[0]:6} {k[1]+'-'+k[2]:10} {n:5d} {r:6.3f} {1/math.sqrt(max(n-3,1)):5.3f}  {'' if pv is None else pv}")
json.dump(out, open("checks/corr_measured.json", "w"), indent=1, sort_keys=True)
