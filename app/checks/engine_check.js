// Roster engine check (injuries and fill-ins). Usage: node checks/engine_check.js sim
// 1. Simulated injury chance per game played, by position, lands within 0.006 of INJ_RATE.h (healthy players, 20,000 seasons).
// 2. Simulated share of 1-game and 2-game absences (spells with 3+ games of room, so a cut-off cannot hide them) match INJ_RATE.d within 0.03.
// 3. Every team-week lineup fills every starting slot and no slot scores zero. A fill-in plays only when no healthy rostered player is eligible (bench first).
// 4. With nobody hurt, a team that has a healthy starter at every slot uses no fill-in.
const { chromium } = require("playwright"), http = require("http"), fs = require("fs"), path = require("path");
const S = process.argv[2] || "sim";
const srv = http.createServer((q, r) => { const f = path.join(S, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html")); if (fs.existsSync(f)) { r.writeHead(200); r.end(fs.readFileSync(f)); } else { r.writeHead(404); r.end(); } }).listen(8812, async () => {
  const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
  p.on("pageerror", e => console.log("ERR", e.message));
  await p.goto("http://localhost:8812/#home"); await p.waitForTimeout(2500);
  const o = await p.evaluate(() => {
    const st = window.__st, s = st.model.latest, E = window.__exd(true), INJ = st.model.injuries || {};
    const RATE = { QB: 0.0403, RB: 0.038, WR: 0.0415, TE: 0.0405 };
    let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const healthy = E.allCurves.filter(c => RATE[c.pos] && !(INJ[c.pid] && ["Out", "Doubtful", "IR", "PUP", "Sus", "NA", "DNR", "COV"].includes(INJ[c.pid].s)) && !c.call);
    const pos = {}; healthy.forEach(c => { pos[c.pid] = c.pos; });
    const nflW = w => { const S0 = {}; return S0; };
    // play weeks per player: team has a game that week (byW entry not a bye)
    const playsW = c => E.weeks.filter(w => c.byW[w] && !c.byW[w].bye && !c.byW[w].out);
    const PW = {}; healthy.forEach(c => { PW[c.pid] = playsW(c); });
    const games = {}, inj = {}, spells = {}; Object.keys(RATE).forEach(k => { games[k] = 0; inj[k] = 0; spells[k] = []; });
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const out = E.draw(rnd, E.weeks);
      healthy.forEach(c => {
        const ws = PW[c.pid], set = out.get(c.pid), k = c.pos;
        for (let j = 0; j < ws.length - 1; j++) {
          const outNow = set && set.has(ws[j]); if (outNow) continue;
          games[k]++;
          if (set && set.has(ws[j + 1])) { inj[k]++; let n = 0, m = j + 1; while (m < ws.length && set.has(ws[m])) { n++; m++; } if (ws.length - (j + 1) >= 3) spells[k].push(n); }
        }
      });
    }
    const res = { hazard: {}, lineups: { bad: [], fills: 0, slots: 0 } };
    Object.keys(RATE).forEach(k => { res.hazard[k] = { sim: inj[k] / games[k], want: RATE[k], spells1: spells[k].filter(n => n === 1).length / Math.max(1, spells[k].length), spells2: spells[k].filter(n => n === 2).length / Math.max(1, spells[k].length), n: spells[k].length }; });
    // Lineups: healthy and with one random draw of injuries
    const nSlots = s.slotOrder.length;
    const out1 = E.draw(rnd, E.weeks);
    s.uids.forEach(u => E.weeks.forEach(w => [null, out1].forEach(out => {
      const L = E.lineup(u, w, out); res.lineups.slots += L.length;
      if (L.length !== nSlots) res.lineups.bad.push([u, w, "slots " + L.length]);
      L.forEach((e, j) => { if (!(e.m > 0)) res.lineups.bad.push([u, w, "zero " + (e.c.pid)]); if (e.c.fill) res.lineups.fills++; });
      // no slot below its fill-in: compare to that slot's eligible fill-ins
      const used = new Set(L.filter(e => !e.c.fill).map(e => e.c.pid));
      const bench = E.allCurves.filter(c => (s.currentRosters[u] || []).includes(c.pid) && !used.has(c.pid) && c.byW[w] && c.byW[w].mu > 0 && !c.byW[w].out && !c.byW[w].bye && !(out && out.get(c.pid) && out.get(c.pid).has(w)));
      s.slotOrder.forEach((i, j) => { const e = L[j]; if (!e || !e.c.fill) return; const el = s.slotElig[i], b0 = bench.find(c => el.has(c.pos)); if (b0) res.lineups.bad.push([u, w, "fill-in used with " + b0.pid + " on the bench"]); });
    })));
    res.scale = E.scale;
    // Handcuffs: every table entry whose backup is rostered takes his "lead out" number (times the opponent factor) when the lead is out,
    // stays put when the lead plays, and every lead (rostered or not) can be hurt in the simulations
    res.hc = { n: 0, bad: [] };
    E.hc.forEach(e => { const u = E.owner[e.cuff]; if (!E.riskIds.includes(e.lead)) res.hc.bad.push(["lead not simulated", e.lead]); if (!u) return;
      const c = E.allCurves.find(x => x.pid === e.cuff);
      E.weeks.filter(w => w >= (e.from || 0) && w <= (e.to || 99)).forEach(w => { const x = c.byW[w]; if (!x || x.bye || x.out || x.hc) return;
        const out = new Map([[e.lead, new Set([w])]]); out.teams = new Map(); const b = E.boosted(u, w, out), got = b && b[e.cuff];
        const best = Math.max(...E.hc.filter(f => f.cuff === e.cuff && f.lead === e.lead && w >= (f.from || 0) && w <= (f.to || 99)).map(f => f.out));
        res.hc.n++; if (got == null || Math.abs(got - best * (x.f || 1)) > 0.01) res.hc.bad.push([e.cuff, w, got, best]);
        if (E.boosted(u, w, null)) res.hc.bad.push([e.cuff, w, "boost with lead healthy"]); }); });
    return res;
  });
  let bad = 0;
  Object.entries(o.hazard).forEach(([k, v]) => { const off = Math.abs(v.sim - v.want) > 0.006; if (off) bad++; console.log(k, "hazard sim", v.sim.toFixed(4), "table", v.want, off ? "OFF" : "ok", "| spells", v.n, "1 game", v.spells1.toFixed(3), "2 games", v.spells2.toFixed(3)); });
  const sp = { QB: [0.3191, 0.1212], RB: [0.2746, 0.1768], WR: [0.3425, 0.172], TE: [0.2967, 0.1558] };
  Object.entries(o.hazard).forEach(([k, v]) => { if (Math.abs(v.spells1 - sp[k][0]) > 0.03 || Math.abs(v.spells2 - sp[k][1]) > 0.03) { bad++; console.log(k, "spell lengths OFF"); } });
  console.log("lineup slots", o.lineups.slots, "fill-ins used", o.lineups.fills, "problems", o.lineups.bad.length, JSON.stringify(o.lineups.bad.slice(0, 5)));
  console.log("league scale", o.scale.toFixed(4));
  console.log("handcuff cases", o.hc.n, "problems", o.hc.bad.length, JSON.stringify(o.hc.bad.slice(0, 5)));
  bad += o.lineups.bad.length + o.hc.bad.length;
  await b.close(); srv.close(); process.exit(bad ? 1 : 0);
});
