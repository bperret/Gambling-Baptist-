import sys
h=open(sys.argv[1]).read()
b='  /* ---------- Home: the 30-second front door ---------- */'
i=h.rfind(b)
h=h[:i]+'  window.__ser=sermon;window.__st=st;window.__book=sermonBook;window.__rt=recapTiles;window.__wk=wkOf;window.__ww=wWithout;window.__rs=render;window.__tc=tvConsensus;window.__qs=wQbSplits;\n'+h[i:]
open(sys.argv[2],'w').write(h)
