"""League-wide handcuff rule from nflverse 2023-2025: when a team's lead RB misses a game hurt, how much do RB2 and RB3 gain?
Lead RB = most carries that season (8+ games). RB2/RB3 = next most carries in games the lead played. Points in league scoring.
alpha = (backup's average without the lead - with the lead) / lead's average with him."""
import csv, json, os, sys, statistics as st, collections
D, DATA = sys.argv[1], sys.argv[2]
S = [x for x in json.load(open(DATA))["seasons"] if x["league"]["season"] == "2026"][0]["league"]["scoring_settings"]
f = lambda r, k: float(r.get(k) or 0)
def pts(r):
    return (f(r, "rushing_yards") * S.get("rush_yd", 0) + f(r, "rushing_tds") * S.get("rush_td", 0) + f(r, "rushing_first_downs") * S.get("rush_fd", 0)
            + f(r, "receptions") * S.get("rec", 0) + f(r, "receiving_yards") * S.get("rec_yd", 0) + f(r, "receiving_tds") * S.get("rec_td", 0)
            + f(r, "receiving_first_downs") * S.get("rec_fd", 0) + (f(r, "rushing_fumbles_lost") + f(r, "receiving_fumbles_lost")) * S.get("fum_lost", 0))
res = {2: [], 3: []}
for y in (2023, 2024, 2025):
    rows = [r for r in csv.DictReader(open(os.path.join(D, f"stats_{y}.csv"))) if r["season_type"] == "REG" and r["position"] == "RB"]
    inj = {(r["gsis_id"], int(r["week"])): r["report_status"] for r in csv.DictReader(open(os.path.join(D, f"injuries_{y}.csv"))) if r["game_type"] == "REG"}
    ros = {(r["gsis_id"], int(r["week"])): r["status"] for r in csv.DictReader(open(os.path.join(D, f"roster_{y}.csv"))) if r["game_type"] == "REG"}
    by = collections.defaultdict(dict); car = collections.defaultdict(lambda: collections.Counter()); teamweeks = collections.defaultdict(set)
    for r in rows:
        t, w, p = r["team"], int(r["week"]), r["player_id"]; by[t].setdefault(w, {})[p] = pts(r); car[t][p] += f(r, "carries"); teamweeks[t].add(w)
    for t, c in car.items():
        lead = c.most_common(1)[0][0]
        lw = {w for w in teamweeks[t] if lead in by[t][w]}
        if len(lw) < 8: continue
        out = [w for w in teamweeks[t] if lead not in by[t][w] and (inj.get((lead, w)) in ("Out", "Doubtful") or ros.get((lead, w)) == "RES")]
        if not out: continue
        bc = collections.Counter({p: sum(1 for w in lw if p in by[t][w]) * 0 + sum(by_c for by_c in [0]) for p in []})
        # backups ranked by carries in the lead's games
        cc = collections.Counter()
        for r in rows:
            if r["team"] == t and int(r["week"]) in lw and r["player_id"] != lead: cc[r["player_id"]] += f(r, "carries")
        lead_avg = st.mean(by[t][w][lead] for w in lw)
        for rank, (p, _) in enumerate(cc.most_common(2), start=2):
            wi = [by[t][w].get(p, 0) for w in lw if p in by[t][w]]; wo = [by[t][w].get(p, 0) for w in out if p in by[t][w]]
            if len(wi) < 3 or not wo: continue
            res[rank].append(((st.mean(wo) - st.mean(wi)) / lead_avg, len(wo), st.mean(wi), st.mean(wo), lead_avg))
for k, v in res.items():
    n = sum(x[1] for x in v); a = sum(x[0] * x[1] for x in v) / n
    print(f"RB{k}: cases {len(v)}, games without the lead {n}, alpha (share of the lead's points gained) {a:.3f}, "
          f"median {st.median(x[0] for x in v):.3f}; avg with {st.mean(x[2] for x in v):.1f} -> without {st.mean(x[3] for x in v):.1f}, lead avg {st.mean(x[4] for x in v):.1f}")
