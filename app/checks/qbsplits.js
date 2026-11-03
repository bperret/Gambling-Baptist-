const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');const S=process.argv[2];
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8790,async()=>{
const b=await chromium.launch();const p=await b.newPage({viewport:{width:360,height:844}});p.on('pageerror',e=>console.log('ERR',e.message));await p.goto('http://localhost:8790/#work');await p.waitForTimeout(2000);
const o=await p.evaluate(()=>{const W=__wk(),R={};[...new Set(Object.values(W.players).map(x=>x.team))].filter(t=>t&&t!=='?').forEach(t=>{const q=__qs(W,t);if(q)R[t]={qbs:q.qbs.map(x=>x.pid),games:q.qbs.map(x=>x.ws.length),rows:q.rows};});return R;});
fs.writeFileSync('qbsplits.json',JSON.stringify(o));console.log(Object.keys(o).join(' '));
await p.selectOption('#wTeam','NYG');await p.waitForTimeout(350);const t=p.locator('h3',{hasText:'QB splits'});await t.scrollIntoViewIfNeeded();await p.waitForTimeout(200);await p.screenshot({path:S+'/qb.png'});
console.log('overflow',await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
await b.close();srv.close();});
