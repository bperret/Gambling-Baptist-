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
import re, math
calls = json.loads(re.sub(r'(\w+):', r'"\1":', re.search(r'const EX_CALLS = (\{.*?\});', src, re.S).group(1).replace('"2026"', '"S2026"')))['S2026']
avail = lambda pid, w: pid not in calls or w >= calls[pid]['back']
# Handcuff table (Nov 20): parse the entries straight from the source
def _objs(name):
    blk = re.search(r'const ' + name + r' = \{ "2026": \[(.*?)\] \};', src, re.S).group(1)
    out = []
    for m in re.finditer(r'\{([^{}]*)\}', blk):
        d = {}
        for k, v in re.findall(r'(\w+): ("[^"]*"|[\d.]+)', m.group(1)): d[k] = v.strip('"') if v.startswith('"') else float(v)
        out.append(d)
    return out
HCS, HCN = _objs('HANDCUFFS'), _objs('HC_NORM')
inr = lambda e, w: w >= e.get('from', 0) and w <= e.get('to', 99)
def hc_val(pid, w):
    nm = None
    for e in HCS:
        if e['cuff'] == pid and 'norm' in e and inr(e, w): nm = e['norm']
    for e in HCN:
        if e['pid'] == pid and inr(e, w): nm = e['norm']
    o = [e['out'] for e in HCS if e['cuff'] == pid and inr(e, w) and not avail(e['lead'], w)]
    return max(o) if o else nm
UF = pr['usage']['fields']; iT = UF.index('tgt'); iA = UF.index('att')
tt = {}; on = {}
for w in wk:
    for pid, r in U[str(w)].items():
        if not r or not r[0] or not (r[1] or 0) > 0: continue
        on.setdefault(r[0], set()).add(pid)
        if pos(pid) == 'QB': continue
        tt[(r[0], w)] = tt.get((r[0], w), 0) + (r[iT] or 0) + (r[iA] or 0)
pf = lambda pid, t: [w for w in wk if (U[str(w)].get(pid) or [0, 0])[1] and U[str(w)][pid][0] == t]
def share(pid, t):
    a = b = 0
    for w in pf(pid, t): r = U[str(w)][pid]; a += (r[iT] or 0) + (r[iA] or 0); b += tt.get((t, w), 0)
    return a / b if b else 0
cur = lambda pid: pid if pos(pid) == 'DEF' else P[pid][2]
def ctx(pid, w):
    ps = pos(pid); t = cur(pid)
    if ps not in ('QB', 'RB', 'WR', 'TE'): return 1
    mine = pf(pid, t)
    if len(mine) < 3: return 1
    pts = lambda x: A[str(x)].get(pid, 0); avg = S.mean(pts(x) for x in mine)
    if avg <= 0: return 1
    best = 1
    for q in on.get(t, ()):
        if q == pid or cur(q) != t: continue
        if pos(q) == 'QB':
            if q not in calls: continue
        elif pos(q) not in ('RB', 'WR', 'TE') or share(q, t) < 0.18: continue
        qs = set(pf(q, t)); wi = [x for x in mine if x in qs]; wo = [x for x in mine if x not in qs]
        if len(wi) < 2 or len(wo) < 2: continue
        L = wi if avail(q, w) else wo
        m = (sum(pts(x) for x in L) + 4 * avg) / (len(L) + 4); r = min(1.6, max(0.6, m / avg))
        if abs(math.log(r)) > abs(math.log(best)): best = r
    return best

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
            if not avail(pid, pw[k]): bad += 1; print('called-out player in lineup', pid)
            base = mu * ctx(pid, pw[k]) * fac(S_[t][0], ps) if mu is not None else e['wmu']
            fp = (pr.get('future') or {}).get(str(pw[k]), {}).get(pid)
            wm = (0.75 * base + 0.25 * fp) if (fp and fp > 0 and mu is not None) else base
            hv = hc_val(pid, pw[k])
            if hv is not None: wm = hv * fac(S_[t][0], ps)
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
