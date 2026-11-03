import json,statistics as st,sys
d=json.load(open(sys.argv[1]));P=json.load(open('plans.json'))
S={s['league']['season']:s for s in d['seasons']}
bad=0;cl=lu=lo=bl=0
for r in P:
    s=S[r['y']];rows=s['matchups'][str(r['w'])]
    g={}
    for x in rows:
        if x.get('matchup_id') is not None: g.setdefault(x['matchup_id'],[]).append(x['points'])
    games=[v for v in g.values() if len(v)==2]
    pts=[p for v in games for p in v]; pts.sort()
    med=pts[len(pts)//2]
    marg=[abs(a-b) for a,b in games]; win=[max(v) for v in games]
    played=[]
    for w in range(1,r['w']+1):
        gg={}
        for x in s['matchups'].get(str(w),[]):
            if x.get('matchup_id') is not None: gg.setdefault(x['matchup_id'],[]).append(x['points'])
        played+= [p for v in gg.values() if len(v)==2 for p in v]
    avg=sum(played)/len(played)
    if 'close' in r['keys']:
        cl+=1
        if min(marg)>10.005: bad+=1;print('close',r)
    if 'lucky' in r['keys']:
        lu+=1
        if min(win)>=med: bad+=1;print('lucky',r,min(win),med)
    if 'blowout' in r['keys']:
        bl+=1
        if max(marg)<24.995: bad+=1;print('blow',r)
    if 'low' in r['keys']:
        lo+=1
        if min(pts)>avg*.9+.01: bad+=1;print('low',r,min(pts),avg)
print('checked close',cl,'lucky',lu,'blowout',bl,'low',lo,'bad',bad)
s=S['2026'];own={r['roster_id']:r['owner_id'] for r in s['rosters']}
nm={u['user_id']:u['display_name'] for u in s['users']}
w8=s['matchups']['8']; pl=d['players']
for x in sorted(w8,key=lambda z:-z['points']):
    u=nm.get(own[x['roster_id']])
    print(u,x['points'],'m',x['matchup_id'])
    if u in('BentonPerret',):
        b=max(zip(x['starters_points'],x['starters']));print('  top starter',b,pl.get(b[1]))
    if u=='MattHuck21':
        for n in x['players_points']:
            nmn=pl.get(n,[n])[0]
            if 'Allgeier' in nmn or 'Jonathan Taylor' in nmn: print('  ',nmn,x['players_points'][n],'starter' if n in x['starters'] else 'bench')
for x in sorted(s['matchups'].keys(),key=int):
    pass
u=[r['roster_id'] for r in s['rosters'] if nm.get(r['owner_id'])=='BentonPerret'][0]
res=[]
for w in range(1,9):
    rows=s['matchups'][str(w)];me=[r for r in rows if r['roster_id']==u][0];op=[r for r in rows if r['matchup_id']==me['matchup_id'] and r['roster_id']!=u][0];res.append('W' if me['points']>op['points'] else 'L')
print('Benton',''.join(res))
