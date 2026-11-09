# Leave-one-out calibration for the Monday Night Vigil player curves. Run from app/: python3 checks/vigil_calib.py
import json, math, statistics as S, random, collections
d=json.load(open('data.json'));P=d['players'];pr=d['projections'];A=pr['act'];U=pr['usage']['weeks']
pos=lambda p:{'FB':'RB'}.get((P.get(p) or ['',''])[1],(P.get(p) or ['',''])[1])
tw=collections.defaultdict(set)
for w,rows in U.items():
  for r in rows.values():
    if r[0]: tw[r[0]].add(int(w))
def team(p): return p if pos(p)=='DEF' else (P.get(p) or ['','',''])[2]
logs={}
for w in sorted(A,key=int):
  for p in set(A[w])|set(U.get(w,{})):
    ps=pos(p); v=A[w].get(p,0)
    if ps in('K','DEF'):
      if p in A[w] and int(w) in tw.get(team(p),()): logs.setdefault(p,[]).append((int(w),v))
    elif ps in('QB','RB','WR','TE'):
      u=U.get(w,{}).get(p)
      if u and u[1]>0: logs.setdefault(p,[]).append((int(w),v))
for p in logs: logs[p].sort()
# fantasy-relevant: players with mean >= threshold
rel={p:l for p,l in logs.items() if len(l)>=4 and S.mean(v for _,v in l)>=(5 if pos(p) in('K','DEF') else 7)}
for ps in ['QB','RB','WR','TE','K','DEF']:
  L=[l for p,l in rel.items() if pos(p)==ps]
  sds=[S.stdev(v for _,v in l) for l in L]; ms=[S.mean(v for _,v in l) for l in L]
  cv=[s/m for s,m in zip(sds,ms)]
  print(ps,'players',len(L),'mean',round(S.mean(ms),1),'within-sd',round(math.sqrt(S.mean(s*s for s in sds)),1),'cv',round(S.median(cv),2))
# teammate correlation of z-scores (offense) and DST vs opposing offense
z={}
for p,l in rel.items():
  m=S.mean(v for _,v in l);s=S.stdev(v for _,v in l) or 1
  for w,v in l: z[(p,w)]=(v-m)/s
byTW=collections.defaultdict(list)
for (p,w),zz in z.items():
  if pos(p)!='DEF': byTW[(team(p),w)].append(zz)
pairs=[(a,b) for k,v in byTW.items() for i,a in enumerate(v) for b in v[i+1:]]
def corr(pr):
  xs=[a for a,_ in pr];ys=[b for _,b in pr];mx,my=S.mean(xs),S.mean(ys)
  return sum((a-mx)*(b-my) for a,b in pr)/math.sqrt(sum((a-mx)**2 for a in xs)*sum((b-my)**2 for b in ys))
print('teammate pairs',len(pairs),'rho',round(corr(pairs),3))
# QB with own pass catchers; DEF vs opposing offense
opp={}
for (t,w),v in byTW.items(): pass
qbp=[];
for (t,w),_ in byTW.items():
  qs=[z[(p,w)] for p in rel if pos(p)=='QB' and team(p)==t and (p,w) in z]
  rc=[z[(p,w)] for p in rel if pos(p) in('WR','TE') and team(p)==t and (p,w) in z]
  qbp+=[(a,b) for a in qs for b in rc]
print('QB-receiver rho',round(corr(qbp),3),len(qbp))
CV={'QB':.449,'RB':.558,'WR':.594,'TE':.645,'K':.551,'DEF':.822}
from statistics import NormalDist as N
nd=N()
def fit(own,proj,ps,k_m=3,k_s=4,infl=1.0):
  n=len(own);om=S.mean(own) if n else proj
  mu=(n*om+k_m*proj)/(n+k_m) if proj is not None else om
  mu=max(mu,1.0)
  sp=CV[ps]*mu; so=S.stdev(own) if n>1 else sp
  sd=math.sqrt((n*so*so+k_s*sp*sp)/(n+k_s))*infl
  return mu,sd
def cdf(x,mu,sd,ps):
  if ps in('K','DEF'): return nd.cdf((x-mu)/sd)
  s2=math.log(1+(sd/mu)**2);m=math.log(mu)-s2/2
  return 0.0 if x<=0 else nd.cdf((math.log(x)-m)/math.sqrt(s2))
for infl in (1.0,1.1,1.2):
 for kind in ('own-only','shrunk'):
  pit=[]
  for p,l in logs.items():
    ps=pos(p)
    if ps not in CV or len(l)<3: continue
    for i,(w,v) in enumerate(l):
      own=[x for j,(_,x) in enumerate(l) if j!=i]
      pj=pr['weeks'].get(str(w),{}).get(p)
      if kind=='own-only':
        mu=max(S.mean(own),1);sd=(S.stdev(own) if len(own)>1 else 1)*infl
        pit.append(nd.cdf((v-mu)/max(sd,.5)))
      else:
        mu,sd=fit(own,pj,ps,infl=infl);pit.append(cdf(v,mu,sd,ps))
  n=len(pit);f=lambda c:round(sum(c(x) for x in pit)/n*100,1)
  print(kind,infl,'n',n,'<10%:',f(lambda x:x<.1),'>90%:',f(lambda x:x>.9),'<2.5%:',f(lambda x:x<.025),'>97.5%:',f(lambda x:x>.975),'>99%:',f(lambda x:x>.99))
print('---- mixture: dud chance q (0 to 25% of mean), else widened curve; starters only (mean>=6)')
def mixcdf(x,mu,sd,ps,q):
  dud = 0.0 if x<=0 else min(1.0,x/(0.25*mu))
  if ps in ('K','DEF'): q=0
  return q*dud+(1-q)*cdf(x,mu,sd,ps)
dudrate={}
for ps in CV:
  L=[(v,S.mean(x for _,x in l)) for p,l in rel.items() if pos(p)==ps for _,v in l]
  dudrate[ps]=round(sum(1 for v,m in L if v<0.25*m)/len(L),3)
print('share of games under a quarter of the player mean',dudrate)
best=None
for infl in (1.3,1.4,1.5):
 for qs in (0.0,0.5,1.0):
  pit=[]
  for p,l in logs.items():
    ps=pos(p)
    if ps not in CV or len(l)<3 or S.mean(x for _,x in l)<6: continue
    for i,(w,v) in enumerate(l):
      own=[x for j,(_,x) in enumerate(l) if j!=i]
      mu,sd=fit(own,pr['weeks'].get(str(w),{}).get(p),ps,infl=infl)
      pit.append(mixcdf(v,mu,sd,ps,dudrate[ps]*qs))
  n=len(pit);f=lambda c:round(sum(c(x) for x in pit)/n*100,1)
  r=(infl,qs,n,f(lambda x:x<.1),f(lambda x:x>.9),f(lambda x:x<.025),f(lambda x:x>.975),f(lambda x:x<.01),f(lambda x:x>.99))
  print('infl %.1f dud x%.1f n %d  <10 %.1f >90 %.1f  <2.5 %.1f >97.5 %.1f  <1 %.1f >99 %.1f'%r)
