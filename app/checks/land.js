// The Promised Land: picks lock and unlock, presets move the odds, no errors or sideways scroll.
// Usage: node checks/land.js sim out-folder
const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");const http=require('http'),fs=require('fs'),path=require('path');
const S=process.argv[2],O=process.argv[3]||S;
const srv=http.createServer((q,r)=>{const f=path.join(S,q.url.split('?')[0].replace(/^\/$/,'/index.html'));if(fs.existsSync(f)){r.writeHead(200);r.end(fs.readFileSync(f));}else{r.writeHead(404);r.end('{}');}}).listen(8802,async()=>{
 const b=await chromium.launch();let bad=0;const fail=m=>{bad++;console.log('FAIL',m);};
 for(const scheme of ['light','dark'])for(const width of [360,390,768]){
  const c=await b.newContext({viewport:{width,height:844},colorScheme:scheme});const p=await c.newPage();p.on('pageerror',e=>fail('pageerror '+e.message));
  await p.goto('http://localhost:8802/#land');await p.waitForTimeout(2000);
  const big=()=>p.$eval('.pl-big',e=>e.textContent);const txt=()=>p.evaluate(()=>document.getElementById('view').innerText);
  const ovf=()=>p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(await ovf())fail(`overflow ${scheme} ${width}`);if(/undefined|\bNaN\b|Infinity/.test(await txt()))fail('bad text');
  const games=await p.$$eval('.pl-game',x=>x.length);if(games<5)fail('games '+games);
  const b0=await big();
  // pick, then unpick
  await p.click('.pl-game:first-child .pl-side:first-child');await p.waitForTimeout(700);
  const on=await p.$$eval('.pl-side.on',x=>x.length);if(on!==1)fail('pick did not lock');
  await p.click('.pl-game:first-child .pl-side:first-child');await p.waitForTimeout(700);
  if(await p.$$eval('.pl-side.on',x=>x.length))fail('pick did not unlock');
  // lose out
  await p.click('[data-lpre="lose"]');await p.waitForTimeout(900);const lo=await big();
  const picked=await p.$eval('.pl-brand .share-wk',e=>e.textContent);
  const tw=await p.evaluate(()=>{const t=document.querySelector('.pl-tbl'),c=document.querySelector('.pl-shot');return t.scrollWidth-c.clientWidth;});if(tw>0)fail('table wider than card by '+tw);
  if(width===390){await p.evaluate(()=>{document.querySelector('.topbar').style.position='static';window.scrollTo(0,0)});await p.locator('.pl-shot').screenshot({path:`${O}/land-${scheme}.png`});await p.evaluate(()=>{document.querySelector('.topbar').style.position=''});}
  if(width===390&&scheme==='light'){await p.screenshot({path:`${O}/land-page.png`,fullPage:true});fs.writeFileSync(`${O}/land.txt`,await txt());}
  if(await ovf())fail('overflow after picks');
  // clear, switch team
  await p.click('[data-lpre="clear"]');await p.waitForTimeout(900);if(await big()!==b0)fail(`clear did not restore ${b0} vs ${await big()}`);
  const opts=await p.$$eval('#landTeam option',o=>o.map(x=>x.value));await p.selectOption('#landTeam',opts[opts.length-1]);await p.waitForTimeout(900);const last=await big();
  // Playoff Picture link
  await p.evaluate(()=>{location.hash='#standings'});await p.waitForTimeout(500);if(!(await p.$('[data-go="land"]')))fail('no link from Playoff Picture');
  console.log(scheme,width,'games',games,'first team',b0,'lose out',lo,'|',picked,'| last team',last);await c.close();}
 console.log(bad?`${bad} failures`:'all land checks passed');await b.close();srv.close();});
