const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');
const S=process.argv[2],O=process.argv[3];
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8797,async()=>{
const b=await chromium.launch();let errs=0;
for(const scheme of ['light','dark'])for(const width of [360,390,768]){
 const c=await b.newContext({viewport:{width,height:844},colorScheme:scheme});const p=await c.newPage();p.on('pageerror',e=>{errs++;console.log('ERR',e.message)});
 await p.goto('http://localhost:8797/');await p.waitForTimeout(1800);
 const hashes=await p.$$eval('nav.tabs a, .sheet a',a=>a.map(x=>x.getAttribute('href')));
 const ovf=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 const title=await p.$eval('.hero-h.st',e=>e.textContent);
 if(width==390)await p.locator('.hero.share').screenshot({path:`${O}/home-${scheme}.png`});
 await p.evaluate(()=>{location.hash='#week'});await p.waitForTimeout(500);
 const rc=await p.$$eval('.hero.slim .sermon li',l=>l.length).catch(()=>-1);const ov2=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(width==390&&scheme=='light')await p.locator('.hero.slim').screenshot({path:`${O}/recap.png`}).catch(()=>{});
 const views=[...new Set(['home','week','standings','moves','more'].concat(hashes.filter(Boolean).map(h=>h.replace('#',''))))];let vo=0;
 for(const v of views){await p.evaluate(x=>{location.hash='#'+x},v);await p.waitForTimeout(160);if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){vo++;console.log('overflow',v);}const t=await p.evaluate(()=>document.body.innerText);if(/undefined|\bNaN\b/.test(t))console.log('bad text',v);}
 console.log(scheme,width,'title',title,'| home ovf',ovf,'recap lines',rc,'ovf',ov2,'views',views.length,'overflow',vo);
 await c.close();}
console.log('errs',errs);await b.close();srv.close();});
