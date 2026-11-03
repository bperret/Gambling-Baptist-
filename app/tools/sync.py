#!/usr/bin/env python3
"""Run from app/. Reads the live page (live.html) and writes its source to src/app.js and src/shell.html."""
import re,json
h=open('live.html').read()
m=re.search(r'<script type="application/json" id="gb-src">(.*?)</script>',h,re.S)
d=json.loads(m.group(1))
open('src/app.js','w').write(d['app']); open('src/shell.html','w').write(d['shell'])
print('app',len(d['app']),'shell',len(d['shell']))
