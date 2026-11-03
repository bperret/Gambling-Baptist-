const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');
const S=process.argv[2],verbose=process.argv[3];
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8798,async()=>{
const b=await chromium.launch();const p=await b.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:8798/');await p.waitForTimeout(2500);
const o=await p.evaluate(()=>{const B=__book(),R=[];for(const s of __st.model.seasons.slice().sort((a,b)=>a.year-b.year))for(const w of s.weeks){const P=B[s.year][w];if(!P){R.push({y:s.year,w,none:1});continue;}const full=__ser(s,w),sh=__ser(s,w,true);const strip=l=>l.replace(/<[^>]+>/g,'').replace(/&#39;/g,"'");R.push({y:s.year,w,title:P.title,lead:P.lead,leadUid:P.leadUid,bk:P.final.map(x=>x.bank+x.idx),uids:P.final.map(x=>x.uids),keys:P.keys,cats:P.final.map(x=>x.cat),full:full.lines.map(strip),sh:sh.lines.map(strip)});}return {R,commish:Object.values(__st.model.owners).find(o=>o.handle==='BentonPerret').uid};});
const R=o.R;console.log('weeks',R.length,'none',R.filter(r=>r.none).length);
const live=R.filter(r=>!r.none);
const cnt={},first={},home={};live.forEach(r=>{r.bk.forEach((k,i)=>{const b=k.replace(/\d+$/,'');cnt[b]=(cnt[b]||0)+1;if(i<5)home[b]=(home[b]||0)+1;});first[r.lead]=(first[r.lead]||0)+1;});
console.log('story counts (all/home)',Object.keys(cnt).sort().map(k=>`${k}:${cnt[k]}/${home[k]||0}`).join(' '));console.log('lead',JSON.stringify(first));
const n=live.map(r=>r.full.length);console.log('lines min',Math.min(...n),'max',Math.max(...n),'avg',(n.reduce((a,b)=>a+b,0)/n.length).toFixed(1),'dist',JSON.stringify(n.reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{})));
let bad=0,b2b=0,lead2=0,comm=[],titRep=0;
live.forEach((r,i)=>{const t=r.full.join(' ')+r.sh.join(' ')+r.title;if(/undefined|NaN|null|\[object/.test(t)){bad++;console.log('BAD',r.y,r.w,t.slice(0,200));}
 const c={};r.uids.flat().forEach(u=>c[u]=(c[u]||0)+1);if(Object.values(c).some(v=>v>2)){console.log('CAP',r.y,r.w);bad++;}
 const pr=live[i-1];if(pr&&pr.y===r.y){if(pr.bk.some(k=>r.bk.includes(k)))b2b++;if(pr.lead===r.lead)lead2++;if(pr.title===r.title)titRep++;}
 if(r.leadUid===o.commish)comm.push(r.y+'w'+r.w);});
console.log('bad',bad,'back-to-back same line',b2b,'same lead type back-to-back',lead2,'same title',titRep,'commish leads',comm.join(' '));
console.log('titles unique',new Set(live.map(r=>r.title)).size,'of',live.length);
if(verbose)live.filter(r=>r.y==verbose).forEach(r=>console.log(`\n${r.y} w${r.w} [${r.title}] ${r.bk.join(' ')}\n  `+r.sh.join('\n  ')));
await b.close();srv.close();});
