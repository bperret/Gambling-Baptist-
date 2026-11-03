const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');const S=process.argv[2];
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8796,async()=>{
const b=await chromium.launch();const p=await b.newPage();await p.goto('http://localhost:8796/');await p.waitForTimeout(2000);
const o=await p.evaluate(()=>{const B=__book(),R=[];for(const y in B)for(const w in B[y])R.push({y,w:+w,keys:B[y][w].keys});return R;});fs.writeFileSync('plans.json',JSON.stringify(o));await b.close();srv.close();});
