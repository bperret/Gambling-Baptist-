// Pew Chart and Exodus: the page renders, Exodus table and lineup work, controls respond, numbers dump to sim/exodus.json for the Python recheck
const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');
const S=process.argv[2],O=process.argv[3]||S;
const srv=http.createServer((q,r)=>{const f=path.join(S,decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end();}}).listen(8798,async()=>{
 const b=await chromium.launch();let errs=0,bad=0;const fail=m=>{bad++;console.log('bad',m);};
 for(const scheme of ['light','dark'])for(const width of [360,390,768]){
  const c=await b.newContext({viewport:{width,height:844},colorScheme:scheme});const p=await c.newPage();p.on('pageerror',e=>{errs++;console.log('ERR',e.message)});
  await p.goto('http://localhost:8798/#pews');await p.waitForTimeout(2500);
  const h2=await p.$$eval('main h2',h=>h.map(x=>x.textContent));
  for(const t of ['The Pew Chart','Exodus','Pulpit Power Rankings','Everyone Plays Everyone'])if(!h2.includes(t))fail(`${scheme} ${width} missing ${t}`);
  const rows=await p.$$eval('table.ex-t tbody tr',r=>r.length);if(rows!==12)fail('exodus rows '+rows);
  const lu=await p.$$eval('main .list',l=>l.length);
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))fail(`${scheme} ${width} overflow`);
  // Bulletin no longer carries the moved sections
  await p.evaluate(()=>{location.hash='#standings'});await p.waitForTimeout(400);
  const bh=await p.$$eval('main h2',h=>h.map(x=>x.textContent));if(bh.includes('Pulpit Power Rankings')||bh.includes('Everyone Plays Everyone'))fail('bulletin still has moved sections');
  if(scheme==='light'&&width===390){
   await p.evaluate(()=>{location.hash='#pews'});await p.waitForTimeout(1500);
   const ord1=await p.$$eval('table.ex-t tbody tr td.team b',x=>x.map(e=>e.textContent));
   await p.click('button[data-exsort="str"]');await p.waitForTimeout(300);
   const ord2=await p.$$eval('table.ex-t tbody tr td.team b',x=>x.map(e=>e.textContent));
   if(ord1.join()===ord2.join())console.log('note: sort orders match');
   await p.click('button[data-exsort="title"]');await p.waitForTimeout(300);
   const n0=await p.$$eval('main .list',l=>l.length);
   await p.click('button[data-exwk="2"]');await p.waitForTimeout(300);
   const tk=await p.$eval('p.takeaway',e=>e.textContent);if(!/Week 17/.test(tk))fail('week chip '+tk);
   const opts=await p.$$eval('#exTeam option',o=>o.map(x=>x.value));await p.selectOption('#exTeam',opts[5]);await p.waitForTimeout(300);
   const tk2=await p.$eval('p.takeaway',e=>e.textContent);if(tk2===tk)fail('team switch');
   await p.click('button[data-exwk="0"]');await p.waitForTimeout(300);
   const ex=await p.locator('h2:text-is("Exodus")');const box=await ex.boundingBox();
   await p.screenshot({path:`${O}/exodus-table.png`,clip:{x:0,y:box.y+window_scroll(await p.evaluate(()=>scrollY))-8,width,height:900}}).catch(async()=>{});
   await p.evaluate(()=>{const e=[...document.querySelectorAll('main h2')].find(h=>h.textContent==='Exodus');e.scrollIntoView();});await p.waitForTimeout(200);
   await p.screenshot({path:`${O}/exodus-1.png`});
   await p.evaluate(()=>{document.querySelector('#exTeam').scrollIntoView();scrollBy(0,-60);});await p.waitForTimeout(200);
   await p.screenshot({path:`${O}/exodus-2.png`});
   await p.evaluate(()=>{location.hash='#home'});await p.waitForTimeout(600);
   const tiles=await p.$$eval('.go .tt',t=>t.map(x=>x.textContent));if(!tiles.includes('Exodus'))console.log('note: no Exodus tile on Home (tiles: '+tiles.join(', ')+')');
  }
  console.log(scheme,width,'h2',h2.length,'rows',rows,'lists',lu);
  await c.close();}
 // Dump numbers
 const c=await b.newContext();const p=await c.newPage();await p.goto('http://localhost:8798/#pews');await p.waitForTimeout(2500);
 const dump=await p.evaluate(()=>window.__gbExodus&&window.__gbExodus());
 if(dump){fs.writeFileSync(path.join(O,'exodus.json'),JSON.stringify(dump));console.log('dumped',dump.rows.length);} else console.log('no dump hook');
 console.log('errs',errs,'bad',bad);await b.close();srv.close();});
function window_scroll(y){return y;}
