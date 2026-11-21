import sys
h=open(sys.argv[1]).read()
b='  /* ---------- Home: the 30-second front door ---------- */'
i=h.rfind(b)
h=h[:i]+'  window.__ser=sermon;window.__st=st;window.__book=sermonBook;window.__rt=recapTiles;window.__wk=wkOf;window.__ww=wWithout;window.__rs=render;window.__ti=tvIdeas;window.__tc=tvConsensus;window.__qs=wQbSplits;window.__exd=exodusData;window.__gbExodus=()=>{const X=exodusData();if(!X)return null;return {pw:X.pw,lastW:X.lastW,posAvg:X.posAvg,rows:X.rows.map(r=>({uid:r.uid,tot:r.tot,str:r.str,slate:r.slate,hurt:r.hurt,sim:r.sim,sat:r.sat.map(x=>({pid:x.c.pid,weeks:x.weeks})),lu:r.lu.map(l=>l.map(e=>({slot:e.slot,pid:e.c.pid,pos:e.c.pos,team:e.c.team,mu:e.c.mu,n:e.c.n,own:e.c.own,wx:e.c.wx,pj:e.c.pj,hurt:e.c.hurt,wmu:e.x.mu,f:e.x.f,opp:e.x.opp,ctx:e.x.ctx?{q:e.x.ctx.q,on:e.x.ctx.on,r:e.x.ctx.r,n:e.x.ctx.n,raw:e.x.ctx.raw}:null,fp:e.x.fp})))}))};};\n'+h[i:]
open(sys.argv[2],'w').write(h)
