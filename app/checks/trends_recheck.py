#!/usr/bin/env python3
"""Recomputes Movers and with-and-without from raw data.json, with no app code, and compares with trends.json."""
import json,statistics
d=json.load(open('data.json'));o=json.load(open('trends.json'));U=d['projections']['usage'];F=U['fields'];P=d['players'];I=d.get('injuries') or {}
ix={f:i for i,f in enumerate(F)}
s=[x for x in d['seasons'] if x['league']['season']=='2026'][0]
pws=s['league']['settings'].get('playoff_week_start',15);last=s['league']['settings'].get('last_scored_leg',99)
regs=sorted(int(w) for w in s['matchups'] if int(w)<pws and int(w)<=last and U['weeks'].get(w))
pos=lambda p:(lambda x:'RB' if x=='FB' else x)(str((P.get(p) or ['',''])[1]).upper())
team={};L={}
for w in regs:
    for pid,a in U['weeks'][str(w)].items():
        g=a[ix['gp']];sn=a[ix['snp']] or 0
        if not g and not sn>0: continue
        tm=a[ix['team']] or '?';T=team.setdefault(w,{}).setdefault(tm,dict(tgt=0,att=0))
        T['tgt']+=a[ix['tgt']] or 0;T['att']+=a[ix['att']] or 0
        if pos(pid)=='QB':continue
        L.setdefault(pid,[]).append(dict(w=w,tm=tm,tgt=a[ix['tgt']] or 0,att=a[ix['att']] or 0,snp=sn,tsnp=a[ix['tsnp']] or 0))
for v in L.values(): v.sort(key=lambda x:x['w'])
def med(a):
    b=sorted(a);return b[(len(b)-1)//2] if b else 0
def exits(G):
    sn=[x['snp']/x['tsnp'] if x['tsnp'] else 0 for x in G]
    def low(i):
        m=med(sn[:i]+sn[i+1:]);return len(sn)>=4 and m>=.5 and sn[i]<m*.5
    return [G[i]['w'] for i in range(len(sn)) if low(i) and not(i>0 and low(i-1)) and not(i<len(sn)-1 and low(i+1))]
share=lambda A,f:(lambda q:sum(x[f] for x in A)/q if q else None)(sum(team[x['w']][x['tm']][f] for x in A))
BAR=dict(tgt=.05,att=.10);res={}
for pid,G in L.items():
    if pos(pid) not in('RB','WR','TE'):continue
    tm=G[-1]['tm'];tg=[w for w in regs if tm in team.get(w,{})];l3=tg[-3:];ex=exits(G)
    A=[x for x in G if x['tm']==tm and x['w'] not in ex];late=[x for x in A if x['w'] in l3];early=[x for x in A if x['w'] not in l3]
    if len(late)<2 or len(early)<2:continue
    best=None
    for f in (['att','tgt'] if pos(pid)=='RB' else ['tgt']):
        a,b=share(early,f),share(late,f)
        if a is None or b is None or abs(b-a)<BAR[f]:continue
        sc=abs(b-a)/BAR[f]
        if not best or sc>best[3]:best=(f,a,b,sc)
    if not best:continue
    f,a,b,_=best;up=b>a;W=late if up else early
    if sum(x['tgt']+x['att'] for x in W)/len(W)<4:continue
    gone=None
    if up:
        for q,Y in L.items():
            if q==pid or (f=='att' and pos(q)!='RB'):continue
            was=[x for x in Y if x['tm']==tm and x['w'] not in l3]
            if len(was)<2:continue
            sh=share(was,f)
            if sh is None or sh<.12:continue
            miss=[w for w in l3 if not any(x['w']==w and x['tm']==tm for x in Y)]
            if len(miss)>=2 and (gone is None or sh>gone[1]):gone=(q,sh)
    res[pid]=(f,a,b,gone[0] if gone else None)
bad=0
for m in o['ms']:
    r=res.get(m['pid'])
    if not r or r[0]!=m['f'] or abs(r[1]-m['a'])>1e-9 or abs(r[2]-m['b'])>1e-9 or r[3]!=((m.get('gone') or {}).get('pid')):
        bad+=1;print('DIFF',m['n'],r,m)
print('app movers',len(o['ms']),'recheck',len(res),'missing from app',[P[k][0] for k in res if k not in {m['pid'] for m in o['ms']}],'mismatches',bad)
