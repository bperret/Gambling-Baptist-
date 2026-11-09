// Monday Night Vigil: shows on Monday only, Recap pulses on Tuesday, no errors or sideways scroll.
// Usage: node checks/vigil.js sim out-folder
const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');
const S=process.argv[2],O=process.argv[3]||S;
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8798,async()=>{
 const b=await chromium.launch();let bad=0;const fail=m=>{bad++;console.log('FAIL',m);};
 const open=async(when,width,scheme,hash)=>{const c=await b.newContext({viewport:{width,height:844},colorScheme:scheme,timezoneId:'America/Chicago'});const p=await c.newPage();p.on('pageerror',e=>fail('pageerror '+e.message));await p.clock.setFixedTime(new Date(when));await p.goto('http://localhost:8798/'+(hash||''));await p.waitForTimeout(1800);return {c,p};};
 const state=p=>p.evaluate(()=>({vig:[...document.querySelectorAll('a[href="#vigil"]')].map(a=>!a.hidden),vigPing:[...document.querySelectorAll('a[href="#vigil"]')].some(a=>a.classList.contains('ping')),recPing:[...document.querySelectorAll('a[href="#week"]')].some(a=>a.classList.contains('ping')),six:document.querySelector('nav.bottom').classList.contains('six'),ovf:document.documentElement.scrollWidth>innerWidth,tile:!!document.querySelector('.vg-tile'),text:document.getElementById('view').innerText}));
 // Monday, every width and scheme
 for(const scheme of ['light','dark'])for(const width of [360,390,768]){
  const {c,p}=await open('2026-11-09T23:00:00Z',width,scheme);let s=await state(p);
  if(!s.vig.every(Boolean))fail('vigil hidden on Monday');if(!s.vigPing)fail('no vigil pulse Monday');if(!s.tile)fail('no Home tile Monday');
  await p.evaluate(()=>{location.hash='#vigil'});await p.waitForTimeout(600);s=await state(p);
  if(!s.vigPing)fail('vigil pulse gone after opening');if(s.ovf)fail(`overflow ${scheme} ${width}`);if(/undefined|\bNaN\b|Infinity/.test(s.text))fail('bad text');if(!/Monday Night Vigil/.test(s.text))fail('no heading');
  const cards=await p.$$eval('.vg-card',x=>x.length),dots=await p.$$eval('.vg-card:first-of-type .vg-dot',x=>x.length);
  if(cards&&dots!==50)fail('dots '+dots);
  const sides=await p.evaluate(()=>{const c=document.querySelector('.vg-card');if(!c)return null;const l=c.querySelector('.vg-side .muted').textContent.trim();const lab=c.querySelector('svg text.axis').textContent;return [l,lab];});
  if(sides&&!sides[1].includes(sides[0]))fail('chart sides do not match header: '+sides.join(' | '));
  if(width===390){await p.screenshot({path:`${O}/vigil-${scheme}.png`,fullPage:true});}
  if(width===390&&scheme==='light'){await p.evaluate(()=>{location.hash='#home'});await p.waitForTimeout(400);await p.locator('.vg-tile').screenshot({path:`${O}/vigil-tile.png`});fs.writeFileSync(`${O}/vigil.txt`,s.text);}
  console.log('Mon',scheme,width,'cards',cards,'dots',dots,'ovf',s.ovf);await c.close();}
 // Tuesday: vigil gone, Recap pulses until opened
 {const {c,p}=await open('2026-11-10T15:00:00Z',390,'light');let s=await state(p);
  if(s.vig.some(Boolean))fail('vigil visible Tuesday');if(!s.recPing)fail('no Recap pulse Tuesday');if(s.six)fail('six slots Tuesday');
  await p.locator('nav.bottom').screenshot({path:`${O}/nav-tuesday.png`});
  await p.evaluate(()=>{location.hash='#week'});await p.waitForTimeout(500);s=await state(p);if(!s.recPing)fail('Recap pulse should stay all Tuesday');if(!/Weekly Recap/.test(s.text))fail('no Weekly Recap heading');
  await p.evaluate(()=>{location.hash='#vigil'});await p.waitForTimeout(400);s=await state(p);if(!/opens on Mondays/.test(s.text))fail('closed message');
  console.log('Tue ok');await c.close();}
 // Wednesday: nothing pulses
 {const {c,p}=await open('2026-11-11T15:00:00Z',390,'light');const s=await state(p);if(s.recPing||s.vigPing||s.vig.some(Boolean))fail('Wednesday marks');console.log('Wed ok');await c.close();}
 // Next Monday with last week's export: stays closed
 {const {c,p}=await open('2026-11-16T23:00:00Z',390,'light');const s=await state(p);if(s.vig.some(Boolean))fail('stale export opened the vigil');console.log('stale Monday ok');await c.close();}
 console.log(bad?`${bad} failures`:'all vigil checks passed');await b.close();srv.close();});
