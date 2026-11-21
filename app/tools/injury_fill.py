"""Locked model inputs for injuries and fill-in players (Benton, Nov 20 2026). Run once; the output is pasted into src/app.js.

Usage: python3 -I tools/injury_fill.py NFLVERSE_DIR data.json
NFLVERSE_DIR holds nflverse files for 2023-2025: stats_YYYY.csv (stats_player_week), injuries_YYYY.csv, roster_YYYY.csv (roster_weekly).
Download: https://github.com/nflverse/nflverse-data/releases/download/{stats_player,injuries,weekly_rosters}/...

Injuries, by position (QB, RB, WR, TE), fantasy-relevant players only (4+ games, PPR average QB 12, RB 8, WR 8, TE 6):
  hazard = chance that a player who played a game misses his team's next game hurt (Out or Doubtful on the report, or on reserve).
  games missed = consecutive team games missed hurt (byes skipped). A spell still running at Week 18 is cut off, so the
  distribution uses Kaplan-Meier: P(out more than d games) from all spells, cut-off ones counted only while observed.
  A missed game with no injury listing (healthy scratch, suspension, personal) is not an injury and ends nothing.
Fill-in player, by position: per-game average in league scoring of the players ranked just past what a 12-team league rosters
  (ranks N+1 to N+5 by per-game average, 4+ games), averaged over 2023-2025. Defenses come from 2026 league games (nflverse has
  no defense scoring in these files).
"""
import csv, sys, os, json, statistics as st, collections

D, DATA = sys.argv[1], sys.argv[2]
POS = ("QB", "RB", "WR", "TE")
MIN = {"QB": 12, "RB": 8, "WR": 8, "TE": 6}
ROSTERED = {"QB": 18, "RB": 52, "WR": 59, "TE": 21, "K": 12, "DEF": 16}  # 2026 league rosters, Nov 20 (K: one per team)
SC = json.load(open(DATA))
season26 = [x for x in SC["seasons"] if x["league"]["season"] == "2026"][0]
S = season26["league"]["scoring_settings"]
f = lambda r, k: float(r.get(k) or 0)

def pts(r):
    p = r["position"]
    v = (f(r, "passing_yards") * S.get("pass_yd", 0) + f(r, "passing_tds") * S.get("pass_td", 0) + f(r, "passing_interceptions") * S.get("pass_int", 0)
         + f(r, "passing_first_downs") * S.get("pass_fd", 0) + f(r, "passing_2pt_conversions") * S.get("pass_2pt", 0)
         + f(r, "rushing_yards") * S.get("rush_yd", 0) + f(r, "rushing_tds") * S.get("rush_td", 0) + f(r, "rushing_first_downs") * S.get("rush_fd", 0)
         + f(r, "rushing_2pt_conversions") * S.get("rush_2pt", 0)
         + f(r, "receptions") * S.get("rec", 0) + f(r, "receiving_yards") * S.get("rec_yd", 0) + f(r, "receiving_tds") * S.get("rec_td", 0)
         + f(r, "receiving_first_downs") * S.get("rec_fd", 0) + f(r, "receiving_2pt_conversions") * S.get("rec_2pt", 0)
         + (f(r, "sack_fumbles_lost") + f(r, "rushing_fumbles_lost") + f(r, "receiving_fumbles_lost")) * S.get("fum_lost", 0)
         + f(r, "special_teams_tds") * S.get("st_td", 0))
    if p == "K":
        v = (f(r, "fg_made_0_19") * S.get("fgm_0_19", 0) + f(r, "fg_made_20_29") * S.get("fgm_20_29", 0) + f(r, "fg_made_30_39") * S.get("fgm_30_39", 0)
             + f(r, "fg_made_40_49") * S.get("fgm_40_49", 0) + f(r, "fg_made_50_59") * S.get("fgm_50_59", 0) + f(r, "fg_made_60_") * S.get("fgm_60p", 0)
             + f(r, "fg_missed") * S.get("fgmiss", 0) + f(r, "pat_made") * S.get("xpm", 0) + f(r, "pat_missed") * S.get("xpmiss", 0))
    return v

haz = {p: {"games": 0, "inj": 0} for p in POS}
spells = {p: [] for p in POS}   # (games missed, finished?)
diag = collections.Counter()
fill = {p: [] for p in POS + ("K",)}
for y in (2023, 2024, 2025):
    rows = [r for r in csv.DictReader(open(os.path.join(D, f"stats_{y}.csv"))) if r["season_type"] == "REG"]
    played = {}; teamgames = collections.defaultdict(set); g = collections.defaultdict(list); pos = {}
    for r in rows:
        w = int(r["week"]); teamgames[r["team"]].add(w); played[(r["player_id"], w)] = r["team"]
        if r["position"] in POS + ("K",):
            pos[r["player_id"]] = r["position"]; g[r["player_id"]].append(pts(r))
    # Fill-in: ranks N+1..N+5 by per-game average
    for p in POS + ("K",):
        L = sorted((st.mean(v) for k, v in g.items() if pos[k] == p and len(v) >= 4), reverse=True)
        n = ROSTERED[p]; fill[p].append(st.mean(L[n:n + 5]))
    rel = {k for k, v in g.items() if pos[k] in POS and len(v) >= 4 and st.mean(v) >= MIN[pos[k]]}
    inj = {(r["gsis_id"], int(r["week"])): r["report_status"] for r in csv.DictReader(open(os.path.join(D, f"injuries_{y}.csv"))) if r["game_type"] == "REG"}
    ros = {(r["gsis_id"], int(r["week"])): (r["team"], r["status"]) for r in csv.DictReader(open(os.path.join(D, f"roster_{y}.csv"))) if r["game_type"] == "REG"}
    for k in rel:
        P = pos[k]; seq = []
        for w in range(1, 19):
            t = played.get((k, w)) or (ros.get((k, w)) or (None,))[0]
            if not t or w not in teamgames[t]: continue
            if (k, w) in played: seq.append("P")
            elif inj.get((k, w)) in ("Out", "Doubtful") or (ros.get((k, w)) or (None, ""))[1] == "RES": seq.append("I")
            else: seq.append("X")
        for i in range(len(seq) - 1):
            if seq[i] == "P": diag["P->" + seq[i + 1]] += 1
        for i, s in enumerate(seq):
            if s != "P" or i + 1 >= len(seq): continue
            haz[P]["games"] += 1
            if seq[i + 1] != "I": continue
            haz[P]["inj"] += 1
            j = i + 1
            while j < len(seq) and seq[j] == "I": j += 1
            spells[P].append((j - (i + 1), j < len(seq)))

def km(sp, cap=12):
    # P(duration = d) for d = 1..cap-1, and the rest at cap ("rest of season")
    S, out, prev = 1.0, [], 1.0
    for d in range(1, cap):
        at_risk = sum(1 for n, _ in sp if n >= d)
        ended = sum(1 for n, fin in sp if n == d and fin)
        if at_risk: S *= 1 - ended / at_risk
        out.append(prev - S); prev = S
    out.append(prev)
    return [round(x, 4) for x in out]

# Smoothing: 60 to 125 spells per position is lumpy, so games missed go in ranges (1, 2, 3-4, 5-8, 9+ = rest of the
# fantasy season), each position pulled toward all four positions together with 100 spells of weight, and spread evenly inside a range.
BINS = [(1, 1), (2, 2), (3, 4), (5, 8), (9, 12)]
def binned(dist): return [sum(dist[a - 1:b]) for a, b in BINS]
pooled = binned(km([x for p in POS for x in spells[p]]))
print("pooled ranges 1, 2, 3-4, 5-8, 9+:", [round(x, 3) for x in pooled])
def smooth(p):
    n = len(spells[p]); b = binned(km(spells[p]))
    m = [(n * x + 100 * y) / (n + 100) for x, y in zip(b, pooled)]
    out = []
    for (a, z), q in zip(BINS[:-1], m[:-1]): out += [q / (z - a + 1)] * (z - a + 1)
    return [round(x, 4) for x in out + [m[-1]]]   # 1..8 games, then rest of season
res = {"inj": {}, "fill": {}}
for p in POS:
    dist = km(spells[p]); mean_km = sum((i + 1) * q for i, q in enumerate(dist))
    sm = smooth(p)
    res["inj"][p] = {"h": round(haz[p]["inj"] / haz[p]["games"], 4), "d": sm}
    print("   smoothed P(out 1..8 games, rest of season):", sm, "ranges", [round(x, 3) for x in binned(dist)])
    print(f"{p}: games {haz[p]['games']}, injuries {haz[p]['inj']}, hazard {haz[p]['inj'] / haz[p]['games']:.4f}, "
          f"spells cut off {sum(1 for _, fin in spells[p] if not fin)}/{len(spells[p])}, KM mean (12 = rest of season) {mean_km:.2f}")
    print("   P(out 1..11, 12+):", dist)
for p in POS + ("K",):
    res["fill"][p] = round(st.mean(fill[p]), 1); print(f"fill {p}: by season {[round(x, 1) for x in fill[p]]} -> {res['fill'][p]}")
# Defenses from 2026 league games
A = SC["projections"]["act"]; Pl = SC["players"]
dg = collections.defaultdict(list)
for w, a in A.items():
    for pid, v in a.items():
        if (Pl.get(pid) or ["", ""])[1] == "DEF" and v != 0: dg[pid].append(v)
L = sorted((st.mean(v) for v in dg.values() if len(v) >= 4), reverse=True)
res["fill"]["DEF"] = round(st.mean(L[ROSTERED["DEF"]:ROSTERED["DEF"] + 5]), 1); print("fill DEF (2026 league games):", res["fill"]["DEF"])
print("diagnostic, what follows a played game:", dict(diag))
print(json.dumps(res))
