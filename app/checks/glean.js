// Gleanings: scopes, order (starters first), counts against raw data, Home tile, player card, no source names, no sideways scroll.
// Usage: node checks/glean.js sim out-folder   (sim holds index.html, data.json, values.json, notes.json)
const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');
const S=process.argv[2],O=process.argv[3]||S;
const raw=JSON.parse(fs.readFileSync(path.join(S,'data.json'))),notes=JSON.parse(fs.readFileSync(path.join(S,'notes.json')));
// Independent expectation: players with notes per roster, from the export's in-progress week rows
const live=raw.live,s26=raw.seasons.find(x=>x.league.season===raw.state.season);
const uidOf={};s26.rosters.forEach(r=>{uidOf[r.roster_id]=r.owner_id;});
const withNotes=new Set(notes.items.map(x=>x.pid));
const expect={};live.rows.forEach(r=>{expect[uidOf[r.roster_id]]=r.players.filter(p=>withNotes.has(p)).length;});
const me=process.env.GL_ME||Object.keys(expect)[0];
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8803,async()=>{
 const b=await chromium.launch();let bad=0;const fail=m=>{bad++;console.log('FAIL',m);};
 for(const scheme of ['light','dark'])for(const width of [360,390,768]){
  const c=await b.newContext({viewport:{width,height:844},colorScheme:scheme});const p=await c.newPage();p.on('pageerror',e=>fail('pageerror '+e.message));
  const txt=()=>p.evaluate(()=>document.getElementById('view').innerText);
  const ovf=()=>p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const sane=async tag=>{const t=await txt();if(/undefined|\bNaN\b|Infinity|\[object|&#?\w+;/.test(t))fail('bad text '+tag);if(/Late-Round|newsletter|\bper (Late|FF)/i.test(t))fail('source named '+tag);if(await ovf())fail(`overflow ${tag} ${scheme} ${width}`);return t;};
  // No one picked: whole league
  await p.goto('http://localhost:8803/#glean');await p.waitForTimeout(1800);
  await sane('league');
  const secs=await p.$$eval('#view h3',x=>x.length);if(secs!==Object.keys(expect).length)fail('league sections '+secs);
  const cards=await p.$$eval('.gl-card',x=>x.length);const want=Object.values(expect).reduce((a,b)=>a+b,0);if(cards!==want)fail(`cards ${cards} vs ${want}`);
  await p.evaluate(()=>{location.hash='#home'});await p.waitForTimeout(800);
  const tile=await p.$eval('.gl-tile .dk',e=>e.textContent).catch(()=>null);if(tile!=='Gleanings')fail('home tile '+tile);
  // Pick a member
  await p.evaluate(u=>{localStorage.setItem('gb-me',u);localStorage.removeItem('gb-glscope');},me);await p.reload();await p.waitForTimeout(1800);
  const tile2=await p.$eval('.gl-tile .dk',e=>e.textContent).catch(()=>null);const tl=await p.$$eval('.gl-tile .gl-line',x=>x.length);
  if(expect[me]&&(tile2!=='Your Gleanings'||tl<1||tl>3))fail(`my tile ${tile2} ${tl}`);
  await p.click('.gl-tile [data-go="glean"]');await p.waitForTimeout(900);
  const mt=await sane('mine');const mc=await p.$$eval('.gl-card',x=>x.length);if(mc!==expect[me])fail(`my cards ${mc} vs ${expect[me]}`);
  const roles=await p.$$eval('.gl-card .gl-h .muted',x=>x.map(e=>/Starter/.test(e.textContent)?'S':/Bench/.test(e.textContent)?'B':'?'));if(roles.join('').includes('BS'))fail('bench before starter '+roles.join(''));
  // Opponent
  await p.click('[data-glscope="opp"]');await p.waitForTimeout(700);const ot=await sane('opp');const oh=await p.$eval('#view h3',e=>e.textContent).catch(()=>'');if(!/^Week \d+:/.test(oh))fail('opp header '+oh);
  // Player card
  await p.click('[data-glscope="mine"]');await p.waitForTimeout(600);
  if(mc){await p.click('.gl-card .plink');await p.waitForTimeout(700);const pc=await p.$eval('#pcard',e=>e.innerText);if(!/Gleanings/.test(pc))fail('player card has no Gleanings');await p.keyboard.press('Escape');}
  if(width===390){await p.evaluate(()=>{window.scrollTo(0,0)});await p.screenshot({path:`${O}/glean-mine-${scheme}.png`,fullPage:true});
   await p.evaluate(()=>{location.hash='#home'});await p.waitForTimeout(700);const el=await p.$('.gl-tile');if(el)await el.screenshot({path:`${O}/glean-tile-${scheme}.png`});}
  console.log(scheme,width,'sections',secs,'cards',cards,'mine',mc,'roles',roles.join(''),'| opp',oh.replace(/\s+/g,' ').slice(0,50));await c.close();}
 console.log(bad?`${bad} failures`:'all gleanings checks passed');await b.close();srv.close();});
