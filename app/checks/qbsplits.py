#!/usr/bin/env python3
"""Recomputes QB splits from raw data.json, with no app code, and compares with qbsplits.json from checks/qbsplits.js."""
import json
d=json.load(open('data.json'));o=json.load(open('qbsplits.json'));U=d['projections']['usage'];F=U['fields'];P=d['players'];ix={f:i for i,f in enumerate(F)}
s=[x for x in d['seasons'] if x['league']['season']=='2026'][0];pws=s['league']['settings'].get('playoff_week_start',15);last=s['league']['settings'].get('last_scored_leg',99)
regs=sorted(int(w) for w in s['matchups'] if int(w)<pws and int(w)<=last and U['weeks'].get(w))
pos=lambda p:(lambda x:'RB' if x=='FB' else x)(str((P.get(p) or ['',''])[1]).upper())
T={};L={}
for w in regs:
    for pid,a in U['weeks'][str(w)].items():
        if not a[ix['gp']] and not (a[ix['snp']] or 0)>0: continue
        tm=a[ix['team']] or '?';t=T.setdefault(tm,{}).setdefault(w,dict(tgt=0,q=[]));t['tgt']+=a[ix['tgt']] or 0
        if pos(pid)=='QB':
            if (a[ix['patt']] or 0)>0:t['q'].append((a[ix['patt']],pid))
        else: L.setdefault(pid,[]).append((w,tm,a[ix['tgt']] or 0))
bad=n=0
for tm,R in o.items():
    by={}
    for w,t in T[tm].items():
        q=sorted(t['q'],key=lambda x:-x[0])
        if not q or (len(q)>1 and q[1][0]>=10):continue
        by.setdefault(q[0][1],[]).append(w)
    assert sorted(R['qbs'])==sorted(k for k,v in by.items() if len(v)>=2) or len([k for k,v in by.items() if len(v)>=2])>3,(tm,R['qbs'])
    for r in R['rows']:
        for qb,c in zip(R['qbs'],r['cells']):
            G=[x for x in L[r['pid']] if x[1]==tm and x[0] in by[qb]];n+=1
            e=(sum(x[2] for x in G)/sum(T[tm][x[0]]['tgt'] for x in G)) if len(G)>=2 else None
            if (e is None)!=(c is None) or (e is not None and abs(e-c)>1e-9):bad+=1;print('DIFF',tm,r,qb,e,c)
print('teams',len(o),'cells',n,'mismatches',bad)
