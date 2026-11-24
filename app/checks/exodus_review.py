# Weekly playoff review for Benton (run at every trade value update, before publishing):
# injured starters in Exodus lineups ranked by playoff points, current commissioner's calls, and teammate adjustments of 1+ point.
import json, sys, re
d = json.load(open(sys.argv[1])); X = json.load(open(sys.argv[2])); P = d['players']; I = d['injuries']
NICK = dict(re.findall(r'(\w+): "([^"]+)"', re.search(r'const NICK = \{(.*?)\}', open('src/app.js').read()).group(1)))
s = next(x for x in d['seasons'] if x['league']['status'] != 'complete')
own = {u['user_id']: NICK.get(u['display_name'], u['display_name']) for u in s['users']}
nm = lambda pid: (P.get(pid) or [pid])[0]
agg = {}
for r in X['rows']:
    for k, lu in enumerate(r['lu']):
        for e in lu:
            st = (I.get(e['pid']) or {}).get('s')
            if not st: continue
            a = agg.setdefault(e['pid'], {'uid': r['uid'], 'st': st, 'w': [None] * 3, 'po': r['sim']['po']})
            a['w'][k] = e['wmu']
print('INJURED STARTERS (playoff points, Weeks %s)' % '/'.join(map(str, X['pw'])))
for i, (pid, a) in enumerate(sorted(agg.items(), key=lambda x: -sum(v or 0 for v in x[1]['w'])), 1):
    grey = '  [team under 1% playoff odds]' if a['po'] < 0.01 else ''
    print(f"{i:2}. {nm(pid)} ({a['st']}) {own[a['uid']]}: {sum(v or 0 for v in a['w']):.1f} = {' / '.join('-' if v is None else f'{v:.1f}' for v in a['w'])}{grey}")
calls = re.search(r'const EX_CALLS = (\{.*?\} \});', open('src/app.js').read(), re.S).group(1)
print('\nCOMMISSIONER CALLS:', calls)
print('\nTEAMMATE ADJUSTMENTS (1+ point)')
for r in X['rows']:
    for k, lu in enumerate(r['lu']):
        for e in lu:
            c = e.get('ctx')
            if not c: continue
            d0 = e['wmu'] - e['wmu'] / c['r']
            if abs(d0) >= 1: print(f"  {own[r['uid']]} Wk {X['pw'][k]}: {nm(e['pid'])} {'with' if c['on'] else 'without'} {nm(c['q'])} ({c['raw']:.1f} in {c['n']} games), {d0:+.1f}")

print('\nTEAMMATE ADJUSTMENTS THAT LEAN ON AN INJURED TEAMMATE (no call set: counted as playing)')
callids = set(re.findall(r'"(\d+)": \{ back', calls))
seen = set()
for r in X['rows']:
    for k, lu in enumerate(r['lu']):
        for e in lu:
            c = e.get('ctx')
            if not c or c['q'] in callids: continue
            st = (I.get(c['q']) or {}).get('s')
            if not st: continue
            key = (e['pid'], c['q'])
            if key in seen: continue
            seen.add(key)
            print(f"  {own[r['uid']]}: {nm(e['pid'])} uses {'with' if c['on'] else 'without'} {nm(c['q'])} ({st}), {(c['r']-1)*100:+.0f}%")
