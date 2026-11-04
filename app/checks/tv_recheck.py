#!/usr/bin/env python3
"""Recomputes the trade value blend for the last two weeks from values.json, with no app code, and compares with tvdump.json."""
import json,math,re
V=json.load(open('values.json'))['weeks'];o=json.load(open('tvdump.json'))
norm=lambda n:re.sub(r'\s+',' ',re.sub(r'\b(jr|sr|ii|iii|iv|v)\b','',re.sub(r"[.'’\-]",'',n.lower()))).strip()
ALIAS={'bam knight':'zonovan knight','hollywood brown':'marquise brown','chig okonkwo':'chig okonkwo'}
key=lambda n:(lambda k:ALIAS.get(k,k))(norm(n))
def blend(w):
    S=w['sources'];L={k:len(s['rows']) for k,s in S.items()};R={}
    for k,s in S.items():
        rows=sorted(s['rows'],key=lambda r:-r['v']);i=0
        while i<len(rows):
            j=i
            while j+1<len(rows) and rows[j+1]['v']==rows[i]['v']:j+=1
            for r in rows[i:j+1]:R.setdefault(key(r['name']) if r['pos'] not in('DEF','K') else key(r['name'])+'|'+r['pos'],{})[k]=(i+j)/2+1
            i=j+1
    W={k:(s.get('w') if s.get('w') is not None else 1) for k,s in S.items()};T=sum(W.values())
    return {n:sum(W[k]*x.get(k,L[k]+1) for k in S)/T for n,x in R.items()},{k:round(W[k]/T,4) for k in S},L
curve=lambda r:100*math.exp(-0.03605*max(0,r-1)**0.8665)
for tag,w,D in (('now',V[-1],o['now']),('prev',V[-2],o['prev'])):
    c,sh,L=blend(w);print(tag,'week',w['week'],'shares',sh,'lengths',L,'players',len(c),len(D))
    bad=0;ok=0
    for e in D:
        k=key(e['name'])+('|'+e['pos'] if e['pos'] in('DEF','K') else '')
        if k not in c:
            alt=[x for x in c if x.startswith(key(e['name']))]
            if not alt: continue
            k=alt[0]
        if abs(c[k]-e['crank'])>1e-6:
            bad+=1
            if bad<8:print('  diff',e['name'],e['pos'],c[k],e['crank'],e['src'])
        else:ok+=1
        if abs(round(curve(e['order'])*10)/10-e['value'])>1e-9:print('  curve',e['name'])
    print('  matched',ok,'different',bad)
prev={e['pid']:e for e in o['prev'] if e['pid']}
bad=sum(1 for e in o['now'] if e['pid'] in prev and e['delta'] is not None and abs(round(e['value']-prev[e['pid']]['value'],1)-round(e['delta'],1))>0.11)
print('delta checks off',bad)
