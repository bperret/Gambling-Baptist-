# Recompute Exodus matchup factors, player week means (less Workload points, which come from the app's fit), and lineup totals from raw data, without app code.
import json, sys, csv, statistics as S
d = json.load(open(sys.argv[1])); X = json.load(open(sys.argv[2]))
pr = d['projections']; A = pr['act']; U = pr['usage']['weeks']; P = d['players']
src = open('src/app.js').read(); i = src.index('const NFL26 = ') + 14; NFL = json.loads(src[i:src.index(';', i)])
def wkmap(w):
    m = {}
    for g in NFL[str(w)].split(' '):
        a, h = g.split('@'); m[a] = (h, False); m[h] = (a, True)
    return m
POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
pos = lambda pid: ('RB' if (P.get(pid) or ['', ''])[1] == 'FB' else (P.get(pid) or ['', ''])[1])
last = X['lastW']; wk = sorted(int(w) for w in A if int(w) <= last)
played = {}
for w, rows in U.items():
    for r in rows.values():
        if r and r[0]: played.setdefault(r[0], set()).add(int(w))
def tm(pid, w):
    ps = pos(pid)
    if ps in ('K', 'DEF'):
        t = pid if ps == 'DEF' else P[pid][2]
        return t if w in played.get(t, ()) else None
    u = U.get(str(w), {}).get(pid)
    return u[0] if u and u[1] > 0 else None
allow = {}
for w in wk:
    S_ = wkmap(w); tot = {}
    for pid, v in A[str(w)].items():
        ps = pos(pid)
        if ps not in POS: continue
        t = tm(pid, w)
        if not t or t not in S_: continue
        tot[(S_[t][0], ps)] = tot.get((S_[t][0], ps), 0) + v
    for t, (o, _) in S_.items():
        if w not in played.get(t, ()): continue
        for ps in POS: allow.setdefault((o, ps), []).append(tot.get((o, ps), 0))
avg = {ps: S.mean([v for (o, p), L in allow.items() if p == ps for v in L]) for ps in POS}
def fac(o, ps):
    L = allow.get((o, ps)); raw = S.mean(L) / avg[ps]; n = len(L)
    return min(1.2, max(0.8, 1 + (raw - 1) * n / (n + 8)))
bad = 0
for ps in POS:
    if abs(avg[ps] - X['posAvg'][ps]) > 1e-6: bad += 1; print('posAvg', ps, avg[ps], X['posAvg'][ps])
pw = X['pw']; checked = 0
for r in X['rows']:
    for k, lu in enumerate(r['lu']):
        S_ = wkmap(pw[k]); tot = 0
        for e in lu:
            pid = e['pid']; ps = pos(pid)
            g = [A[str(w)].get(pid, 0) for w in wk if tm(pid, w)]
            n = len(g); own = S.mean(g) if n else 0
            num, den = n * own, n
            if e['wx'] is not None: num += 3 * e['wx']; den += 3
            pj = pr['pts'].get(pid)
            if pj and pj > 0: num += 2 * pj; den += 2
            mu = max(0.5, num / den) if den else None
            t = pid if ps == 'DEF' else P[pid][2]
            wm = mu * fac(S_[t][0], ps) if mu is not None else e['wmu']
            if mu is not None and abs(mu - e['mu']) > 1e-6: bad += 1; print('mu', pid, mu, e['mu'])
            if abs(wm - e['wmu']) > 1e-6: bad += 1; print('wmu', pid, wm, e['wmu'])
            if S_[t][0] != e['opp']: bad += 1; print('opp', pid)
            tot += wm; checked += 1
        if abs(tot - r['tot'][k]) > 1e-4: bad += 1; print('tot', r['uid'], k, tot, r['tot'][k])
# Title odds add to 1, finals to 2, byes to 2, playoffs to 6
s = X['rows']; sm = lambda f: sum(r['sim'][f] for r in s)
for f, want in (('title', 1), ('fin', 2), ('bye', 2), ('po', 6)):
    if abs(sm(f) - want) > 1e-9: bad += 1; print('sum', f, sm(f))
print('player-weeks checked', checked, 'bad', bad)
print('posAvg', {k: round(v, 2) for k, v in avg.items()})
