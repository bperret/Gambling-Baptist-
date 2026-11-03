#!/usr/bin/env python3
"""Run from app/. Rebuilds index.html from live.html with src/app.js and src/shell.html.
--publish adds 1 to DYK_SEED so Did You Know rotates. Use it right before every publish."""
import re,json,sys
live=open('live.html').read()
m=re.search(r'<script type="application/json" id="gb-src">(.*?)</script>',live,re.S)
raw=m.group(1); src=json.loads(raw)
assert json.dumps(src).replace('<','\\u003c')==raw,'gb-src round trip failed'
app=open('src/app.js').read(); shell=open('src/shell.html').read()
if '--publish' in sys.argv:
    n=int(re.search(r'const DYK_SEED = (\d+);',app).group(1))+1
    app=re.sub(r'const DYK_SEED = \d+;',f'const DYK_SEED = {n};',app,count=1); open('src/app.js','w').write(app); print('DYK_SEED',n)
assert '</script' not in app,'a closing script tag in app.js breaks the page'
oldapp,oldshell=src['app'],src['shell']
nraw=json.dumps(dict(src,app=app,shell=shell)).replace('<','\\u003c')
h=live[:m.start(1)]+nraw+live[m.end(1):]
assert h.count(oldapp)==1 and h.count(oldshell)==1
open('index.html','w').write(h.replace(oldshell,shell).replace(oldapp,app)); print('built')
