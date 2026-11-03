
const DYK_SEED = 32;
// League model built from the export file. Pure functions, no DOM.
// Trades reversed within 48 hours: the later trade's adds are the earlier trade's drops, and the other way around
function reversedTrades(txs) {
  const out = new Set(), sig = o => JSON.stringify(Object.entries(o || {}).sort());
  const tr = txs.filter(t => t.type === "trade" && t.created).sort((p, q) => p.created - q.created);
  tr.forEach((t, i) => {
    if (out.has(t)) return;
    for (let j = i + 1; j < tr.length; j++) {
      const u = tr[j]; if (u.created - t.created > 48 * 3600e3) break;
      if (!out.has(u) && sig(u.adds) === sig(t.drops) && sig(u.drops) === sig(t.adds)) { out.add(t); out.add(u); break; }
    }
  });
  return out;
}

function buildLeague(raw) {
  const r2 = x => Math.round((x || 0) * 100) / 100;
  const players = raw.players || {};
  const owners = {};
  const seasons = [];

  const sorted = raw.seasons.slice().sort((a, b) => +a.league.season - +b.league.season);
  for (const s of sorted) {
    const year = s.league.season;
    const pws = (s.league.settings && s.league.settings.playoff_week_start) || 15;
    const rosterOwner = {};
    s.rosters.forEach(r => { rosterOwner[r.roster_id] = r.owner_id || ("roster-" + year + "-" + r.roster_id); });
    const userById = {};
    s.users.forEach(u => { userById[u.user_id] = u; });
    const teamName = {};
    s.rosters.forEach(r => {
      const uid = rosterOwner[r.roster_id];
      const u = userById[uid] || {};
      const disp = u.display_name || ("Open roster " + year);
      teamName[uid] = u.team_name || disp;
      if (!owners[uid]) owners[uid] = { uid, name: disp, seasons: [], teams: {}, orphan: !u.display_name };
      owners[uid].name = disp;
      owners[uid].seasons.push(year);
      owners[uid].teams[year] = teamName[uid];
    });

    const pickNames = {};
    (s.picks || []).forEach(p => { if (p.name) pickNames[p.player_id] = [p.name, p.position || "", p.team || ""]; });
    const pinfo = pid => players[pid] || pickNames[pid] || [pid === "0" ? "Empty slot" : "Player " + pid, "", ""];

    const lastLeg = (s.league.settings && s.league.settings.last_scored_leg) || 99;
    const weeks = Object.keys(s.matchups).map(Number).filter(w => w <= lastLeg).sort((a, b) => a - b);
    const teamWeeks = [];
    const games = [];
    const playerSeasonPts = {};
    for (const w of weeks) {
      const rows = s.matchups[w];
      const tw = {};
      for (const row of rows) {
        const uid = rosterOwner[row.roster_id];
        const starters = (row.starters || []).map((pid, i) => ({ pid, pts: r2((row.starters_points || [])[i]) }));
        const pp = row.players_points || {};
        const startSet = new Set(row.starters || []);
        let bench = 0;
        Object.entries(pp).forEach(([pid, v]) => { if (!startSet.has(pid)) bench += v || 0; });
        if (w < pws) Object.entries(pp).forEach(([pid, v]) => { playerSeasonPts[pid] = (playerSeasonPts[pid] || 0) + (v || 0); });
        const t = { week: w, uid, rid: row.roster_id, pts: r2(row.points), bench: r2(bench), starters, mid: row.matchup_id, playoff: w >= pws, roster: row.players || [], pp };
        tw[row.roster_id] = t;
        teamWeeks.push(t);
      }
      const byMid = {};
      rows.forEach(row => { if (row.matchup_id != null) (byMid[row.matchup_id] = byMid[row.matchup_id] || []).push(tw[row.roster_id]); });
      Object.values(byMid).forEach(pair => {
        if (pair.length !== 2) return;
        const [a, b] = pair;
        a.opp = b.uid; b.opp = a.uid; a.oppPts = b.pts; b.oppPts = a.pts;
        a.result = a.pts > b.pts ? "W" : a.pts < b.pts ? "L" : "T";
        b.result = b.pts > a.pts ? "W" : b.pts < a.pts ? "L" : "T";
        const game = { week: w, playoff: w >= pws, a: { uid: a.uid, pts: a.pts }, b: { uid: b.uid, pts: b.pts }, margin: r2(Math.abs(a.pts - b.pts)) };
        games.push(game); a.game = game; b.game = game;
      });
    }
    const regWeeks = weeks.filter(w => w < pws);

    // Lineup slots: infer each starting slot's eligible positions from who actually filled it
    const posOf = pid => String(pinfo(pid)[1] || "").toUpperCase();
    const nSlots = Math.max(0, ...teamWeeks.map(t => t.starters.length));
    const slotElig = [];
    for (let i = 0; i < nSlots; i++) {
      const cnt = {}; let n = 0;
      teamWeeks.forEach(t => { const p = t.starters[i]; if (!p || p.pid === "0") return; const pos = posOf(p.pid); if (!pos) return; cnt[pos] = (cnt[pos] || 0) + 1; n++; });
      let el = Object.keys(cnt).filter(p => cnt[p] / n >= 0.02);
      const flexish = el.filter(p => ["RB", "WR", "TE"].includes(p));
      if (flexish.length >= 2) el = Array.from(new Set(el.concat(["RB", "WR", "TE"])));
      slotElig.push(new Set(el.length ? el : Object.keys(cnt)));
    }
    const slotOrder = slotElig.map((e, i) => i).sort((a, b) => slotElig[a].size - slotElig[b].size);
    teamWeeks.forEach(t => {
      const avail = t.roster.map(pid => ({ pid, pos: posOf(pid), pts: t.pp[pid] || 0 })).sort((a, b) => b.pts - a.pts);
      const used = new Set(); let opt = 0;
      slotOrder.forEach(i => { const p = avail.find(x => !used.has(x.pid) && slotElig[i].has(x.pos)); if (p) { used.add(p.pid); opt += p.pts; } });
      t.optimal = r2(Math.max(opt, t.pts)); t.lost = r2(t.optimal - t.pts); t.eff = t.optimal ? t.pts / t.optimal : 1;
      // Start/sit regret: for each starting slot, the best eligible bench player who outscored the starter
      const startIds = new Set(t.starters.map(x => x.pid));
      const bench = avail.filter(x => !startIds.has(x.pid) && x.pts > 0);
      t.regrets = [];
      // Every bench-for-starter swap worth 5+ points, then take the biggest first so each player is used once
      const cand = [];
      t.starters.forEach((sp, i) => { if (!slotElig[i]) return; bench.forEach(x => { if (slotElig[i].has(x.pos) && x.pts - sp.pts >= 5) cand.push({ i, sp, x, diff: x.pts - sp.pts }); }); });
      cand.sort((p, q) => q.diff - p.diff);
      const usedSlot = new Set(), usedBench = new Set();
      cand.forEach(({ i, sp, x, diff }) => { if (usedSlot.has(i) || usedBench.has(x.pid)) return; usedSlot.add(i); usedBench.add(x.pid); t.regrets.push({ starter: sp.pid, sPts: sp.pts, bench: x.pid, bPts: x.pts, diff: r2(diff), pos: posOf(sp.pid) || [...slotElig[i]][0] }); });
      t.regret = t.regrets.slice().sort((p, q) => q.diff - p.diff)[0] || null;
    });

    // Standings
    const st = {};
    Object.values(rosterOwner).forEach(uid => { st[uid] = { uid, team: teamName[uid], w: 0, l: 0, t: 0, pf: 0, pa: 0, allW: 0, allL: 0, allT: 0, medW: 0, medL: 0, medT: 0, opt: 0, closeL: 0, scores: [], seq: [], hi: 0, lo: Infinity }; });
    for (const w of regWeeks) {
      const list = teamWeeks.filter(t => t.week === w);
      const sortedPts = list.map(t => t.pts).sort((a, b) => a - b);
      const mid = sortedPts.length ? (sortedPts.length % 2 ? sortedPts[(sortedPts.length - 1) / 2] : (sortedPts[sortedPts.length / 2 - 1] + sortedPts[sortedPts.length / 2]) / 2) : 0;
      for (const t of list) {
        const row = st[t.uid];
        if (t.pts > mid) row.medW++; else if (t.pts < mid) row.medL++; else row.medT++;
        row.opt += t.optimal; row.scores.push(t.pts);
        if (t.result === "L" && t.oppPts - t.pts < 5) row.closeL++;
        row.pf += t.pts; row.hi = Math.max(row.hi, t.pts); row.lo = Math.min(row.lo, t.pts);
        if (t.result) { row[t.result.toLowerCase()]++; row.pa += t.oppPts; row.seq.push(t.result); }
        list.forEach(o => { if (o === t) return; if (t.pts > o.pts) row.allW++; else if (t.pts < o.pts) row.allL++; else row.allT++; });
      }
    }
    const standings = Object.values(st).map(row => {
      const gp = row.w + row.l + row.t;
      const allG = row.allW + row.allL + row.allT;
      const exp = allG ? (row.allW + row.allT / 2) / allG * gp : 0;
      let streak = "";
      if (row.seq.length) { const last = row.seq[row.seq.length - 1]; let n = 0; for (let i = row.seq.length - 1; i >= 0 && row.seq[i] === last; i--) n++; streak = last + n; }
      const mean = row.scores.length ? row.scores.reduce((a, b) => a + b, 0) / row.scores.length : 0;
      const sd = row.scores.length > 1 ? Math.sqrt(row.scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (row.scores.length - 1)) : 0;
      return { ...row, pf: r2(row.pf), pa: r2(row.pa), gp, expW: r2(exp), luck: r2(row.w + row.t / 2 - exp), streak, lo: row.lo === Infinity ? 0 : row.lo, eff: row.opt ? row.pf / row.opt : 1, lostPts: r2(row.opt - row.pf), sd: r2(sd), avg: r2(mean) };
    }).sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2) || b.pf - a.pf);
    standings.forEach((row, i) => { row.rank = i + 1; });

    // Playoffs
    const wb = s.winners_bracket || [];
    const final = wb.find(g => g.p === 1 && g.w);
    const champion = final ? rosterOwner[final.w] : null;
    const runnerUp = final ? rosterOwner[final.l] : null;
    const playoffUids = new Set();
    const lastWeek = weeks[weeks.length - 1] || 0;
    if (lastWeek >= pws) wb.forEach(g => { [g.t1, g.t2].forEach(x => { if (typeof x === "number") playoffUids.add(rosterOwner[x]); }); });
    games.forEach(g => { g.kind = !g.playoff ? "regular" : (playoffUids.has(g.a.uid) && playoffUids.has(g.b.uid) ? "playoff" : "consolation"); });
    if (champion && runnerUp) { const tg = games.filter(g => g.kind === "playoff" && [g.a.uid, g.b.uid].includes(champion) && [g.a.uid, g.b.uid].includes(runnerUp)).pop(); if (tg) tg.title = true; }

    // Byes: playoff teams that skip round 1 of the winners bracket
    const r1Teams = new Set(); wb.filter(g => g.r === 1).forEach(g => [g.t1, g.t2].forEach(x => { if (typeof x === "number") r1Teams.add(x); }));
    const ptSetting = (s.league.settings && s.league.settings.playoff_teams) || 6;
    const byes = r1Teams.size ? Math.max(0, ptSetting - r1Teams.size) : null;
    // Toilet bowl: in Sleeper's toilet bowl mode the lower score advances, so check the scores before naming the lid holder
    let lid = null, toilet = false, finalTable = null;
    const lb = s.losers_bracket || [];
    if (s.league.status === "complete") {
      const ptsOf = (rid, r) => { const t = teamWeeks.find(x => x.rid === rid && x.week === pws + r - 1); return t ? t.pts : null; };
      let lowerAdvances = 0, higherAdvances = 0;
      lb.forEach(g => { if (!g.w || !g.l) return; const pw = ptsOf(g.w, g.r), pl = ptsOf(g.l, g.r); if (pw == null || pl == null) return; if (pw < pl) lowerAdvances++; else if (pw > pl) higherAdvances++; });
      const fin = lb.find(g => g.p === 1 && g.w);
      toilet = lowerAdvances > higherAdvances;
      if (fin && toilet) lid = rosterOwner[fin.w];
      else if (standings.length) lid = standings[standings.length - 1].uid;
      // The lid game: the toilet bowl game that settles last place. Toilet mode: the p=1 game. Normal mode: the game for last place.
      const Nt = standings.length, ptl = (s.league.settings && s.league.settings.playoff_teams) || 6;
      const lg = toilet ? fin : lb.find(g => g.p && g.w && g.l && ptl + g.p + 1 === Nt);
      if (lg && lid && [rosterOwner[lg.w], rosterOwner[lg.l]].includes(lid)) {
        const u1 = rosterOwner[lg.w], u2 = rosterOwner[lg.l], wk = pws + lg.r - 1;
        const gm = games.find(g => g.kind === "consolation" && g.week === wk && [g.a.uid, g.b.uid].includes(u1) && [g.a.uid, g.b.uid].includes(u2));
        if (gm) gm.lidGame = true;
      }

      // Final standings after the playoffs
      const N = standings.length, pt = (s.league.settings && s.league.settings.playoff_teams) || 6;
      const place = {};
      wb.forEach(g => { if (g.p && g.w && g.l) { place[rosterOwner[g.w]] = g.p; place[rosterOwner[g.l]] = g.p + 1; } });
      lb.forEach(g => { if (!g.p || !g.w || !g.l) return; if (toilet) { place[rosterOwner[g.w]] = N - g.p + 1; place[rosterOwner[g.l]] = N - g.p; } else { place[rosterOwner[g.w]] = pt + g.p; place[rosterOwner[g.l]] = pt + g.p + 1; } });
      const used = new Set(Object.values(place));
      const open = []; for (let i = 1; i <= N; i++) if (!used.has(i)) open.push(i);
      standings.filter(r => place[r.uid] == null).forEach((r, i) => { place[r.uid] = open[i]; });
      finalTable = standings.map(r => {
        const post = teamWeeks.filter(t => t.uid === r.uid && t.playoff && t.game);
        const pw = post.filter(t => t.result === "W").length, pl = post.filter(t => t.result === "L").length, ptie = post.filter(t => t.result === "T").length;
        const inBracket = playoffUids.has(r.uid);
        const label = r.uid === champion ? "Champion" : r.uid === runnerUp ? "Runner-up" : place[r.uid] === 3 && inBracket ? "Third place" : r.uid === lid ? "Toilet bowl lid" : inBracket ? "Playoffs" : "Toilet bowl";
        return { ...r, finish: place[r.uid], seed: r.rank, pw, pl, pt: ptie, postPts: r2(post.reduce((a, t) => a + t.pts, 0)), label, inBracket };
      }).sort((a, b) => a.finish - b.finish);
    }

    // Draft
    const drafted = (s.picks || []).map(p => ({ ...p, uid: (p.picked_by && owners[p.picked_by]) ? p.picked_by : rosterOwner[p.roster_id], name: pinfo(p.player_id)[0], position: p.position || pinfo(p.player_id)[1], seasonPts: r2(playerSeasonPts[p.player_id] || 0) }));
    const byPts = drafted.slice().sort((a, b) => b.seasonPts - a.seasonPts);
    byPts.forEach((p, i) => { p.ptsRank = i + 1; p.value = p.pick_no - p.ptsRank; });
    const posRank = {};
    drafted.slice().sort((a, b) => b.seasonPts - a.seasonPts).forEach(p => { posRank[p.position] = (posRank[p.position] || 0) + 1; p.posRank = p.position + posRank[p.position]; });

    // Moves. A trade undone by the mirror-image trade within 48 hours is ignored everywhere: both legs are dropped.
    const moves = [];
    const reversed = reversedTrades(Object.values(s.transactions || {}).flat());
    Object.values(s.transactions || {}).flat().filter(tx => !reversed.has(tx)).forEach(tx => {
      const leg = tx.leg || 1;
      const poStarterPts = (pid, rid) => r2(teamWeeks.filter(t => t.rid === rid && t.week >= leg && t.game && t.game.kind === "playoff").reduce((acc, t) => acc + t.starters.filter(x => x.pid === pid).reduce((a, x) => a + x.pts, 0), 0));
      const starterPts = (pid, rid) => r2(teamWeeks.filter(t => t.rid === rid && t.week >= leg).reduce((acc, t) => acc + t.starters.filter(x => x.pid === pid).reduce((a, x) => a + x.pts, 0), 0));
      if (tx.type === "trade") {
        const sides = (tx.roster_ids || []).map(rid => {
          const got = Object.entries(tx.adds || {}).filter(([, to]) => to === rid).map(([pid]) => ({ pid, name: pinfo(pid)[0], pos: pinfo(pid)[1], pts: starterPts(pid, rid), poPts: poStarterPts(pid, rid) }));
          return { uid: rosterOwner[rid], rid, got, poIn: r2(got.reduce((a, x) => a + x.poPts, 0)), total: r2(got.reduce((a, x) => a + x.pts, 0)), picks: (tx.draft_picks || []).filter(d => d.owner_id === rid).map(d => d.season + " round " + d.round) };
        });
        sides.forEach(sd => {
          sd.gave = Object.entries(tx.drops || {}).filter(([, from]) => from === sd.rid).map(([pid]) => {
            const to = sides.find(o => o.got.some(g => g.pid === pid));
            const g = to && to.got.find(x => x.pid === pid);
            return { pid, name: pinfo(pid)[0], pos: pinfo(pid)[1], pts: g ? g.pts : 0 };
          });
          sd.given = r2(sd.gave.reduce((acc, x) => acc + x.pts, 0));
          sd.net = r2(sd.total - sd.given);
          sd.ring = sd.uid === champion && sd.poIn > 0;
        });
        moves.push({ type: "trade", week: leg, sides });
      } else {
        Object.entries(tx.adds || {}).forEach(([pid, rid]) => {
          const dropped = Object.entries(tx.drops || {}).filter(([, from]) => from === rid).map(([d]) => pinfo(d)[0]);
          moves.push({ type: tx.type, week: leg, uid: rosterOwner[rid], rid, pid, name: pinfo(pid)[0], pos: pinfo(pid)[1], pts: starterPts(pid, rid), dropped });
        });
        Object.entries(tx.drops || {}).forEach(([pid, rid]) => {
          if (Object.values(tx.adds || {}).includes(rid)) return;
          moves.push({ type: "drop", week: leg, uid: rosterOwner[rid], rid, pid, name: pinfo(pid)[0], pos: pinfo(pid)[1], pts: 0, dropped: [] });
        });
      }
    });

    // Wire activity: one event per free agent or waiver move, timed in Central time
    const wire = [];
    const raw = Object.values(s.transactions || {}).flat().filter(tx => (tx.type === "free_agent" || tx.type === "waiver") && tx.created).sort((p, q) => p.created - q.created);
    const usedDrop = new Set();
    const addOnly = raw.filter(tx => tx.type === "free_agent" && Object.keys(tx.adds || {}).length && !Object.keys(tx.drops || {}).length);
    const dropOnly = raw.filter(tx => tx.type === "free_agent" && !Object.keys(tx.adds || {}).length && Object.keys(tx.drops || {}).length);
    const pairedAdd = new Set();
    addOnly.forEach(a => { const rid = Object.values(a.adds)[0]; const d = dropOnly.find(x => !usedDrop.has(x) && Object.values(x.drops)[0] === rid && Math.abs(x.created - a.created) <= 120000); if (d) { usedDrop.add(d); pairedAdd.add(a); } });
    raw.forEach(tx => {
      if (usedDrop.has(tx)) return;
      const hasAdd = Object.keys(tx.adds || {}).length > 0, hasDrop = Object.keys(tx.drops || {}).length > 0;
      const kind = tx.type === "waiver" ? "claim" : hasAdd && (hasDrop || pairedAdd.has(tx)) ? "adddrop" : hasAdd ? "add" : "drop";
      const rid = Object.values(tx.adds || {})[0] || Object.values(tx.drops || {})[0];
      const uid = rosterOwner[rid]; if (!uid) return;
      wire.push({ uid, kind, ms: tx.created, leg: tx.leg || 1, ...ctParts(tx.created), adds: Object.keys(tx.adds || {}), drops: Object.keys(tx.drops || {}) });
    });

    // Current rosters: the latest scored week's rosters, then every move logged after it
    const lastW = weeks[weeks.length - 1];
    const ridOf = {}; Object.entries(rosterOwner).forEach(([rid, u]) => { ridOf[u] = +rid; });
    const curRoster = {};
    teamWeeks.filter(t => t.week === lastW).forEach(t => { curRoster[t.uid] = new Set(t.roster); });
    const recent = new Set();
    Object.values(s.transactions || {}).flat().filter(tx => (tx.leg || 0) > (lastW || 0)).sort((p, q) => (p.created || 0) - (q.created || 0)).forEach(tx => {
      Object.keys(tx.adds || {}).forEach(pid => recent.add(pid));
      Object.entries(tx.drops || {}).forEach(([pid, rid]) => { const u = rosterOwner[rid]; if (curRoster[u]) curRoster[u].delete(pid); });
      Object.entries(tx.adds || {}).forEach(([pid, rid]) => { const u = rosterOwner[rid]; if (curRoster[u]) curRoster[u].add(pid); });
    });
    const currentRosters = {}; Object.entries(curRoster).forEach(([u, set]) => { currentRosters[u] = [...set]; });
    // League points per game this season, counting only weeks a player scored
    const ppgLeague = {};
    { const acc = {}; teamWeeks.filter(t => t.game).forEach(t => Object.entries(t.pp || {}).forEach(([pid, v]) => { if (v > 0) { const a = acc[pid] || (acc[pid] = [0, 0]); a[0] += v; a[1]++; } })); Object.entries(acc).forEach(([pid, [sum, n]]) => { ppgLeague[pid] = sum / n; }); }

    seasons.push({
      year, name: s.league.name, status: s.league.status, pws, playoffTeams: (s.league.settings && s.league.settings.playoff_teams) || 6, weeks, regWeeks,
      playoffWeeks: weeks.filter(w => w >= pws), complete: s.league.status === "complete",
      teamName, uids: Object.values(rosterOwner), teamWeeks, games, standings,
      champion, runnerUp, lid, finalTable, wire, schedule: s.schedule || {}, rosterOwner, byes, currentRosters, recentAdds: recent, ppgLeague, slotElig, slotOrder, posOf, playoffUids, drafted, moves, pinfo, txs: Object.values(s.transactions || {}).flat().filter(tx => !reversed.has(tx)).sort((p, q) => (p.created || 0) - (q.created || 0)),
    });
  }

  const latest = seasons[seasons.length - 1];
  const active = new Set(latest ? latest.uids : []);
  Object.values(owners).forEach(o => { o.active = active.has(o.uid); });
  return { owners, seasons, latest, players, example: !!raw.example, exported: raw.exported, injuries: raw.injuries || {}, projections: raw.projections || null };
}

function weekAwards(season, week) {
  const tws = season.teamWeeks.filter(t => t.week === week && t.result);
  if (!tws.length) return [];
  const max = (arr, f) => arr.reduce((b, x) => (f(x) > f(b) ? x : b), arr[0]);
  const min = (arr, f) => arr.reduce((b, x) => (f(x) < f(b) ? x : b), arr[0]);
  const out = [];
  const hi = max(tws, t => t.pts);
  out.push({ key: "high", title: "Amen Corner", uid: hi.uid, value: hi.pts, note: "Top score. Can I get an amen?" });
  const lo = min(tws, t => t.pts);
  out.push({ key: "low", title: "Bless Your Heart", uid: lo.uid, value: lo.pts, note: "Lowest score of the week" });
  const losses = tws.filter(t => t.result === "L");
  if (losses.length) { const x = max(losses, t => t.pts); out.push({ key: "tough", title: "Left at the Altar", uid: x.uid, value: x.pts, note: "Most points in a loss" }); }
  const winsArr = tws.filter(t => t.result === "W");
  if (winsArr.length) { const x = min(winsArr, t => t.pts); out.push({ key: "lucky", title: "Saved by Grace", uid: x.uid, value: x.pts, note: "Fewest points in a win" }); }
  const wks = season.games.filter(g => g.week === week);
  if (wks.length) {
    const blow = max(wks, g => g.margin);
    const winner = blow.a.pts >= blow.b.pts ? blow.a : blow.b;
    out.push({ key: "blowout", title: "Fire and Brimstone", uid: winner.uid, value: blow.margin, note: "Biggest winning margin", vs: winner === blow.a ? blow.b.uid : blow.a.uid });
    const close = min(wks, g => g.margin);
    const cw = close.a.pts >= close.b.pts ? close.a : close.b;
    out.push({ key: "close", title: "All Four Verses", uid: cw.uid, value: close.margin, note: "Closest game, sung to the end", vs: cw === close.a ? close.b.uid : close.a.uid });
  }
  const asleep = max(tws, t => t.lost);
  if (asleep.lost > 0) out.push({ key: "asleep", title: "Asleep in the Pew", uid: asleep.uid, value: asleep.lost, note: "Points lost to lineup choices" });
  if (!tws[0].playoff && week >= 3) {
    const prior = {};
    season.teamWeeks.filter(t => t.week < week && t.result && !t.playoff).forEach(t => { const p = prior[t.uid] || (prior[t.uid] = { w: 0, g: 0 }); p.g++; if (t.result === "W") p.w++; else if (t.result === "T") p.w += 0.5; });
    const pct = uid => prior[uid] && prior[uid].g ? prior[uid].w / prior[uid].g : 0.5;
    let up = null;
    tws.filter(t => t.result === "W").forEach(t => { const gap = pct(t.opp) - pct(t.uid); if (gap > 0 && (!up || gap > up.gap)) up = { t, gap }; });
    if (up && up.gap >= 0.2) out.push({ key: "upset", title: "David and Goliath", uid: up.t.uid, value: up.t.pts, note: "Biggest upset by record", vs: up.t.opp, gap: up.gap });
  }
  // Bad beat: the loss with the most teams outscored that week
  const others = tws.length - 1;
  const beatCount = t => tws.filter(o => o !== t && t.pts > o.pts).length;
  const bb = losses.length ? losses.map(t => ({ t, n: beatCount(t) })).sort((p, q) => q.n - p.n || q.t.pts - p.t.pts)[0] : null;
  if (bb && others >= 3 && bb.n >= Math.ceil(others * 0.7)) out.push({ key: "badbeat", title: "Bad Beat", uid: bb.t.uid, value: bb.t.pts, note: `Beat ${bb.n} of ${others} teams and still lost`, vs: bb.t.opp, beat: bb.n, of: others });
  const rg = tws.filter(t => t.regret).sort((p, q) => q.regret.diff - p.regret.diff)[0];
  if (rg) { const r = rg.regret; out.push({ key: "regret", title: "Sat the Wrong Guy", uid: rg.uid, value: r.diff, note: `Benched ${season.pinfo(r.bench)[0]} (${r.bPts.toFixed(1)}) for ${season.pinfo(r.starter)[0]} (${r.sPts.toFixed(1)})`, regret: r, lostGame: rg.result === "L" && rg.oppPts - rg.pts < r.diff }); }
  const bench = max(tws, t => t.bench);
  out.push({ key: "bench", title: "Leftover Casserole", uid: bench.uid, value: bench.bench, note: "Most points left on the bench" });
  let best = null;
  tws.forEach(t => t.starters.forEach(s => { if (s.pid !== "0" && (!best || s.pts > best.pts)) best = { ...s, uid: t.uid }; }));
  if (best) { const info = season.pinfo(best.pid); out.push({ key: "player", title: "Sunday School Star", uid: best.uid, value: best.pts, pid: best.pid, note: info[0] + (info[1] ? " · " + info[1] : "") }); }
  return out;
}

// Postseason games (championship bracket and toilet bowl) count whenever the postseason filter is on
const counts = (kind, withPO) => kind === "regular" || (withPO && (kind === "playoff" || kind === "consolation"));

function seasonRecords(season, withPO) {
  const tws = season.teamWeeks.filter(t => t.game && counts(t.game.kind, withPO));
  const top = tws.slice().sort((a, b) => b.pts - a.pts).slice(0, 3);
  const bottom = tws.slice().sort((a, b) => a.pts - b.pts).slice(0, 3);
  const blow = season.games.filter(g => counts(g.kind, withPO)).sort((a, b) => b.margin - a.margin).slice(0, 3);
  let streak = null;
  season.uids.forEach(uid => {
    let run = 0;
    tws.filter(t => t.uid === uid).sort((a, b) => a.week - b.week).forEach(t => {
      run = t.result === "W" ? run + 1 : 0;
      if (run && (!streak || run > streak.n)) streak = { uid, n: run };
    });
  });
  return { top, bottom, blow, streak };
}

function allTime(model, withPO) {
  const rows = {};
  Object.values(model.owners).forEach(o => { rows[o.uid] = { uid: o.uid, name: o.name, active: o.active, seasons: o.seasons.length, w: 0, l: 0, t: 0, pf: 0, games: 0, playoffs: 0, titles: 0, finals: 0, lids: 0, best: null }; });
  model.seasons.forEach(s => {
    s.standings.forEach(st => {
      const r = rows[st.uid]; if (!r) return;
      r.w += st.w; r.l += st.l; r.t += st.t; r.pf += st.pf; r.games += st.gp;
      if (s.complete && (r.best == null || st.rank < r.best)) r.best = st.rank;
    });
    if (withPO) s.games.filter(g => g.kind === "playoff" || g.kind === "consolation").forEach(g => {
      [[g.a, g.b], [g.b, g.a]].forEach(([me, them]) => {
        const r = rows[me.uid]; if (!r) return;
        if (me.pts > them.pts) r.w++; else if (me.pts < them.pts) r.l++; else r.t++;
        r.pf += me.pts; r.games++;
      });
    });
    s.playoffUids.forEach(uid => { if (rows[uid]) rows[uid].playoffs++; });
    if (s.champion && rows[s.champion]) { rows[s.champion].titles++; rows[s.champion].finals++; }
    if (s.runnerUp && rows[s.runnerUp]) rows[s.runnerUp].finals++;
    if (s.lid && rows[s.lid]) rows[s.lid].lids++;
  });
  const table = Object.values(rows).map(r => ({ ...r, pf: Math.round(r.pf * 100) / 100, pct: r.games ? (r.w + r.t / 2) / r.games : 0, ppg: r.games ? r.pf / r.games : 0 }))
    .sort((a, b) => b.titles - a.titles || b.pct - a.pct || b.pf - a.pf);
  const allTw = model.seasons.flatMap(s => s.teamWeeks.filter(t => t.game && counts(t.game.kind, withPO)).map(t => ({ ...t, year: s.year })));
  const allGames = model.seasons.flatMap(s => s.games.filter(g => counts(g.kind, withPO)).map(g => ({ ...g, year: s.year })));
  const champs = model.seasons.map(s => ({ year: s.year, champion: s.champion, runnerUp: s.runnerUp, lid: s.lid, team: s.champion ? s.teamName[s.champion] : null, complete: s.complete }));
  return {
    table, champs,
    top: allTw.slice().sort((a, b) => b.pts - a.pts).slice(0, 5),
    bottom: allTw.slice().sort((a, b) => a.pts - b.pts).slice(0, 5),
    blow: allGames.slice().sort((a, b) => b.margin - a.margin).slice(0, 5),
    close: allGames.slice().sort((a, b) => a.margin - b.margin).slice(0, 5),
  };
}

function headToHead(model, uid, year, withPO) {
  const out = {};
  model.seasons.forEach(s => {
    if (year && s.year !== year) return;
    s.games.filter(g => counts(g.kind, withPO)).forEach(g => {
      let me, them;
      if (g.a.uid === uid) { me = g.a; them = g.b; } else if (g.b.uid === uid) { me = g.b; them = g.a; } else return;
      const r = out[them.uid] || (out[them.uid] = { uid: them.uid, w: 0, l: 0, t: 0, pf: 0, pa: 0, playoff: 0, title: 0, last: null });
      if (me.pts > them.pts) r.w++; else if (me.pts < them.pts) r.l++; else r.t++;
      r.pf += me.pts; r.pa += them.pts; if (g.kind === "playoff") r.playoff++; if (g.title) r.title++;
      r.last = { year: s.year, week: g.week, me: me.pts, them: them.pts, kind: g.kind, title: !!g.title, lidGame: !!g.lidGame };
    });
  });
  return Object.values(out).map(r => ({ ...r, pf: Math.round(r.pf * 100) / 100, pa: Math.round(r.pa * 100) / 100, games: r.w + r.l + r.t }))
    .sort((a, b) => b.games - a.games || (b.w - b.l) - (a.w - a.l));
}

function allPlay(model, year) {
  const rows = {};
  model.seasons.forEach(s => {
    if (year && s.year !== year) return;
    s.standings.forEach(r => {
      const x = rows[r.uid] || (rows[r.uid] = { uid: r.uid, w: 0, l: 0, t: 0, allW: 0, allL: 0, allT: 0, medW: 0, medL: 0, medT: 0, expW: 0, luck: 0, seasons: 0 });
      x.medW += r.medW; x.medL += r.medL; x.medT += r.medT;
      x.w += r.w; x.l += r.l; x.t += r.t; x.allW += r.allW; x.allL += r.allL; x.allT += r.allT; x.expW += r.expW; x.luck += r.luck; x.seasons++;
    });
  });
  return Object.values(rows).map(x => { const g = x.allW + x.allL + x.allT; return { ...x, pct: g ? (x.allW + x.allT / 2) / g : 0, expW: Math.round(x.expW * 100) / 100, luck: Math.round(x.luck * 100) / 100 }; })
    .sort((a, b) => b.pct - a.pct);
}

function tradeLedger(model, year) {
  const rows = {};
  model.seasons.forEach(s => {
    if (year && s.year !== year) return;
    s.moves.filter(m => m.type === "trade").forEach(t => t.sides.forEach(sd => {
      const x = rows[sd.uid] || (rows[sd.uid] = { uid: sd.uid, trades: 0, pin: 0, pout: 0, net: 0, poIn: 0, rings: 0, ringYears: [], best: null, worst: null });
      x.trades++; x.pin += sd.total; x.pout += sd.given; x.net += sd.net; x.poIn += sd.poIn;
      if (sd.ring) { x.rings++; if (!x.ringYears.includes(s.year)) x.ringYears.push(s.year); }
      const rec = { year: s.year, week: t.week, net: sd.net, got: sd.got.map(g => g.name), gave: sd.gave.map(g => g.name) };
      if (!x.best || sd.net > x.best.net) x.best = rec;
      if (!x.worst || sd.net < x.worst.net) x.worst = rec;
    }));
  });
  return Object.values(rows).map(x => ({ ...x, poIn: Math.round(x.poIn * 10) / 10, pin: Math.round(x.pin * 10) / 10, pout: Math.round(x.pout * 10) / 10, net: Math.round(x.net * 10) / 10 }))
    .sort((a, b) => b.net - a.net);
}

function reportCard(model, season) {
  const prev = model.seasons[model.seasons.indexOf(season) - 1];
  const prevAll = {};
  if (prev) prev.standings.forEach(r => { const g = r.allW + r.allL + r.allT; prevAll[r.uid] = g ? (r.allW + r.allT / 2) / g : null; });
  const upsets = {};
  season.regWeeks.forEach(w => { weekAwards(season, w).filter(a => a.key === "upset").forEach(a => { upsets[a.uid] = (upsets[a.uid] || 0) + 1; }); });
  const wrong = {}, beats = {};
  season.teamWeeks.filter(t => t.game && t.game.kind === "regular").forEach(t => { wrong[t.uid] = (wrong[t.uid] || 0) + (t.regrets || []).length; });
  season.regWeeks.forEach(w => { const tws = season.teamWeeks.filter(t => t.week === w && t.game); tws.filter(t => t.result === "L").forEach(t => { const n = tws.filter(o => o !== t && t.pts > o.pts).length; if (tws.length > 3 && n >= Math.ceil((tws.length - 1) * 0.7)) beats[t.uid] = (beats[t.uid] || 0) + 1; }); });
  const rows = season.standings.map(r => {
    const g = r.allW + r.allL + r.allT; const ap = g ? (r.allW + r.allT / 2) / g : 0;
    return { uid: r.uid, eff: r.eff, lost: r.lostPts, med: [r.medW, r.medL, r.medT], sd: r.sd, avg: r.avg, closeL: r.closeL, gp: r.gp, ap, improve: prevAll[r.uid] != null ? ap - prevAll[r.uid] : null, upsets: upsets[r.uid] || 0, wrong: wrong[r.uid] || 0, badBeats: beats[r.uid] || 0 };
  });
  const by = (f, dir) => rows.filter(r => f(r) != null).slice().sort((a, b) => dir * (f(b) - f(a)))[0];
  const awards = [];
  if (rows.length && season.regWeeks.length >= 2) {
    const coach = by(r => r.eff, 1); awards.push({ title: "Coach of the Year", uid: coach.uid, value: (coach.eff * 100).toFixed(1) + "%", note: "Best lineup efficiency" });
    const nap = by(r => r.eff, -1); awards.push({ title: "Needs a Nudge", uid: nap.uid, value: (nap.eff * 100).toFixed(1) + "%", note: "Worst lineup efficiency" });
    const steady = by(r => r.sd, -1); awards.push({ title: "Steady as a Hymn", uid: steady.uid, value: steady.sd.toFixed(1), note: "Most consistent weekly scores (std dev)" });
    const boom = by(r => r.sd, 1); awards.push({ title: "Boom or Bust", uid: boom.uid, value: boom.sd.toFixed(1), note: "Wildest weekly swings (std dev)" });
    const job = by(r => r.closeL, 1); if (job.closeL) awards.push({ title: "Trials of Job", uid: job.uid, value: job.closeL + (job.closeL === 1 ? " loss" : " losses"), note: "Most losses by under 5 points" });
    const slayer = by(r => r.upsets, 1); if (slayer.upsets) awards.push({ title: "Giant Slayer", uid: slayer.uid, value: slayer.upsets + (slayer.upsets === 1 ? " upset" : " upsets"), note: "Most weeks with the biggest upset" });
    const snake = by(r => r.badBeats, 1); if (snake.badBeats) awards.push({ title: "Snakebit", uid: snake.uid, value: snake.badBeats + (snake.badBeats === 1 ? " bad beat" : " bad beats"), note: "Most losses while outscoring 70% of the league" });
    const born = by(r => r.improve, 1); if (born && born.improve > 0) awards.push({ title: "Born Again", uid: born.uid, value: "+" + (born.improve * 100).toFixed(1), note: "Biggest all-play gain from " + prev.year });
  }
  return { rows, awards };
}

function powerRankings(season) {
  const regs = season.regWeeks; if (!regs.length) return [];
  const last3 = regs.slice(-3);
  const rows = season.standings.map(r => {
    const g = r.allW + r.allL + r.allT; const ap = g ? (r.allW + r.allT / 2) / g : 0;
    const recent = season.teamWeeks.filter(t => t.uid === r.uid && last3.includes(t.week));
    const rAvg = recent.length ? recent.reduce((a, t) => a + t.pts, 0) / recent.length : 0;
    return { uid: r.uid, w: r.w, l: r.l, t: r.t, ap, ppg: r.gp ? r.pf / r.gp : 0, recent: rAvg };
  });
  const pctRank = (f) => { const s = rows.map(f).sort((a, b) => a - b); return v => s.length > 1 ? s.indexOf(v) / (s.length - 1) : 1; };
  const rp = pctRank(r => r.ppg), rr = pctRank(r => r.recent);
  rows.forEach(r => { r.score = 100 * (0.5 * r.ap + 0.25 * rp(r.ppg) + 0.25 * rr(r.recent)); });
  return rows.sort((a, b) => b.score - a.score);
}

function scheduleSwap(season, uid) {
  const out = [];
  const tw = {}; season.teamWeeks.filter(t => !t.playoff && t.result).forEach(t => { tw[t.week + ":" + t.uid] = t; });
  season.uids.forEach(other => {
    let w = 0, l = 0, t = 0;
    season.regWeeks.forEach(wk => {
      const mine = tw[wk + ":" + uid], theirs = tw[wk + ":" + other];
      if (!mine || !theirs) return;
      const oppUid = theirs.opp === uid ? other : theirs.opp;
      const opp = tw[wk + ":" + oppUid]; if (!opp) return;
      if (mine.pts > opp.pts) w++; else if (mine.pts < opp.pts) l++; else t++;
    });
    out.push({ uid: other, w, l, t, own: other === uid });
  });
  return out.sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2));
}

function memberProfile(model, uid) {
  const o = model.owners[uid];
  const at = allTime(model, false).table.find(r => r.uid === uid) || {};
  const ap = allPlay(model).find(r => r.uid === uid) || {};
  const h2h = headToHead(model, uid, null, true);
  const enough = h2h.filter(r => r.games >= 3);
  const pctOf = r => (r.w + r.t / 2) / r.games;
  const rival = h2h[0] || null;
  const nemesis = enough.slice().sort((a, b) => pctOf(a) - pctOf(b))[0] || null;
  const victim = enough.slice().sort((a, b) => pctOf(b) - pctOf(a))[0] || null;
  const starts = {}; let hi = null, lo = null, opt = 0, pts = 0;
  const finishes = [];
  model.seasons.forEach(s => {
    s.teamWeeks.filter(t => t.uid === uid).forEach(t => {
      t.starters.forEach(p => { if (p.pid === "0") return; const x = starts[p.pid] || (starts[p.pid] = { pid: p.pid, name: s.pinfo(p.pid)[0], pos: s.pinfo(p.pid)[1], n: 0, pts: 0 }); x.n++; x.pts += p.pts; });
      if (t.result && !t.playoff) { if (!hi || t.pts > hi.pts) hi = { pts: t.pts, year: s.year, week: t.week }; if (!lo || t.pts < lo.pts) lo = { pts: t.pts, year: s.year, week: t.week }; opt += t.optimal; pts += t.pts; }
    });
    if (s.uids.includes(uid)) {
      const ft = s.finalTable && s.finalTable.find(r => r.uid === uid);
      const reg = s.standings.find(r => r.uid === uid);
      finishes.push({ year: s.year, team: s.teamName[uid], finish: ft ? ft.finish : null, seed: reg ? reg.rank : null, rec: reg ? reg.w + "-" + reg.l + (reg.t ? "-" + reg.t : "") : "", label: ft ? ft.label : "In progress", of: s.uids.length });
    }
  });
  const favorites = Object.values(starts).sort((a, b) => b.n - a.n || b.pts - a.pts).slice(0, 3);
  const ledger = tradeLedger(model).find(r => r.uid === uid) || null;
  let bestPick = null;
  model.seasons.forEach(s => s.drafted.filter(p => p.uid === uid && s.complete).forEach(p => { if (!bestPick || p.value > bestPick.value) bestPick = { ...p, year: s.year }; }));
  return { o, at, ap, rival, nemesis, victim, favorites, hi, lo, eff: opt ? pts / opt : null, finishes, ledger, bestPick };
}

// Central time parts. The fantasy day starts at 4 a.m., so a 1 a.m. move belongs to the night before.
const CT_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", weekday: "short", hourCycle: "h23" });
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function ctParts(ms) {
  const p = {}; CT_FMT.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  const hour = (+p.hour) % 24, minute = +p.minute;
  let day = DAYS.indexOf(p.weekday);
  const fromFour = ((hour - 4 + 24) % 24) * 60 + minute;
  if (hour < 4) day = (day + 6) % 7;
  return { hour, minute, day, fromFour };
}
const BLOCKS = [
  { key: "early", name: "Early Service", from: 0, to: 240 },     // 4 to 8 a.m.
  { key: "office", name: "Office Hours", from: 240, to: 780 },   // 8 a.m. to 5 p.m.
  { key: "supper", name: "Supper", from: 780, to: 960 },         // 5 to 8 p.m.
  { key: "evening", name: "Evening Worship", from: 960, to: 1140 }, // 8 to 11 p.m.
  { key: "night", name: "Night Watch", from: 1140, to: 1440 },   // 11 p.m. to 4 a.m.
];
const WIRE_KINDS = { pickups: ["add", "adddrop"], add: ["add"], adddrop: ["adddrop"], drop: ["drop"], claim: ["claim"] };

function wireStats(model, kindKey, year) {
  const kinds = WIRE_KINDS[kindKey] || WIRE_KINDS.pickups;
  const ev = [];
  model.seasons.forEach(s => { if (year && s.year !== year) return; s.wire.forEach(e => { if (kinds.includes(e.kind) && !(model.owners[e.uid] || {}).orphan) ev.push({ ...e, year: s.year }); }); });
  const q = (arr, p) => { if (!arr.length) return null; const i = (arr.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return arr[lo] + (arr[hi] - arr[lo]) * (i - lo); };
  const people = {};
  ev.forEach(e => {
    const x = people[e.uid] || (people[e.uid] = { uid: e.uid, n: 0, hours: Array(24).fill(0), days: Array(7).fill(0), blocks: {}, mins: [], years: new Set() });
    x.n++; x.hours[e.hour]++; x.days[e.day]++; x.mins.push(e.fromFour); x.years.add(e.year);
    const b = BLOCKS.find(b => e.fromFour >= b.from && e.fromFour < b.to); x.blocks[b.key] = (x.blocks[b.key] || 0) + 1;
  });
  const seasonsIn = uid => model.seasons.filter(s => (!year || s.year === year) && s.uids.includes(uid)).length || 1;
  const rows = Object.values(people).map(x => {
    x.mins.sort((a, b) => a - b);
    return { ...x, years: [...x.years], seasons: seasonsIn(x.uid), perSeason: x.n / seasonsIn(x.uid), med: q(x.mins, 0.5), p25: q(x.mins, 0.25), p75: q(x.mins, 0.75), share: k => (x.blocks[k] || 0) / x.n };
  });
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  ev.forEach(e => { grid[e.day][e.hour]++; });
  // Catch and release: players dropped within 24 hours of being added, same team
  const quickDrops = {};
  if (kindKey === "drop") model.seasons.forEach(s => {
    if (year && s.year !== year) return;
    const lastAdd = {};
    s.wire.slice().sort((a, b) => a.ms - b.ms).forEach(e => {
      if (model.owners[e.uid] && model.owners[e.uid].orphan) return;
      e.drops.forEach(pid => { const t0 = lastAdd[e.uid + ":" + pid]; if (t0 && e.ms - t0 <= 864e5) quickDrops[e.uid] = (quickDrops[e.uid] || 0) + 1; delete lastAdd[e.uid + ":" + pid]; });
      e.adds.forEach(pid => { lastAdd[e.uid + ":" + pid] = e.ms; });
    });
  });
  return { rows, grid, total: ev.length, quickDrops };
}

function rivalryPairs(model, withPO) {
  const pairs = {};
  model.seasons.forEach(s => s.games.filter(g => counts(g.kind, withPO)).forEach(g => {
    const [x, y] = g.a.uid < g.b.uid ? [g.a, g.b] : [g.b, g.a];
    const k = x.uid + "|" + y.uid;
    const p = pairs[k] || (pairs[k] = { a: x.uid, b: y.uid, aw: 0, bw: 0, t: 0, apts: 0, bpts: 0, games: [] });
    if (x.pts > y.pts) p.aw++; else if (y.pts > x.pts) p.bw++; else p.t++;
    p.apts += x.pts; p.bpts += y.pts;
    p.games.push({ year: s.year, week: g.week, ap: x.pts, bp: y.pts, kind: g.kind, title: !!g.title, lidGame: !!g.lidGame, margin: g.margin });
  }));
  return Object.values(pairs).map(p => ({ ...p, n: p.games.length, diff: Math.abs(p.aw - p.bw), avgMargin: p.games.reduce((acc, g) => acc + g.margin, 0) / p.games.length }));
}

function pairRecord(pairs, u, v) {
  const p = pairs.find(x => (x.a === u && x.b === v) || (x.a === v && x.b === u));
  if (!p) return null;
  const flip = p.a !== u;
  return { w: flip ? p.bw : p.aw, l: flip ? p.aw : p.bw, t: p.t, n: p.n, pf: flip ? p.bpts : p.apts, pa: flip ? p.apts : p.bpts, avgMargin: p.avgMargin,
    games: p.games.map(g => ({ year: g.year, week: g.week, me: flip ? g.bp : g.ap, them: flip ? g.ap : g.bp, kind: g.kind, title: g.title, lidGame: g.lidGame, margin: g.margin })) };
}

/* ---------- Elo: every game, regular season, playoffs, and toilet bowl, in order ---------- */
function eloRatings(model) {
  const R = {}, hist = {}, peak = {};
  const K = 24, BASE = 1500;
  let first = true;
  model.seasons.forEach(s => {
    if (!first) Object.keys(R).forEach(u => { R[u] = BASE + (R[u] - BASE) * 2 / 3; (hist[u] = hist[u] || []).push({ year: s.year, week: 0, elo: R[u], carry: true }); });
    first = false;
    s.weeks.forEach(w => {
      s.games.filter(g => g.week === w).forEach(g => {
        const a = g.a.uid, b = g.b.uid;
        [a, b].forEach(u => { if (R[u] == null) { R[u] = BASE; (hist[u] = hist[u] || []).push({ year: s.year, week: w - 1, elo: BASE, start: true }); } });
        const ea = 1 / (1 + Math.pow(10, (R[b] - R[a]) / 400));
        const sa = g.a.pts > g.b.pts ? 1 : g.a.pts < g.b.pts ? 0 : 0.5;
        const diff = sa === 1 ? R[a] - R[b] : sa === 0 ? R[b] - R[a] : 0;
        const mult = sa === 0.5 ? 1 : Math.log(g.margin + 1) * (2.2 / (diff * 0.001 + 2.2));
        const delta = K * mult * (sa - ea);
        R[a] += delta; R[b] -= delta;
        [[a, delta], [b, -delta]].forEach(([u, d]) => { hist[u].push({ year: s.year, week: w, elo: R[u], d, kind: g.kind }); if (!peak[u] || R[u] > peak[u].elo) peak[u] = { elo: R[u], year: s.year, week: w }; });
      });
    });
  });
  const rows = Object.keys(R).map(u => ({ uid: u, elo: R[u], peak: peak[u] || null, hist: hist[u] || [], last: (hist[u] || []).filter(h => !h.carry && !h.start).slice(-1)[0] || null }));
  return rows.sort((p, q) => q.elo - p.elo);
}

/* ---------- Bad beats: losses while outscoring most of the league ---------- */
function badBeats(model, year) {
  const out = [];
  model.seasons.forEach(s => {
    if (year && s.year !== year) return;
    s.weeks.forEach(w => {
      const tws = s.teamWeeks.filter(t => t.week === w && t.game && t.game.kind === "regular");
      if (tws.length < 4) return;
      tws.filter(t => t.result === "L").forEach(t => { const n = tws.filter(o => o !== t && t.pts > o.pts).length; out.push({ uid: t.uid, opp: t.opp, pts: t.pts, oppPts: t.oppPts, beat: n, of: tws.length - 1, year: s.year, week: w, rate: n / (tws.length - 1) }); });
    });
  });
  return out.filter(x => x.rate >= 0.7).sort((p, q) => q.rate - p.rate || q.pts - p.pts);
}

/* ---------- Start/sit regret ---------- */
function regretList(model, year) {
  const out = [];
  model.seasons.forEach(s => { if (year && s.year !== year) return; s.teamWeeks.filter(t => t.game).forEach(t => (t.regrets || []).forEach(r => out.push({ ...r, uid: t.uid, year: s.year, week: t.week, cost: t.result === "L" && t.oppPts - t.pts < r.diff, pinfo: s.pinfo }))); });
  return out.sort((p, q) => q.diff - p.diff);
}

/* ---------- Prodigal son: dropped players who scored for someone else ---------- */
function prodigalSons(model, year) {
  const out = [];
  model.seasons.forEach(s => {
    if (year && s.year !== year) return;
    s.wire.filter(e => e.drops.length && !(model.owners[e.uid] || {}).orphan).forEach(e => e.drops.forEach(pid => {
      let pts = 0, best = null, to = {};
      s.teamWeeks.filter(t => t.week >= e.leg && t.uid !== e.uid && t.game).forEach(t => { const st = t.starters.find(x => x.pid === pid); if (st) { pts += st.pts; to[t.uid] = (to[t.uid] || 0) + st.pts; if (!best || st.pts > best.pts) best = { pts: st.pts, week: t.week, uid: t.uid }; } });
      if (pts > 0) { const main = Object.entries(to).sort((p, q) => q[1] - p[1])[0][0]; out.push({ dropper: e.uid, pid, name: s.pinfo(pid)[0], pos: s.pinfo(pid)[1], week: e.leg, pts: Math.round(pts * 10) / 10, best, to: main, year: s.year }); }
    }));
  });
  // one entry per player per season: keep the drop that cost the most
  const seen = {}; out.sort((p, q) => q.pts - p.pts);
  return out.filter(x => { const k = x.year + x.pid; if (seen[k]) return false; seen[k] = 1; return true; });
}

/* ---------- Close games: decided by under 10 points ---------- */
function closeGames(model, withPO, year) {
  const rows = {};
  model.seasons.forEach(s => { if (year && s.year !== year) return; s.games.filter(g => counts(g.kind, withPO) && g.margin < 10).forEach(g => [[g.a, g.b], [g.b, g.a]].forEach(([me, them]) => { const r = rows[me.uid] || (rows[me.uid] = { uid: me.uid, w: 0, l: 0, t: 0 }); if (me.pts > them.pts) r.w++; else if (me.pts < them.pts) r.l++; else r.t++; })); });
  return Object.values(rows).map(r => ({ ...r, n: r.w + r.l + r.t, pct: (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t) })).sort((p, q) => q.pct - p.pct || q.n - p.n);
}

/* ---------- Hot hand: last three weeks against the season average ---------- */
function hotHand(season) {
  const regs = season.regWeeks; if (regs.length < 4) return {};
  const last3 = regs.slice(-3), out = {};
  season.uids.forEach(u => {
    const all = season.teamWeeks.filter(t => t.uid === u && t.game && t.game.kind === "regular");
    const rec = all.filter(t => last3.includes(t.week));
    if (!all.length || !rec.length) return;
    const avg = all.reduce((a, t) => a + t.pts, 0) / all.length, ra = rec.reduce((a, t) => a + t.pts, 0) / rec.length;
    out[u] = { avg, recent: ra, delta: ra - avg };
  });
  return out;
}

/* ---------- Playoff odds, clinch watch, remaining schedule ---------- */
function playoffPicture(season, sims) {
  sims = sims || 10000;
  const pws = season.pws, regLeft = [];
  for (let w = (season.regWeeks[season.regWeeks.length - 1] || 0) + 1; w < pws; w++) regLeft.push(w);
  const st = {}; season.standings.forEach(r => { st[r.uid] = { w: r.w + r.t / 2, pf: r.pf }; });
  const uids = season.uids, P = season.playoffTeams, N = uids.length;
  const left = {}; uids.forEach(u => { left[u] = regLeft.length; });
  // Clinch watch: exact, using only games left. Ties count as threats because points for is not settled.
  const status = {};
  uids.forEach(u => {
    const minMe = st[u].w, maxMe = st[u].w + left[u];
    const canPass = uids.filter(o => o !== u && st[o].w + left[o] >= minMe).length;
    const surelyAbove = uids.filter(o => o !== u && st[o].w > maxMe).length;
    let magic = null;
    for (let k = 0; k <= left[u]; k++) { if (uids.filter(o => o !== u && st[o].w + left[o] >= minMe + k).length < P) { magic = k; break; } }
    status[u] = canPass < P ? "clinched" : surelyAbove >= P ? "eliminated" : "alive";
    status[u + ":magic"] = magic;
  });
  // Schedule for simulation
  const sched = [];
  regLeft.forEach(w => { const rows = (season.schedule[w] || []); const byM = {}; rows.forEach(r => { (byM[r.matchup_id] = byM[r.matchup_id] || []).push(season.rosterOwner[r.roster_id]); }); Object.values(byM).forEach(p => { if (p.length === 2 && p[0] && p[1]) sched.push({ w, a: p[0], b: p[1] }); }); });
  const haveSchedule = regLeft.length > 0 && sched.length >= regLeft.length * Math.floor(N / 2) * 0.9;
  // Scoring model: each team's mean and spread, shrunk toward the league
  const scores = {}; season.teamWeeks.filter(t => t.game && t.game.kind === "regular").forEach(t => { (scores[t.uid] = scores[t.uid] || []).push(t.pts); });
  const all = Object.values(scores).flat(); const lm = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  const lsd = Math.sqrt(all.reduce((a, b) => a + (b - lm) ** 2, 0) / Math.max(1, all.length - 1));
  const model = {}; uids.forEach(u => { const x = scores[u] || []; const n = x.length; const m = n ? x.reduce((a, b) => a + b, 0) / n : lm; const sd = n > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : lsd; model[u] = { mean: (n * m + 4 * lm) / (n + 4), sd: (n * sd + 4 * lsd) / (n + 4) }; });
  // Remaining strength of schedule: average opponent scoring mean, ranked
  const sos = {}; uids.forEach(u => { const opp = sched.filter(g => g.a === u || g.b === u).map(g => g.a === u ? g.b : g.a); sos[u] = opp.length ? { avg: opp.reduce((a, o) => a + model[o].mean, 0) / opp.length, n: opp.length, opps: opp } : null; });
  const sosRank = {}; uids.filter(u => sos[u]).sort((a, b) => sos[b].avg - sos[a].avg).forEach((u, i) => { sosRank[u] = i + 1; });
  let odds = null, stakes = null;
  if (haveSchedule) {
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const gauss = () => { let a = 0, b = 0; while (!a) a = rnd(); while (!b) b = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
    const byes = season.byes != null ? season.byes : (P === 6 ? 2 : 0);
    const cnt = {}; uids.forEach(u => { cnt[u] = { po: 0, bye: 0, top: 0, last: 0, wins: 0 }; });
    // What's at Stake: split every simulation by the result of each team's game in the next week
    const nextW = regLeft[0], nextGames = sched.filter(g => g.w === nextW);
    const cond = {}; uids.forEach(u => { cond[u] = { w: { n: 0, po: 0, last: 0 }, l: { n: 0, po: 0, last: 0 } }; });
    const wonNext = {};
    for (let i = 0; i < sims; i++) {
      const w = {}, pf = {}; uids.forEach(u => { w[u] = st[u].w; pf[u] = st[u].pf; });
      sched.forEach(g => { const sa = model[g.a].mean + model[g.a].sd * gauss(), sb = model[g.b].mean + model[g.b].sd * gauss(); pf[g.a] += sa; pf[g.b] += sb; if (sa > sb) w[g.a]++; else w[g.b]++; if (g.w === nextW) { wonNext[g.a] = sa > sb; wonNext[g.b] = sb >= sa; } });
      const order = uids.slice().sort((a, b) => w[b] - w[a] || pf[b] - pf[a]);
      order.forEach((u, k) => { if (k < P) cnt[u].po++; if (k < byes) cnt[u].bye++; if (k === 0) cnt[u].top++; if (k === N - 1) cnt[u].last++; cnt[u].wins += w[u];
        if (u in wonNext) { const b = cond[u][wonNext[u] ? "w" : "l"]; b.n++; if (k < P) b.po++; if (k === N - 1) b.last++; } });
    }
    odds = {}; uids.forEach(u => { const c = cnt[u]; odds[u] = { po: c.po / sims, bye: c.bye / sims, top: c.top / sims, last: c.last / sims, projW: c.wins / sims }; });
    // Exact status wins over simulation noise
    uids.forEach(u => { if (status[u] === "clinched") odds[u].po = 1; if (status[u] === "eliminated") odds[u].po = 0; });
    stakes = { week: nextW, games: nextGames.map(g => ({ a: g.a, b: g.b })), cond: {} };
    uids.forEach(u => { const c = cond[u]; if (!c.w.n && !c.l.n) return; const fx = (b, key) => (b.n ? b[key] / b.n : null);
      let wPo = fx(c.w, "po"), lPo = fx(c.l, "po");
      if (status[u] === "clinched") { wPo = 1; lPo = 1; } if (status[u] === "eliminated") { wPo = 0; lPo = 0; }
      stakes.cond[u] = { winPo: wPo, lossPo: lPo, winLast: fx(c.w, "last"), lossLast: fx(c.l, "last"), winShare: c.w.n / (c.w.n + c.l.n) }; });
  }
  return { regLeft, status, odds, stakes, sos, sosRank, haveSchedule, byes: season.byes != null ? season.byes : (P === 6 ? 2 : 0), model };
}


// Trade values: name matching, consensus, tiers, trade math, suggestions. Pure functions.
const TV_NORM = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();

// Same person, different name on a source than on Sleeper
const TV_ALIAS = { "bam knight": "zonovan knight", "hollywood brown": "marquise brown" };

function tvMatch(players, name, pos, team) {
  if (!tvMatch.idx || tvMatch.src !== players) {
    const full = {}, byLast = {};
    Object.entries(players).forEach(([pid, p]) => {
      if (/^[A-Z]{2,3}$/.test(pid)) return;
      const n = TV_NORM(p[0]); (full[n] = full[n] || []).push(pid);
      const parts = n.split(" "); const last = parts.slice(1).join(" ");
      (byLast[last] = byLast[last] || []).push(pid);
    });
    tvMatch.idx = { full, byLast }; tvMatch.src = players;
  }
  const { full, byLast } = tvMatch.idx;
  if (pos === "DEF" && team && players[team] && players[team][1] === "DEF") return team;
  let n = TV_NORM(name); n = TV_ALIAS[n] || n;
  const pick = ids => { if (!ids || !ids.length) return null; const pp = ids.filter(id => !pos || (players[id][1] || "") === pos); const pt = pp.filter(id => !team || players[id][2] === team); return (pt[0] || (pp.length === 1 ? pp[0] : null) || (ids.length === 1 ? ids[0] : null)); };
  let id = pick(full[n]);
  if (id) return id;
  const parts = n.split(" "); const first = parts[0], last = parts.slice(1).join(" ");
  if (first.length === 1 && byLast[last]) return pick(byLast[last].filter(pid => TV_NORM(players[pid][0]).startsWith(first)));
  if (byLast[last]) { const c = byLast[last].filter(pid => TV_NORM(players[pid][0]).split(" ")[0].startsWith(first.slice(0, 3))); return pick(c); }
  return null;
}

// Consensus: rank inside each source (ties share the average rank), impute missing as source length + 1, weighted average of ranks.
function tvConsensus(week, players) {
  const keys = Object.keys(week.sources);
  const byKey = {};
  keys.forEach(k => {
    const rowsS = week.sources[k].rows.slice().sort((a, b) => b.v - a.v);
    let i = 0;
    while (i < rowsS.length) { let j = i; while (j + 1 < rowsS.length && rowsS[j + 1].v === rowsS[i].v) j++; const avg = (i + j) / 2 + 1; for (let x = i; x <= j; x++) rowsS[x].rank = avg; i = j + 1; }
    rowsS.forEach(r => {
      const id = tvMatch(players, r.name, r.pos, r.team);
      const key = id || ("x:" + TV_NORM(r.name));
      const e = byKey[key] || (byKey[key] = { key, pid: id, name: id ? players[id][0] : r.name.replace(/\s+(Jr\.|Sr\.|II|III)$/, ""), pos: r.pos, team: r.team || (id ? players[id][2] : ""), src: {}, inj: false, ppg: [] });
      e.src[k] = { v: r.v, rank: r.rank, raw: r.name, rk: r.rk };
      if (r.sosPO != null) e.sosPO = r.sosPO;
      if (r.inj) e.inj = true;
      if (r.ppg != null) e.ppg.push(r.ppg);
      if (!e.team && r.team) e.team = r.team;
    });
  });
  const len = {}; keys.forEach(k => { len[k] = week.sources[k].rows.length; });
  const list = Object.values(byKey);
  list.forEach(e => {
    const ranks = keys.map(k => e.src[k] ? e.src[k].rank : len[k] + 1);
    e.nSrc = keys.filter(k => e.src[k]).length;
    // Weighted average of ranks. A source without a weight counts as 1. Only this week's sources are in the week, so a missing source takes no weight.
    const wts = keys.map(k => week.sources[k].w != null ? week.sources[k].w : 1);
    e.crank = ranks.reduce((a, r, i) => a + r * wts[i], 0) / wts.reduce((a, b) => a + b, 0);
    e.spread = Math.max(...keys.filter(k => e.src[k]).map(k => e.src[k].rank)) - Math.min(...keys.filter(k => e.src[k]).map(k => e.src[k].rank));
    e.ppgAvg = e.ppg.length ? e.ppg.reduce((a, b) => a + b, 0) / e.ppg.length : null;
  });
  // Value curve: one smooth drop-off for everyone. #1 = 100, #12 = 75, #50 = 35, #150 about 6.
  const curveAt = rank => 100 * Math.exp(-0.03605 * Math.pow(Math.max(0, rank - 1), 0.8665));
  const avgCurve = Array.from({ length: 220 }, (_, i) => curveAt(i + 1));
  list.sort((a, b) => a.crank - b.crank);
  // The consensus ranks are averages, so re-rank them 1..N before reading the curve
  list.forEach((e, i) => { e.order = i + 1; e.value = Math.round(curveAt(e.order) * 10) / 10; });
  return { list, byPid: Object.fromEntries(list.filter(e => e.pid).map(e => [e.pid, e])), curve: avgCurve };
}

const TV_TIERS = [
  { n: 1, name: "The Pulpit", min: 85 }, { n: 2, name: "Deacon Board", min: 70 }, { n: 3, name: "Choir Loft", min: 58 },
  { n: 4, name: "Front Pews", min: 42 }, { n: 5, name: "Revival Tent", min: 28 }, { n: 6, name: "Back Pews", min: 20 },
  { n: 7, name: "Mustard Seeds", min: 13 }, { n: 8, name: "The Nursery", min: 8 }, { n: 9, name: "Fellowship Hall Leftovers", min: 0 },
];
const tvTier = v => TV_TIERS.find(t => v >= t.min);

/* ---------- Trade math ---------- */
const TV_POW = 1.5, TV_REPL = 10;
const tvAdj = v => 100 * Math.pow(Math.max(0, v) / 100, TV_POW);
const tvUnadj = a => 100 * Math.pow(Math.max(0, a) / 100, 1 / TV_POW);
const tvVal = (cons, pid) => (cons.byPid[pid] ? cons.byPid[pid].value : 0);

// aGets / bGets are lists of player ids
function tvEvaluate(cons, aGets, bGets) {
  const raw = l => l.reduce((s, p) => s + tvVal(cons, p), 0);
  const adjSum = l => l.reduce((s, p) => s + tvAdj(tvVal(cons, p)), 0);
  const credit = tvAdj(TV_REPL);
  const spotsA = Math.max(0, bGets.length - aGets.length), spotsB = Math.max(0, aGets.length - bGets.length);
  const A = adjSum(aGets) + spotsA * credit, B = adjSum(bGets) + spotsB * credit;
  const top = Math.max(A, B, 0.0001), diff = (A - B) / top;
  const level = Math.abs(diff) <= 0.10 ? "fair" : Math.abs(diff) <= 0.30 ? "leans" : "robbery";
  const gapRaw = tvUnadj(Math.abs(A - B));
  return { rawA: raw(aGets), rawB: raw(bGets), A, B, diff, level, favors: diff > 0 ? "a" : diff < 0 ? "b" : null, spotsA, spotsB, credit, gapRaw };
}

// Best weekly lineup for a roster, using the league's lineup slots
function tvLineup(season, roster, ppgOf) {
  const avail = roster.map(pid => ({ pid, pos: season.posOf(pid), p: ppgOf(pid) })).sort((x, y) => y.p - x.p);
  const used = new Set(); let total = 0; const slots = [];
  season.slotOrder.forEach(i => { const el = season.slotElig[i]; if (el.has("K") || el.has("DEF")) return; const pk = avail.find(x => !used.has(x.pid) && el.has(x.pos)); if (pk) { used.add(pk.pid); total += pk.p; slots.push({ i, pid: pk.pid, p: pk.p }); } });
  return { total, starters: used, slots };
}

function tvPpgFn(cons, season) {
  return pid => { const e = cons.byPid[pid]; if (e && e.ppgAvg != null) return e.ppgAvg; return season.ppgLeague[pid] || 0; };
}

function tvImpact(cons, season, ua, ub, aGets, bGets) {
  const ppg = tvPpgFn(cons, season);
  const ra = season.currentRosters[ua] || [], rb = season.currentRosters[ub] || [];
  const na = ra.filter(p => !bGets.includes(p)).concat(aGets), nb = rb.filter(p => !aGets.includes(p)).concat(bGets);
  const a0 = tvLineup(season, ra, ppg).total, a1 = tvLineup(season, na, ppg).total;
  const b0 = tvLineup(season, rb, ppg).total, b1 = tvLineup(season, nb, ppg).total;
  return { a: a1 - a0, b: b1 - b0, a0, a1, b0, b1 };
}

// Up to 3 fair, win-win trades for one member, each with a different partner and no repeated players
function tvSuggest(cons, season, uid, opts) {
  opts = opts || {}; const maxN = opts.n || 3, fairCut = opts.fair || 0.10, minGain = opts.minGain || 0.5;
  const ppg = tvPpgFn(cons, season);
  const inj = pid => !!(cons.byPid[pid] && cons.byPid[pid].inj);
  // Pool: healthy players worth 8+, no kickers or defenses (this week's pickups count too)
  const pool = u => (season.currentRosters[u] || []).filter(p => cons.byPid[p] && cons.byPid[p].value >= 8 && !inj(p) && !["K", "DEF"].includes(season.posOf(p))).sort((x, y) => tvVal(cons, y) - tvVal(cons, x)).slice(0, 8);
  const combos = l => { const out = l.map(p => [p]); for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) out.push([l[i], l[j]]); return out; };
  const mine = combos(pool(uid));
  const myRoster = season.currentRosters[uid] || [];
  const my0 = tvLineup(season, myRoster, ppg).total;
  const best = [];
  Object.keys(season.currentRosters).filter(u => u !== uid).forEach(u => {
    const theirs = combos(pool(u));
    const their0 = tvLineup(season, season.currentRosters[u], ppg).total;
    let top = null;
    mine.forEach(send => theirs.forEach(get => {
      if (send.length + get.length > 4) return;
      const ev = tvEvaluate(cons, get, send);          // "a" = this member, who gets `get`
      if (Math.abs(ev.diff) > fairCut) return;
      const na = myRoster.filter(p => !send.includes(p)).concat(get);
      const nb = season.currentRosters[u].filter(p => !get.includes(p)).concat(send);
      const ga = tvLineup(season, na, ppg).total - my0, gb = tvLineup(season, nb, ppg).total - their0;
      if (ga < minGain || gb < minGain) return;
      const score = Math.min(ga, gb) - Math.abs(ev.diff) * 2 - (send.length + get.length - 2) * 0.3;
      if (!top || score > top.score) top = { partner: u, send, get, ev, gainMe: ga, gainThem: gb, score };
    }));
    if (top) best.push(top);
  });
  best.sort((x, y) => y.score - x.score);
  const used = new Set(), out = [];
  for (const t of best) { if (out.length >= maxN) break; if ([...t.send, ...t.get].some(p => used.has(p))) continue; [...t.send, ...t.get].forEach(p => used.add(p)); out.push(t); }
  return out;
}

// The Offering: one player is locked into this member's side; every other team is searched for the best return.
// Levels: 1 fair and both lineups gain, 2 fair but a lineup does not gain, 3 closest on value (with a fix).
function tvShop(cons, season, uid, pid, opts) {
  opts = opts || {}; const fairCut = opts.fair || 0.10, minGain = opts.minGain || 0.5, want = opts.want || "any", maxN = opts.n || 5;
  const ppg = tvPpgFn(cons, season);
  const inj = p => !!(cons.byPid[p] && cons.byPid[p].inj);
  const kd = p => ["K", "DEF"].includes(season.posOf(p));
  const pool = u => (season.currentRosters[u] || []).filter(p => cons.byPid[p] && cons.byPid[p].value >= 8 && !inj(p) && !kd(p)).sort((x, y) => tvVal(cons, y) - tvVal(cons, x)).slice(0, 8);
  const combos = l => { const out = l.map(p => [p]); for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) out.push([l[i], l[j]]); return out; };
  const myRoster = season.currentRosters[uid] || [];
  if (!myRoster.includes(pid)) return { rows: [], diag: { teams: 0, startsFor: 0 } };
  const my0 = tvLineup(season, myRoster, ppg).total;
  const sends = [[pid]].concat(pool(uid).filter(p => p !== pid).slice(0, 7).map(x => [pid, x]));
  const rows = [], diag = { teams: 0, startsFor: 0, value: tvVal(cons, pid), topSingle: 0 };
  const better = (x, y) => !y || x.level < y.level || (x.level === y.level && x.score > y.score);
  Object.keys(season.currentRosters).filter(u => u !== uid).forEach(u => {
    const R = season.currentRosters[u] || [], their0 = tvLineup(season, R, ppg).total;
    diag.teams++;
    if (tvLineup(season, R.concat([pid]), ppg).total - their0 >= minGain) diag.startsFor++;
    const theirs = combos(pool(u));
    theirs.forEach(g => { if (g.length === 1) diag.topSingle = Math.max(diag.topSingle, tvVal(cons, g[0])); });
    let best = null;
    sends.forEach(send => theirs.forEach(get => {
      if (send.length + get.length > 4) return;
      const ev = tvEvaluate(cons, get, send); // "a" = this member, who gets `get`
      const na = myRoster.filter(p => !send.includes(p)).concat(get), nb = R.filter(p => !get.includes(p)).concat(send);
      const ga = tvLineup(season, na, ppg).total - my0, gb = tvLineup(season, nb, ppg).total - their0;
      const fair = Math.abs(ev.diff) <= fairCut, wins = ga >= minGain && gb >= minGain;
      const level = fair && wins ? 1 : fair ? 2 : 3;
      const wantHit = want !== "any" && get.some(p => season.posOf(p) === want);
      const extra = (send.length + get.length - 2) * 0.3, wb = wantHit ? 1 : 0;
      const score = level === 1 ? Math.min(ga, gb) - Math.abs(ev.diff) * 2 - extra + wb
        : level === 2 ? Math.min(ga, gb) - Math.abs(ev.diff) * 2 - extra + wb
        : -Math.abs(ev.diff) * 10 + Math.min(ga, gb) * 0.1 - extra + wb;
      const c = { partner: u, send, get, ev, gainMe: ga, gainThem: gb, level, score, wantHit };
      if (better(c, best)) best = c;
    }));
    if (!best) return;
    // Closest on value only: the one added player that brings it nearest to even
    if (best.level === 3) {
      let fix = null;
      if (best.ev.favors === "a") myRoster.filter(p => !best.send.includes(p) && !kd(p)).forEach(p => { const e = tvEvaluate(cons, best.get, best.send.concat([p])); if (!fix || Math.abs(e.diff) < Math.abs(fix.diff)) fix = { side: "send", pid: p, diff: e.diff }; });
      else R.filter(p => !best.get.includes(p) && !kd(p)).forEach(p => { const e = tvEvaluate(cons, best.get.concat([p]), best.send); if (!fix || Math.abs(e.diff) < Math.abs(fix.diff)) fix = { side: "get", pid: p, diff: e.diff }; });
      if (fix && Math.abs(fix.diff) < Math.abs(best.ev.diff)) best.fix = fix;
    }
    rows.push(best);
  });
  rows.sort((x, y) => x.level - y.level || y.score - x.score);
  diag.best = rows.length ? rows[0].level : null;
  diag.wantMiss = want !== "any" && !rows.slice(0, maxN).some(r => r.wantHit);
  return { rows: rows.slice(0, maxN), diag };
}

// Roster strength: best legal starting lineup by adjusted trade value, plus a little bench depth. K and DEF left out.
const TV_BENCH_W = [0.5, 0.35, 0.25, 0.15];
function tvRoster(cons, season) {
  const adj = pid => tvAdj(tvVal(cons, pid)), out = {};
  Object.entries(season.currentRosters || {}).forEach(([uid, r]) => {
    const lu = tvLineup(season, r, adj);
    const bench = r.filter(p => !lu.starters.has(p) && !["K", "DEF"].includes(season.posOf(p))).map(adj).sort((a, b) => b - a);
    const benchV = bench.slice(0, TV_BENCH_W.length).reduce((a, x, i) => a + x * TV_BENCH_W[i], 0);
    out[uid] = { start: lu.total, bench: benchV, total: lu.total + benchV };
  });
  const max = Math.max(...Object.values(out).map(x => x.total), 0.0001);
  Object.values(out).forEach(x => { x.idx = 100 * x.total / max; });
  return out;
}

// Revelation (future-focused power): 60% roster strength, 25% season points per game, 15% last three weeks.
// Each measure is scaled so the league's best team is 1 and the worst is 0.
const TV_FUTURE_W = { roster: 0.6, ppg: 0.25, recent: 0.15 };
function tvFuture(cons, season, prRows) {
  const ros = tvRoster(cons, season);
  const rows = prRows.filter(r => ros[r.uid]).map(r => Object.assign({}, r, { roster: ros[r.uid].idx, rosterRaw: ros[r.uid] }));
  const mm = f => { const v = rows.map(f), lo = Math.min(...v), hi = Math.max(...v); return x => hi > lo ? (x - lo) / (hi - lo) : 1; };
  const nR = mm(r => r.roster), nP = mm(r => r.ppg), nL = mm(r => r.recent);
  rows.forEach(r => { r.fscore = 100 * (TV_FUTURE_W.roster * nR(r.roster) + TV_FUTURE_W.ppg * nP(r.ppg) + TV_FUTURE_W.recent * nL(r.recent)); });
  return rows.sort((a, b) => b.fscore - a.fscore);
}


// Spiritual Gifts: position-group power rankings. Pure functions.
// Past weeks use the lineup each team actually started. The current week uses trade values,
// the best legal lineup from the current roster, with players on bye left out.

// 2026 NFL bye weeks (commissioner's chart, checked against weeks 5-7 scoring: no bye-team player scored)
const NFL_BYES = {
  "2026": { 5: ["KC", "CAR"], 6: ["CIN", "DET", "MIA", "MIN"], 7: ["BUF", "JAX", "LAC", "WAS"], 8: ["NYG", "HOU", "NO", "SF"], 9: ["PIT", "TEN"], 10: ["CHI", "DEN", "PHI", "TB"], 11: ["SEA", "LAR", "ATL", "NE", "CLE", "GB"], 13: ["BAL", "NYJ", "IND", "LV"], 14: ["DAL", "ARI"] },
};
const G_KEYS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];
const G_CORE = ["QB", "RB", "WR", "TE"];

const gByes = (year, week) => new Set(((NFL_BYES[String(year)] || {})[week]) || []);
const gTeamOf = (players, pid) => { const p = players[pid]; if (!p) return null; return p[1] === "DEF" ? pid : p[2]; };
const gSlotKey = (season, i) => { const el = [...season.slotElig[i]]; return el.length > 1 ? "FLEX" : el[0]; };

function gEmpty() { const g = {}; G_KEYS.forEach(k => { g[k] = 0; }); return g; }

// Label starters inside each group by score: RB1, RB2, WR1, WR2. Single-slot groups keep their own name.
function gLabel(season, starters) {
  const cnt = {}; season.slotOrder.forEach(i => { const k = gSlotKey(season, i); cnt[k] = (cnt[k] || 0) + 1; });
  const byKey = {};
  starters.forEach(s => { (byKey[s.key] = byKey[s.key] || []).push(s); });
  Object.entries(byKey).forEach(([k, list]) => { list.sort((a, b) => b.score - a.score); list.forEach((s, n) => { s.label = cnt[k] > 1 ? k + (n + 1) : k; }); });
  const order = [];
  G_KEYS.forEach(k => { const n = cnt[k] || 0; if (n > 1) for (let x = 1; x <= n; x++) order.push(k + x); else if (n === 1) order.push(k); });
  starters.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return order;
}

// One played week: the lineup each team started
function giftsActual(season, week) {
  const teams = {};
  season.teamWeeks.filter(t => t.week === week && !t.playoff).forEach(t => {
    const groups = gEmpty(), starters = [];
    (t.starters || []).forEach((s, i) => {
      if (!s || !s.pid || s.pid === "0" || !season.slotElig[i]) return;
      const key = gSlotKey(season, i);
      groups[key] += s.pts || 0;
      starters.push({ i, key, pid: s.pid, score: s.pts || 0 });
    });
    teams[t.uid] = { groups, starters, total: G_KEYS.reduce((a, k) => a + groups[k], 0) };
  });
  return gFinish(season, { mode: "actual", week, teams });
}

// Season so far: average starter points per week, by group
function giftsSeason(season) {
  const weeks = season.regWeeks.filter(w => season.teamWeeks.some(t => t.week === w && !t.playoff && t.result));
  const teams = {};
  weeks.forEach(w => {
    const one = giftsActual(season, w);
    Object.entries(one.teams).forEach(([uid, t]) => {
      const e = teams[uid] || (teams[uid] = { groups: gEmpty(), starters: [], total: 0, n: 0 });
      G_KEYS.forEach(k => { e.groups[k] += t.groups[k]; }); e.n++;
    });
  });
  Object.values(teams).forEach(e => { G_KEYS.forEach(k => { e.groups[k] /= e.n || 1; }); e.total = G_KEYS.reduce((a, k) => a + e.groups[k], 0); });
  return gFinish(season, { mode: "season", weeks, teams });
}

// Sleeper injury statuses that keep a player out of this week's lineup. Questionable players stay in.
const G_OUT = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "NA", "DNR", "COV"]);

// The current week or rest of season, from the current roster.
// opts.mode "week": players on bye or ruled out sit; scored by Sleeper projections when given, else trade value.
// opts.mode "ros": full-strength lineup by trade value, no byes or injuries removed.
function giftsCurrent(cons, season, players, week, opts) {
  opts = opts || {};
  const ros = opts.mode === "ros";
  const proj = !ros && opts.proj ? opts.proj : null;
  const inj = opts.injuries || {};
  const bye = ros ? new Set() : gByes(season.year, week);
  const val = pid => (cons.byPid[pid] ? cons.byPid[pid].value : 0);
  // Positions the projections do not cover fall back to trade value and stay out of the total
  const missing = proj ? ["QB", "RB", "WR", "TE", "K", "DEF"].filter(P => !Object.keys(proj).some(pid => (players[pid] || [])[1] === P)) : [];
  const score = pid => { if (!proj) return val(pid); const P = season.posOf(pid); return missing.includes(P) ? val(pid) : (proj[pid] || 0); };
  const sits = pid => !ros && (bye.has(gTeamOf(players, pid)) || (inj[pid] && G_OUT.has(inj[pid].s)));
  const teams = {};
  Object.entries(season.currentRosters || {}).forEach(([uid, roster]) => {
    const avail = roster.filter(p => !sits(p)).map(pid => ({ pid, pos: season.posOf(pid), v: score(pid) })).sort((a, b) => b.v - a.v);
    const used = new Set(), groups = gEmpty(), starters = [];
    season.slotOrder.forEach(i => {
      const el = season.slotElig[i], key = gSlotKey(season, i);
      const pk = avail.find(x => !used.has(x.pid) && el.has(x.pos));
      if (!pk) { starters.push({ i, key, pid: null, score: 0 }); return; }
      used.add(pk.pid); groups[key] += pk.v; starters.push({ i, key, pid: pk.pid, score: pk.v });
    });
    const out = ros ? [] : roster.filter(p => sits(p) && val(p) >= 20).sort((a, b) => val(b) - val(a)).map(p => ({ pid: p, why: bye.has(gTeamOf(players, p)) ? "bye" : inj[p].s }));
    const total = G_KEYS.filter(k => !missing.includes(k)).reduce((a, k) => a + groups[k], 0);
    teams[uid] = { groups, starters, total, out };
  });
  return gFinish(season, { mode: ros ? "ros" : "current", scoring: ros || !proj ? "value" : "proj", missing, week, teams });
}

// Ranks for every group, the total, and each labeled starter slot
function gFinish(season, data) {
  const uids = Object.keys(data.teams);
  data.n = uids.length;
  data.max = {}; data.rank = {};
  G_KEYS.concat(["total"]).forEach(k => {
    const get = u => (k === "total" ? data.teams[u].total : data.teams[u].groups[k]);
    const order = uids.slice().sort((a, b) => get(b) - get(a));
    data.max[k] = Math.max(0.0001, ...uids.map(get));
    order.forEach((u, i) => { (data.rank[u] = data.rank[u] || {})[k] = i + 1; });
  });
  data.slotOrder = [];
  if (data.mode !== "season") {
    uids.forEach(u => { data.slotOrder = gLabel(season, data.teams[u].starters); });
    data.slotRank = {}; data.slotMax = {};
    data.slotOrder.forEach(lab => {
      const rows = uids.map(u => ({ u, s: data.teams[u].starters.find(x => x.label === lab) })).filter(r => r.s);
      rows.sort((a, b) => b.s.score - a.s.score);
      data.slotMax[lab] = Math.max(0.0001, ...rows.map(r => r.s.score));
      rows.forEach((r, i) => { r.s.rank = i + 1; });
    });
  }
  return data;
}

// Teams strong where you are thin and thin where you are strong, on QB, RB, WR, TE
function gPartners(data, uid) {
  const n = data.n, strong = r => r <= Math.ceil(n / 3), thin = r => r > n - Math.ceil(n / 3);
  const me = data.rank[uid]; if (!me) return [];
  const out = [];
  Object.keys(data.teams).forEach(u => {
    if (u === uid) return;
    const r = data.rank[u];
    const gets = G_CORE.filter(k => thin(me[k]) && strong(r[k]));
    const gives = G_CORE.filter(k => strong(me[k]) && thin(r[k]));
    if (gets.length && gives.length) out.push({ uid: u, gets, gives, score: gets.reduce((a, k) => a + (me[k] - r[k]), 0) + gives.reduce((a, k) => a + (r[k] - me[k]), 0) });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

// Rank color band: top quarter green, bottom quarter red, the rest gray (12 teams: 1-3, 4-9, 10-12)
const gBand = (rank, n) => (rank <= Math.round(n / 4) ? "top" : rank > n - Math.round(n / 4) ? "low" : "mid");


// Draft Day and trade hindsight: value gaps, fates, grades, and trade scores. Pure functions.
// Current season (trade values loaded): a pick is judged by its current trade value against the value expected at that pick.
// Past seasons (no trade values): a pick is judged by where he finished at his position against where he was drafted at it.

// Expected value at a draft pick: the Trade Chart curve, pick 1 = 100
const dCurve = pick => 100 * Math.exp(-0.03605 * Math.pow(Math.max(0, pick - 1), 0.8665));
const D_HURT = new Set(["IR", "Out", "PUP", "Doubtful"]);

// Weeks with zero points while on a league roster, regular season. Byes come out using the bye table when we have one,
// or one assumed bye otherwise.
function dZeroWeeks(season, players) {
  const zero = {}, seen = {};
  const byeFor = w => gByes(season.year, w);
  const haveByes = !!NFL_BYES[String(season.year)];
  season.teamWeeks.filter(t => !t.playoff && t.result).forEach(t => {
    Object.entries(t.pp || {}).forEach(([pid, pts]) => {
      if (haveByes && byeFor(t.week).has(gTeamOf(players, pid))) return;
      seen[pid] = (seen[pid] || 0) + 1;
      if (!pts) zero[pid] = (zero[pid] || 0) + 1;
    });
  });
  if (!haveByes) Object.keys(zero).forEach(pid => { zero[pid] = Math.max(0, zero[pid] - 1); });
  return zero;
}

// Where each pick is now: still on the drafting team, traded away, or dropped (the last move that took him off that team)
function dFate(season, pick) {
  const pid = pick.player_id, uid = pick.uid;
  if ((season.currentRosters[uid] || []).includes(pid)) return { kind: "kept" };
  let last = null;
  (season.txs || []).forEach(tx => { const from = tx.drops && tx.drops[pid]; if (from != null && season.rosterOwner[from] === uid) last = tx; });
  if (last && last.type === "trade") { const toRid = last.adds && last.adds[pid]; return { kind: "traded", to: season.rosterOwner[toRid] || null, week: last.leg || null }; }
  return { kind: "dropped", week: last ? last.leg || null : null };
}

// Every non-K/DEF pick with its gap, fate, and health. cons = this week's consensus, or null for a past season.
function draftPicks(season, cons, players, injuries) {
  const zw = dZeroWeeks(season, players);
  const list = season.drafted.filter(p => p.player_id && !["K", "DEF"].includes(p.position));
  let out;
  if (cons) {
    out = list.map(p => { const e = cons.byPid[p.player_id]; const val = e ? e.value : 0; const exp = dCurve(p.pick_no); return { ...p, val, exp, gap: val - exp }; });
  } else {
    // Points per game played, at least 4 games, so a short season does not look like a great one
    const tot = {}, gp = {};
    season.teamWeeks.filter(t => !t.playoff && t.result).forEach(t => Object.entries(t.pp || {}).forEach(([pid, pts]) => { if (pts) { tot[pid] = (tot[pid] || 0) + pts; gp[pid] = (gp[pid] || 0) + 1; } }));
    const ppg = pid => (tot[pid] || 0) / Math.max(gp[pid] || 0, 4);
    const byPos = {};
    list.forEach(p => { (byPos[p.position] = byPos[p.position] || []).push(p); });
    out = [];
    Object.values(byPos).forEach(arr => {
      const drafted = arr.slice().sort((a, b) => a.pick_no - b.pick_no), fin = arr.slice().sort((a, b) => ppg(b.player_id) - ppg(a.player_id));
      arr.forEach(p => { const dr = drafted.indexOf(p) + 1, fr = fin.indexOf(p) + 1; out.push({ ...p, ppg: ppg(p.player_id), draftPos: dr, finishPos: fr, gap: dr - fr }); });
    });
  }
  out.forEach(p => {
    p.zero = zw[p.player_id] || 0;
    p.status = cons && injuries && injuries[p.player_id] ? injuries[p.player_id].s : null;
    p.hurt = p.zero >= 2 || (p.status != null && D_HURT.has(p.status));
    p.fate = dFate(season, p);
  });
  return out;
}

// Grades on a curve: distance from the league average in standard deviations
const D_GRADES = [[1.5, "A+"], [1.0, "A"], [0.6, "A-"], [0.3, "B+"], [0, "B"], [-0.3, "B-"], [-0.6, "C+"], [-1.0, "C"], [-1.5, "D"], [-Infinity, "F"]];
function dCurveGrades(scores) {
  const v = Object.values(scores), n = v.length; if (!n) return {};
  const m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1)) || 1;
  const out = {}; Object.entries(scores).forEach(([u, x]) => { const z = (x - m) / sd; out[u] = { z, grade: D_GRADES.find(g => z >= g[0])[1] }; });
  return out;
}

// One card per drafting team
function draftCards(season, picks) {
  const cards = {};
  picks.forEach(p => {
    const c = cards[p.uid] || (cards[p.uid] = { uid: p.uid, n: 0, gap: 0, kept: [], traded: [], dropped: [], thorns: [], thornCost: 0, picks: [] });
    c.n++; c.gap += p.gap; c.picks.push(p); c[p.fate.kind].push(p);
    if (p.hurt) { c.thorns.push(p); if (p.gap < 0) c.thornCost += -p.gap; }
  });
  const g = dCurveGrades(Object.fromEntries(Object.values(cards).map(c => [c.uid, c.gap])));
  Object.values(cards).forEach(c => { c.grade = g[c.uid].grade; c.z = g[c.uid].z; c.picks.sort((a, b) => a.pick_no - b.pick_no); });
  return Object.values(cards).sort((a, b) => b.gap - a.gap);
}

// Draft grade history: the same cards computed with each stored week of values
function draftTrend(season, hist, players) {
  return hist.map(h => { const cards = draftCards(season, draftPicks(season, h.cons, players, null)); return { week: h.week, grades: Object.fromEntries(cards.map(c => [c.uid, c.grade])), gap: Object.fromEntries(cards.map(c => [c.uid, c.gap])) }; });
}

// Trade hindsight: each trade weighed with current values, wherever the players are now
const D_HIND = v => (Math.abs(v) <= 0.10 ? "Still even" : Math.abs(v) <= 0.30 ? "Leaning" : "Spoiled like manna");
function tradeScales(season, hist) {
  const trades = season.moves.filter(m => m.type === "trade" && m.sides.length >= 2 && !m.sides.some(sd => sd.picks.length));
  const cur = hist[hist.length - 1], firstWeek = hist[0].week;
  // Three or more teams: each team's value in against value out, with roster-spot credit
  const multi = (t, cons) => {
    const credit = tvAdj(TV_REPL), adj = pid => tvAdj(tvVal(cons, pid));
    return t.sides.map(sd => { const gets = sd.got.map(x => x.pid), sends = sd.gave.map(x => x.pid);
      const inV = gets.reduce((a, q) => a + adj(q), 0) + Math.max(0, sends.length - gets.length) * credit, outV = sends.reduce((a, q) => a + adj(q), 0) + Math.max(0, gets.length - sends.length) * credit;
      return { uid: sd.uid, inV, outV, diff: (inV - outV) / Math.max(inV, outV, 0.0001) }; });
  };
  const rows = trades.map(t => {
    if (t.sides.length > 2) {
      const per = multi(t, cur.cons), worst = per.reduce((a, r) => (Math.abs(r.diff) > Math.abs(a.diff) ? r : a), per[0]);
      const trend = hist.map(h => { const pp = multi(t, h.cons), w = pp.reduce((a, r) => (Math.abs(r.diff) > Math.abs(a.diff) ? r : a), pp[0]); return { week: h.week, diff: w.diff, label: D_HIND(w.diff) }; });
      const top = per.reduce((a, r) => (r.diff > a.diff ? r : a), per[0]);
      return { t, multi: per, ev: { diff: worst.diff }, label: D_HIND(worst.diff), favors: Math.abs(worst.diff) <= 0.10 ? null : top.uid, trend, then: t.week >= firstWeek ? trend.filter(x => x.week <= t.week).pop() || null : null, pts: Object.fromEntries(t.sides.map(sd => [sd.uid, sd.net])) };
    }
    const [A, B] = t.sides, aGets = A.got.map(x => x.pid), bGets = B.got.map(x => x.pid);
    const ev = tvEvaluate(cur.cons, aGets, bGets);
    const trend = hist.map(h => { const e = tvEvaluate(h.cons, aGets, bGets); return { week: h.week, diff: e.diff, label: D_HIND(e.diff) }; });
    // Values at the time of the trade: the stored week at or just before it, only when the trade came after values began
    const then = t.week >= firstWeek ? trend.filter(x => x.week <= t.week).pop() || null : null;
    return { t, a: A.uid, b: B.uid, aGets, bGets, ev, label: D_HIND(ev.diff), favors: Math.abs(ev.diff) <= 0.10 ? null : ev.favors === "a" ? A.uid : B.uid, trend, then, pts: { [A.uid]: A.net, [B.uid]: B.net } };
  });
  const bal = {};
  rows.forEach(r => {
    if (r.multi) { r.multi.forEach(x => { bal[x.uid] = (bal[x.uid] || 0) + (x.inV - x.outV); }); return; }
    bal[r.a] = (bal[r.a] || 0) + (r.ev.A - r.ev.B); bal[r.b] = (bal[r.b] || 0) + (r.ev.B - r.ev.A);
  });
  return { rows, bal, skipped: season.moves.filter(m => m.type === "trade").length - trades.length };
}


// Multi-team trades: evaluate any deal among 2 to 12 teams, and search loops among 3 to 6 chosen teams. Pure functions.
// A deal is a list of moves: { pid, from, to }.

// Per-team value in and out, with the same star premium and roster-spot credit as two-team trades.
// For two teams this matches tvEvaluate exactly.
function mtEvaluate(cons, season, moves, teams) {
  const ppg = tvPpgFn(cons, season), credit = tvAdj(TV_REPL);
  const adj = pid => tvAdj(tvVal(cons, pid));
  const rows = teams.map(u => {
    const gets = moves.filter(m => m.to === u).map(m => m.pid), sends = moves.filter(m => m.from === u).map(m => m.pid);
    const inV = gets.reduce((a, p) => a + adj(p), 0) + Math.max(0, sends.length - gets.length) * credit;
    const outV = sends.reduce((a, p) => a + adj(p), 0) + Math.max(0, gets.length - sends.length) * credit;
    const top = Math.max(inV, outV, 0.0001), diff = (inV - outV) / top;
    const level = Math.abs(diff) <= 0.10 ? "fair" : Math.abs(diff) <= 0.30 ? "leans" : "robbery";
    const roster = season.currentRosters[u] || [];
    const after = roster.filter(p => !sends.includes(p)).concat(gets);
    const l0 = tvLineup(season, roster, ppg).total, l1 = tvLineup(season, after, ppg).total;
    return { uid: u, gets, sends, inV, outV, diff, level, gain: l1 - l0, extra: gets.length - sends.length };
  });
  const worst = rows.reduce((a, r) => (Math.abs(r.diff) > Math.abs(a.diff) ? r : a), rows[0]);
  const level = rows.every(r => r.level === "fair") ? "fair" : rows.some(r => r.level === "robbery") ? "robbery" : "leans";
  return { rows, level, worst, winWin: rows.every(r => r.gain >= 0.5) };
}

// The player a team would cut to make room: lowest value on the roster outside the deal, no kicker or defense
function mtDropCandidate(cons, season, uid, exclude) {
  const r = (season.currentRosters[uid] || []).filter(p => !exclude.includes(p) && !["K", "DEF"].includes(season.posOf(p)));
  return r.sort((a, b) => tvVal(cons, a) - tvVal(cons, b))[0] || null;
}

// Every ordering of the teams after the first that forms one loop: team[i] sends to team[i+1], the last sends to the first.
// Using only single loops leaves out deals that are really two separate two-team trades.
function mtLoops(teams) {
  const [first, ...rest] = teams, out = [];
  const perm = (arr, pre) => { if (!arr.length) { out.push([first, ...pre]); return; } arr.forEach((x, i) => perm(arr.slice(0, i).concat(arr.slice(i + 1)), pre.concat([x]))); };
  perm(rest, []);
  return out;
}

// Search loops among the chosen teams. opts: { twoForOne, locked: Set of pids, max }
function mtSearch(cons, season, teams, opts) {
  opts = opts || {};
  const k = teams.length, pairs = !!opts.twoForOne && k <= 4, locked = opts.locked || new Set();
  const ppg = tvPpgFn(cons, season), credit = tvAdj(TV_REPL), adj = pid => tvAdj(tvVal(cons, pid));
  const inj = pid => !!(cons.byPid[pid] && cons.byPid[pid].inj);
  // How many players per team the search considers: deeper for small searches, shallower when the loops multiply
  const depth = opts.depth || (pairs ? (k <= 3 ? 10 : 5) : (k <= 3 ? 12 : k === 4 ? 8 : k === 5 ? 6 : 5));
  const pool = u => (season.currentRosters[u] || []).filter(p => cons.byPid[p] && cons.byPid[p].value >= 8 && !inj(p) && !locked.has(p) && !["K", "DEF"].includes(season.posOf(p))).sort((x, y) => tvVal(cons, y) - tvVal(cons, x)).slice(0, depth);
  const bundles = {};
  teams.forEach(u => { const l = pool(u), b = l.map(p => [p]); if (pairs) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) b.push([l[i], l[j]]); bundles[u] = b; });
  const base = {}; teams.forEach(u => { base[u] = tvLineup(season, season.currentRosters[u] || [], ppg).total; });
  const stats = { tried: 0, fair: 0, fairAndGain: 0 };
  const found = []; let nearest = null, closest = null;
  mtLoops(teams).forEach(loop => {
    const pick = new Array(k);
    const rec = i => {
      if (i === k) {
        stats.tried++;
        // loop[i] sends pick[i] to loop[i+1]; so loop[i] receives pick[i-1]
        const per = []; let worst = 0;
        for (let t = 0; t < k; t++) {
          const sends = pick[t], gets = pick[(t - 1 + k) % k];
          const inV = gets.reduce((a, p) => a + adj(p), 0) + Math.max(0, sends.length - gets.length) * credit;
          const outV = sends.reduce((a, p) => a + adj(p), 0) + Math.max(0, gets.length - sends.length) * credit;
          const diff = (inV - outV) / Math.max(inV, outV, 0.0001);
          worst = Math.max(worst, Math.abs(diff));
          per.push({ u: loop[t], sends, gets, diff });
        }
        // Not fair for every team: remember the deal closest to fair, in case nothing is fair at all
        if (worst > 0.10) { if (!closest || worst < closest.worst) closest = { loop: loop.slice(), per: per.map(r => ({ ...r })), worst }; return; }
        stats.fair++;
        let minG = Infinity, sumD = 0;
        for (const r of per) {
          const after = (season.currentRosters[r.u] || []).filter(p => !r.sends.includes(p)).concat(r.gets);
          r.gain = tvLineup(season, after, ppg).total - base[r.u];
          minG = Math.min(minG, r.gain); sumD += Math.abs(r.diff);
        }
        const n = per.reduce((a, r) => a + r.sends.length, 0);
        const deal = () => { const moves = []; per.forEach((r, t) => r.sends.forEach(pid => moves.push({ pid, from: r.u, to: loop[(t + 1) % k] }))); return { loop: loop.slice(), moves, per: per.map(r => ({ ...r })), minGain: minG, score: minG - sumD * 2 - (n - k) * 0.3 }; };
        if (minG < 0.5) { if (!nearest || minG > nearest.minGain) nearest = deal(); return; }
        stats.fairAndGain++;
        found.push(deal());
        return;
      }
      for (const b of bundles[loop[i]]) { pick[i] = b; rec(i + 1); }
    };
    rec(0);
  });
  found.sort((a, b) => b.score - a.score);
  // Keep up to max deals that share no player
  const used = new Set(), out = [];
  for (const d of found) { if (out.length >= (opts.max || 5)) break; const ids = d.moves.map(m => m.pid); if (ids.some(p => used.has(p))) continue; ids.forEach(p => used.add(p)); out.push(d); }
  // Closest on value: only when no combination was fair for every team. Fill in its lineup changes and moves.
  let close = null;
  if (!stats.fair && closest) {
    closest.per.forEach(r => { const after = (season.currentRosters[r.u] || []).filter(p => !r.sends.includes(p)).concat(r.gets); r.gain = tvLineup(season, after, ppg).total - base[r.u]; });
    const moves = []; closest.per.forEach((r, t) => r.sends.forEach(pid => moves.push({ pid, from: r.u, to: closest.loop[(t + 1) % k] })));
    close = { loop: closest.loop, moves, per: closest.per, worst: closest.worst, minGain: Math.min(...closest.per.map(r => r.gain)) };
  }
  return { deals: out, nearest: out.length ? null : nearest, closest: close, stats, depth, pairs };
}


// Prophecy Check: Sleeper projections (scored with league settings by the export) against what actually happened.
// Pure functions. Only seasons the export scored with league settings (projections.scoring === "league").

const P_GROUPS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const P_CALL_GAP = 1; // a lineup call counts when the bench player was projected at least this many points higher

// True when this season has league-scored weekly projections
function prophOk(season, proj) {
  return !!(proj && proj.scoring === "league" && proj.weeks && String(proj.season) === String(season.year));
}

function prophecy(season, proj) {
  if (!prophOk(season, proj)) return null;
  const r2 = x => Math.round(x * 100) / 100;
  const weeks = season.regWeeks.filter(w => proj.weeks[w] && Object.keys(proj.weeks[w]).length);
  const teams = {}, players = {};
  let starts = 0, missing = 0;
  const team = uid => teams[uid] || (teams[uid] = { uid, proj: 0, act: 0, n: 0, weeks: [], byPos: {}, calls: { n: 0, right: 0, net: 0, list: [] } });
  weeks.forEach(w => {
    const P = proj.weeks[w];
    season.teamWeeks.filter(t => t.week === w && !t.playoff).forEach(t => {
      const T = team(t.uid);
      let wp = 0, wa = 0;
      const startIds = new Set();
      (t.starters || []).forEach((s, i) => {
        if (!s || !s.pid || s.pid === "0") return;
        startIds.add(s.pid);
        const p = P[s.pid];
        if (p == null) { missing++; return; }
        starts++;
        const a = s.pts || 0, pos = season.posOf(s.pid);
        wp += p; wa += a;
        const g = P_GROUPS.includes(pos) ? pos : null;
        if (g) { const b = T.byPos[g] || (T.byPos[g] = { proj: 0, act: 0, n: 0 }); b.proj += p; b.act += a; b.n++; }
      });
      T.proj += wp; T.act += wa; T.n++;
      T.weeks.push({ week: w, proj: r2(wp), act: r2(wa) });
      // Every rostered player-week with a projection feeds the player table
      (t.roster || []).forEach(pid => {
        const p = P[pid]; if (p == null) return;
        const a = (t.pp && t.pp[pid]) || 0;
        const x = players[pid] || (players[pid] = { pid, proj: 0, act: 0, n: 0, beat: 0, owners: {} });
        x.proj += p; x.act += a; x.n++; if (a > p) x.beat++;
        x.owners[t.uid] = (x.owners[t.uid] || 0) + 1;
        const tp = T.players || (T.players = {}); const y = tp[pid] || (tp[pid] = { pid, proj: 0, act: 0, n: 0, beat: 0 });
        y.proj += p; y.act += a; y.n++; if (a > p) y.beat++;
      });
      // Lineup calls: a starter over an eligible bench player projected at least P_CALL_GAP higher.
      // Each slot and each bench player is used once, biggest projection gap first.
      const bench = (t.roster || []).filter(pid => !startIds.has(pid) && P[pid] != null).map(pid => ({ pid, pos: season.posOf(pid), p: P[pid], a: (t.pp && t.pp[pid]) || 0 }));
      const cand = [];
      (t.starters || []).forEach((s, i) => {
        if (!s || !s.pid || s.pid === "0" || !season.slotElig[i] || P[s.pid] == null) return;
        bench.forEach(b => { if (season.slotElig[i].has(b.pos) && b.p - P[s.pid] >= P_CALL_GAP) cand.push({ i, s, b, gap: b.p - P[s.pid] }); });
      });
      cand.sort((x, y) => y.gap - x.gap);
      const usedSlot = new Set(), usedBench = new Set();
      cand.forEach(c => {
        if (usedSlot.has(c.i) || usedBench.has(c.b.pid)) return;
        usedSlot.add(c.i); usedBench.add(c.b.pid);
        const diff = r2((c.s.pts || 0) - c.b.a);
        T.calls.n++; if (diff > 0) T.calls.right++; T.calls.net += diff;
        T.calls.list.push({ week: w, start: c.s.pid, sProj: P[c.s.pid], sAct: c.s.pts || 0, bench: c.b.pid, bProj: c.b.p, bAct: c.b.a, diff });
      });
    });
  });
  Object.values(teams).forEach(T => {
    T.proj = r2(T.proj); T.act = r2(T.act); T.gap = r2(T.act - T.proj); T.perWeek = T.n ? r2(T.gap / T.n) : 0;
    T.over = T.weeks.filter(x => x.act > x.proj).length;
    T.calls.net = r2(T.calls.net);
    Object.values(T.byPos).forEach(b => { b.proj = r2(b.proj); b.act = r2(b.act); b.gap = r2(b.act - b.proj); });
  });
  const plist = Object.values(players).map(x => {
    const owner = Object.entries(x.owners).sort((a, b) => b[1] - a[1])[0][0];
    return { pid: x.pid, proj: r2(x.proj), act: r2(x.act), gap: r2(x.act - x.proj), n: x.n, beat: x.beat, owner };
  });
  return { weeks, teams, players: plist, starts, missing, coverage: starts + missing ? starts / (starts + missing) : 0 };
}

// ---------- Player level ----------
// One index per model: completed regular weeks with projections, each player's actual points
// (league points when rostered, else the export's league-scored actuals), and who rostered or started him.
function prophIndex(model) {
  const s = model.latest, proj = model.projections;
  if (!s || !prophOk(s, proj)) return null;
  const weeks = s.regWeeks.filter(w => proj.weeks[w] && Object.keys(proj.weeks[w]).length);
  const rosterOf = {}, startOf = {}, pp = {};
  weeks.forEach(w => { rosterOf[w] = {}; startOf[w] = {}; pp[w] = {}; });
  s.teamWeeks.forEach(t => {
    if (!rosterOf[t.week] || t.playoff) return;
    (t.roster || []).forEach(pid => { rosterOf[t.week][pid] = t.uid; pp[t.week][pid] = (t.pp && t.pp[pid]) || 0; });
    (t.starters || []).forEach(x => { if (x && x.pid && x.pid !== "0") startOf[t.week][x.pid] = t.uid; });
  });
  const act = (w, pid) => {
    if (pp[w] && pid in pp[w]) return pp[w][pid];
    const A = proj.act && proj.act[w];
    if (A) return A[pid] != null ? A[pid] : 0; // no stat line: did not score
    return null; // older export: only rostered players have actuals
  };
  return { season: s, proj, weeks, rosterOf, startOf, act, hasAct: !!proj.act };
}

// A player's weeks against projection. opts: from (first week), uid (only weeks on this member's roster), started (only weeks he started)
function playerLine(idx, pid, opts) {
  if (!idx) return null;
  const o = opts || {}, r2 = x => Math.round(x * 100) / 100;
  const weeks = idx.weeks.filter(w => (!o.from || w >= o.from) && (!o.to || w <= o.to)).map(w => {
    const p = idx.proj.weeks[w][pid];
    const uid = idx.rosterOf[w][pid] || null, started = idx.startOf[w][pid] || null;
    if (o.uid && uid !== o.uid) return null;
    if (o.started && !started) return null;
    const a = p != null ? idx.act(w, pid) : null;
    return { week: w, proj: p != null ? p : null, act: a, uid, started };
  }).filter(Boolean);
  const S = { proj: 0, act: 0, n: 0, beat: 0, within5: 0, over10: 0, under10: 0 };
  weeks.forEach(x => {
    if (x.proj == null || x.act == null) return;
    const d = x.act - x.proj;
    S.proj += x.proj; S.act += x.act; S.n++;
    if (d > 0) S.beat++; if (Math.abs(d) <= 5) S.within5++; if (d >= 10) S.over10++; if (d <= -10) S.under10++;
  });
  S.proj = r2(S.proj); S.act = r2(S.act); S.gap = r2(S.act - S.proj);
  return { weeks, sum: S };
}

// The week's biggest beat and biggest miss among starters
function prophWeekStars(idx, week) {
  if (!idx || !idx.weeks.includes(week)) return null;
  const P = idx.proj.weeks[week], list = [];
  Object.entries(idx.startOf[week]).forEach(([pid, uid]) => { const p = P[pid]; if (p == null) return; const a = idx.act(week, pid); if (a == null) return; list.push({ pid, uid, proj: p, act: a, gap: Math.round((a - p) * 100) / 100 }); });
  if (!list.length) return null;
  list.sort((a, b) => b.gap - a.gap);
  return { best: list[0], worst: list[list.length - 1] };
}


// The Laborers: 2026 usage. Shares, roles, and Workload points (expected points from usage, fitted to league scoring).
// Pure functions. Needs projections.usage from the export (2026 weeks only).

// Red zone targets (rzt) arrive only when above zero, so a missing value counts as zero.
// Air yards are left out: Sleeper's rec_air_yd counts completed passes only (zero on every target-without-catch week),
// so it measures the result of a target, not the opportunity.
// Quarterbacks stay out: nearly every dropback is his, so there is no share to read, and his points come from efficiency.
const W_FEATS = { RB: ["att", "rz", "tgt", "rzt"], WR: ["tgt", "rzt", "att"], TE: ["tgt", "rzt"] };
const W_MIN_R2 = 0.35; // back-test bar: below this the Workload points are shown with a warning

// Least squares with an intercept and a light ridge, solved by Gaussian elimination
function wFit(rows, feats) {
  const k = feats.length + 1, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  rows.forEach(r => { const x = [1].concat(feats.map(f => r.x[f] || 0)); for (let i = 0; i < k; i++) { b[i] += x[i] * r.y; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; } });
  for (let i = 1; i < k; i++) A[i][i] += 1e-6 * rows.length;
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = 0; r < k; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let j = c; j < k; j++) A[r][j] -= f * A[c][j]; b[r] -= f * b[c]; }
  }
  const coef = b.map((v, i) => (Math.abs(A[i][i]) < 1e-12 ? 0 : v / A[i][i]));
  return { b0: coef[0], w: Object.fromEntries(feats.map((f, i) => [f, coef[i + 1]])) };
}
const wPred = (m, x, feats) => Math.max(0, m.b0 + feats.reduce((a, f) => a + m.w[f] * (x[f] || 0), 0));
function wR2(m, rows, feats) {
  if (rows.length < 3) return null;
  const mean = rows.reduce((a, r) => a + r.y, 0) / rows.length;
  let ss = 0, sr = 0; rows.forEach(r => { ss += (r.y - mean) ** 2; sr += (r.y - wPred(m, r.x, feats)) ** 2; });
  return ss ? 1 - sr / ss : null;
}

function workload(model) {
  const s = model.latest, proj = model.projections, U = proj && proj.usage;
  if (!s || !U || !U.weeks || String(proj.season) !== String(s.year)) return null;
  const F = U.fields, ix = Object.fromEntries(F.map((f, i) => [f, i]));
  const weeks = s.regWeeks.filter(w => U.weeks[w] && Object.keys(U.weeks[w]).length);
  if (!weeks.length) return null;
  const posOf = pid => { const p = String(((model.players || {})[pid] || [])[1] || "").toUpperCase(); return p === "FB" ? "RB" : p; };
  // Actual league points: league data when rostered, else the export's league-scored actuals
  const pp = {}; s.teamWeeks.forEach(t => { if (t.playoff) return; (t.roster || []).forEach(p => { (pp[t.week] = pp[t.week] || {})[p] = (t.pp && t.pp[p]) || 0; }); });
  const actOf = (w, pid) => (pp[w] && pid in pp[w]) ? pp[w][pid] : ((proj.act && proj.act[w] && proj.act[w][pid]) || 0);
  const lines = []; // one per player-week with a game played
  const team = {}; // team totals per week
  weeks.forEach(w => Object.entries(U.weeks[w]).forEach(([pid, a]) => {
    const x = {}; F.forEach(f => { x[f] = a[ix[f]]; });
    if (!x.gp && !(x.snp > 0)) return;
    const tm = x.team || "?", T = (team[w] = team[w] || {})[tm] || (team[w][tm] = { tgt: 0, rzt: 0, att: 0, rz: 0, tsnp: 0, rbAtt: 0, rbTgt: 0, rbRz: 0 });
    T.tgt += x.tgt || 0; T.rzt += x.rzt || 0; T.att += x.att || 0; T.rz += x.rz || 0; T.tsnp = Math.max(T.tsnp, x.tsnp || 0);
    const pos = posOf(pid);
    if (pos === "RB") { T.rbAtt += x.att || 0; T.rbTgt += x.tgt || 0; T.rbRz += x.rz || 0; }
    if (pos === "QB") { if ((x.patt || 0) > 0) (T.qbs = T.qbs || []).push({ pid, patt: x.patt }); return; } // his carries and targets stay in the team totals above
    lines.push({ w, pid, pos, team: tm, x, y: actOf(w, pid), td: (x.rectd || 0) + (x.rushtd || 0) + (x.passtd || 0) });
  }));
  // Fit by position. Back-test: fit on the first 60% of weeks, test on the rest. Final model uses every week.
  const cut = weeks[Math.max(0, Math.floor(weeks.length * 0.6) - 1)];
  const models = {}, quality = {};
  Object.entries(W_FEATS).forEach(([pos, feats]) => {
    const rows = lines.filter(l => l.pos === pos);
    if (rows.length < 30) return;
    const full = wFit(rows, feats);
    const train = rows.filter(r => r.w <= cut), test = rows.filter(r => r.w > cut);
    const bt = train.length >= 20 && test.length >= 10 ? wFit(train, feats) : null;
    models[pos] = full;
    quality[pos] = { n: rows.length, r2: wR2(full, rows, feats), r2Test: bt ? wR2(bt, test, feats) : null, trainWeeks: weeks.filter(w => w <= cut), testWeeks: weeks.filter(w => w > cut) };
  });
  const tested = Object.values(quality).filter(q => q.r2Test != null);
  const r2Test = tested.length ? tested.reduce((a, q) => a + q.r2Test * q.n, 0) / tested.reduce((a, q) => a + q.n, 0) : null;
  lines.forEach(l => { const m = models[l.pos]; l.wp = m ? wPred(m, l.x, W_FEATS[l.pos]) : null; });
  // Season rows per player
  const byP = {};
  lines.forEach(l => { (byP[l.pid] = byP[l.pid] || []).push(l); });
  const players = {};
  Object.entries(byP).forEach(([pid, L]) => {
    L.sort((a, b) => a.w - b.w);
    const sum = (arr, f) => arr.reduce((a, l) => a + (l.x[f] || 0), 0);
    const tsum = (arr, f) => arr.reduce((a, l) => a + ((team[l.w][l.team] || {})[f] || 0), 0);
    const share = (arr, f, tf) => { const d = tsum(arr, tf || f); return d ? sum(arr, f) / d : null; };
    const last = L.slice(-3), pos = L[L.length - 1].pos, tm = L[L.length - 1].team;
    const g = L.length, wpS = L.reduce((a, l) => a + (l.wp || 0), 0), act = L.reduce((a, l) => a + l.y, 0);
    const tgtSh = share(L, "tgt");
    const P = {
      pid, pos, team: tm, g, weeks: L.map(l => ({ w: l.w, tm: l.team, wp: l.wp, act: l.y, tgt: l.x.tgt || 0, att: l.x.att || 0, snp: l.x.snp || 0, tsnp: l.x.tsnp || 0, td: l.td })),
      wp: wpS, act, gap: act - wpS, wpg: wpS / g, ppg: act / g, td: L.reduce((a, l) => a + l.td, 0),
      tgt: sum(L, "tgt"), rec: sum(L, "rec"), rzt: sum(L, "rzt"), att: sum(L, "att"), rz: sum(L, "rz"), patt: sum(L, "patt"),
      tgtSh, rztSh: share(L, "rzt"),
      tgtSh3: share(last, "tgt"), rushSh: share(L, "att"), rzSh: share(L, "rz"),
      snapSh: (() => { const d = L.reduce((a, l) => a + (l.x.tsnp || 0), 0); return d ? sum(L, "snp") / d : null; })(),
      snapSh3: (() => { const d = last.reduce((a, l) => a + (l.x.tsnp || 0), 0); return d ? sum(last, "snp") / d : null; })(),
      catchRate: sum(L, "tgt") ? sum(L, "rec") / sum(L, "tgt") : null
    };
    if (pos === "RB") {
      // Backfield: this back's share of his team's RB Workload points, carries, targets, and red zone carries, in his games
      const rbWp = L.reduce((a, l) => a + lines.filter(o => o.w === l.w && o.team === l.team && o.pos === "RB").reduce((b, o) => b + (o.wp || 0), 0), 0);
      const rbWp3 = last.reduce((a, l) => a + lines.filter(o => o.w === l.w && o.team === l.team && o.pos === "RB").reduce((b, o) => b + (o.wp || 0), 0), 0);
      P.bfSh = rbWp ? wpS / rbWp : null; P.bfSh3 = rbWp3 ? last.reduce((a, l) => a + (l.wp || 0), 0) / rbWp3 : null;
      P.rbAttSh = share(L, "att", "rbAtt"); P.rbTgtSh = share(L, "tgt", "rbTgt"); P.rbRzSh = share(L, "rz", "rbRz");
    }
    P.role = wRole(P);
    players[pid] = P;
  });
  wTrends(players, team, weeks, model.injuries || {});
  return { weeks, models, quality, r2Test, ok: r2Test != null && r2Test >= W_MIN_R2, players, team, lines };
}

/* ---------- Trends: last 3 team games against the earlier ones ----------
   Shares are pooled (his touches over the team's) with the player's current team only, so a low-volume game counts for less.
   One game far under his normal snaps is treated as an early exit and left out of his trend. */
const TR_BAR = { tgt: 0.05, att: 0.10, snp: 0.10 };
const TR_MIN_TOUCH = 4;  // touches a game in the window that carries the move
const TR_ABSENT_SH = 0.12; // a teammate this big, gone for 2 of the last 3, explains a rise
const trMedian = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : 0; };
function trExits(P) {
  const G = P.weeks.map(x => ({ w: x.w, sn: x.tsnp ? x.snp / x.tsnp : 0 }));
  const low = i => { const m = trMedian(G.filter((_, k) => k !== i).map(x => x.sn)); return G.length >= 4 && m >= 0.5 && G[i].sn < m * 0.5; };
  return G.filter((x, i) => low(i) && !(i > 0 && low(i - 1)) && !(i < G.length - 1 && low(i + 1))).map(x => x.w);
}
function wTrends(players, team, weeks, injuries) {
  const games = tm => weeks.filter(w => team[w] && team[w][tm]);
  const share = (L, f) => { const d = L.reduce((a, x) => a + ((team[x.w][x.tm] || {})[f] || 0), 0); return d ? L.reduce((a, x) => a + (x[f] || 0), 0) / d : null; };
  const snap = L => { const d = L.reduce((a, x) => a + (x.tsnp || 0), 0); return d ? L.reduce((a, x) => a + (x.snp || 0), 0) / d : null; };
  const touches = L => L.length ? L.reduce((a, x) => a + (x.tgt || 0) + (x.att || 0), 0) / L.length : 0;
  Object.values(players).forEach(P => {
    const tg = games(P.team), last3 = tg.slice(-3), exits = trExits(P);
    const mine = P.weeks.filter(x => x.tm === P.team), L = mine.filter(x => !exits.includes(x.w));
    const late = L.filter(x => last3.includes(x.w)), early = L.filter(x => !last3.includes(x.w));
    const key = P.pos === "RB" ? "att" : "tgt", T = { key, exits, weeksLate: last3, series: P.weeks.map(x => ({ w: x.w, sh: (team[x.w][x.tm] || {})[key] ? (x[key] || 0) / team[x.w][x.tm][key] : 0, exit: exits.includes(x.w) })) };
    const lastW = tg[tg.length - 1], lg = mine.find(x => x.w === lastW);
    T.now = lg ? (team[lg.w][lg.tm][key] ? (lg[key] || 0) / team[lg.w][lg.tm][key] : 0) : null;
    T.late = share(late, key); T.early = share(early, key); T.overall = share(mine, key);
    T.snapLate = snap(late); T.snapEarly = snap(early); T.nLate = late.length; T.nEarly = early.length;
    P.trend = T;
    if (late.length < 2 || early.length < 2) return;
    const opts = (P.pos === "RB" ? ["att", "tgt"] : ["tgt"]).map(f => ({ f, a: share(early, f), b: share(late, f) })).filter(o => o.a != null && o.b != null && Math.abs(o.b - o.a) >= TR_BAR[o.f]);
    const pick = opts.sort((p, q) => Math.abs(q.b - q.a) / TR_BAR[q.f] - Math.abs(p.b - p.a) / TR_BAR[p.f])[0];
    if (!pick) return;
    const up = pick.b > pick.a;
    if (touches(up ? late : early) < TR_MIN_TOUCH) return;
    T.move = { f: pick.f, a: pick.a, b: pick.b, d: pick.b - pick.a, up, score: Math.abs(pick.b - pick.a) / TR_BAR[pick.f] };
    if (!up) return;
    // Who left the room? Risers only: a teammate's absence does not explain a fall.
    let gone = null;
    Object.values(players).forEach(Q => {
      if (Q === P || (pick.f === "att" && Q.pos !== "RB")) return;
      const was = Q.weeks.filter(x => x.tm === P.team && !last3.includes(x.w)); if (was.length < 2) return;
      const sh = share(was, pick.f); if (sh == null || sh < TR_ABSENT_SH) return;
      const missed = last3.filter(w => !Q.weeks.some(x => x.w === w && x.tm === P.team));
      if (missed.length >= 2 && (!gone || sh > gone.sh)) gone = { pid: Q.pid, sh, missed, back: !missed.includes(last3[last3.length - 1]) ? last3[last3.length - 1] : null, status: (injuries[Q.pid] || {}).s || null, moved: Q.team !== P.team ? Q.team : null };
    });
    T.move.gone = gone;
  });
}
// QB splits: target share by starter. The starter has the most pass attempts. A game where a second QB throws 10 or more is left out.
function wQbSplits(W, tm) {
  const tg = W.weeks.filter(w => W.team[w] && W.team[w][tm]), by = {};
  tg.forEach(w => { const q = (W.team[w][tm].qbs || []).slice().sort((a, b) => b.patt - a.patt); if (!q.length || (q[1] && q[1].patt >= 10)) return; (by[q[0].pid] = by[q[0].pid] || []).push(w); });
  // Up to 3 QBs by games, always keeping the latest starter, shown in the order they started
  const all = Object.entries(by).map(([pid, ws]) => ({ pid, ws })).sort((a, b) => b.ws.length - a.ws.length);
  if (all.length < 2) return null;
  const latest = all.slice().sort((a, b) => b.ws[b.ws.length - 1] - a.ws[a.ws.length - 1])[0], qbs = all.slice(0, 3);
  if (!qbs.includes(latest)) qbs[2] = latest;
  qbs.sort((a, b) => a.ws[0] - b.ws[0]);
  const rows = Object.values(W.players).filter(p => p.pos !== "QB" && p.weeks.some(x => x.tm === tm)).map(p => {
    const cells = qbs.map(q => { const L = p.weeks.filter(x => x.tm === tm && q.ws.includes(x.w)); const d = L.reduce((a, x) => a + (W.team[x.w][tm].tgt || 0), 0); return d ? L.reduce((a, x) => a + (x.tgt || 0), 0) / d : null; });
    return { pid: p.pid, tgt: p.weeks.filter(x => x.tm === tm).reduce((a, x) => a + (x.tgt || 0), 0), cells };
  }).filter(r => r.cells.filter(c => c != null).length >= 2).sort((a, b) => b.tgt - a.tgt).slice(0, 3);
  return rows.length ? { qbs, rows } : null;
}

// With and without: the biggest share swing when a key teammate sits. Each side needs 2 games.
function wWithout(W, tm, injuries) {
  const tg = W.weeks.filter(w => W.team[w] && W.team[w][tm]), ps = Object.values(W.players).filter(p => p.weeks.some(x => x.tm === tm));
  const inTeam = (p, ws) => p.weeks.filter(x => x.tm === tm && ws.includes(x.w));
  const share = (L, f) => { const d = L.reduce((a, x) => a + (W.team[x.w][tm][f] || 0), 0); return d ? L.reduce((a, x) => a + (x[f] || 0), 0) / d : null; };
  const out = [];
  ps.forEach(A => {
    const f = A.pos === "RB" ? "att" : "tgt", mine = A.weeks.filter(x => x.tm === tm), first = mine.length ? mine[0].w : 99;
    const on = tg.filter(w => mine.some(x => x.w === w)), off = tg.filter(w => w > first && !on.includes(w));
    const sh = share(mine, f); if (sh == null || sh < 0.15 || on.length < 2 || off.length < 2) return;
    // Stay current: he sat the latest game, or Sleeper lists him as unavailable today
    const status = (injuries[A.pid] || {}).s || null, recent = off.includes(tg[tg.length - 1]);
    if (!recent && !["Out", "IR", "Doubtful", "PUP", "Sus", "NA"].includes(status)) return;
    let best = null;
    ps.forEach(B => {
      if (B === A || (f === "att" && B.pos !== "RB")) return;
      const a = inTeam(B, off), b = inTeam(B, on); if (a.length < 2 || b.length < 2) return;
      const x = share(a, f), y = share(b, f); if (x == null || y == null || x - y < TR_BAR[f]) return;
      if (!best || x - y > best.x - best.y) best = { pid: B.pid, x, y, nx: a.length, ny: b.length };
    });
    if (best) out.push({ star: A.pid, f, best, status, moved: A.team !== tm ? A.team : null });
  });
  return out.sort((p, q) => Math.abs(q.best.x - q.best.y) - Math.abs(p.best.x - p.best.y)).slice(0, 3);
}

// Role labels need 3 games
function wRole(P) {
  if (P.g < 3) return null;
  if (P.pos === "RB" && P.bfSh != null) {
    if (P.rbRzSh != null && P.rbRzSh >= 0.4 && P.bfSh < 0.4) return "Vulture";
    return P.bfSh >= 0.7 ? "Workhorse" : P.bfSh >= 0.5 ? "Lead back" : P.bfSh >= 0.3 ? "Committee" : "Change of pace";
  }
  if ((P.pos === "WR" || P.pos === "TE") && P.tgtSh != null) return P.tgtSh >= 0.25 ? "Alpha" : P.tgtSh >= 0.15 ? "Starter" : P.tgtSh >= 0.08 ? "Role player" : "Depth";
  return null;
}

// One NFL team: receivers by target share and backs by backfield share, season and last 3 weeks
function wTeam(W, tm) {
  const ps = Object.values(W.players).filter(p => p.team === tm);
  const rec = ps.filter(p => ["WR", "TE", "RB"].includes(p.pos) && p.tgt > 0).sort((a, b) => b.tgt - a.tgt);
  const tw = W.weeks.filter(w => W.team[w] && W.team[w][tm]);
  const T = k => tw.reduce((a, w) => a + W.team[w][tm][k], 0);
  const last3 = tw.slice(-3), T3 = k => last3.reduce((a, w) => a + W.team[w][tm][k], 0);
  const p3 = (p, f) => { const L = p.weeks.filter(x => last3.includes(x.w)); const d = T3(f); return d ? L.reduce((a, x) => a + x[f], 0) / d : null; };
  // Team-level shares (over all team games, so a missed game counts as zero)
  const tree = rec.map(p => ({ p, sh: T("tgt") ? p.tgt / T("tgt") : 0, sh3: p3(p, "tgt") }));
  const backs = ps.filter(p => p.pos === "RB" && (p.att > 0 || p.tgt > 0));
  const rbW = tw.reduce((a, w) => a + W.lines.filter(o => o.w === w && o.team === tm && o.pos === "RB").reduce((b, o) => b + (o.wp || 0), 0), 0);
  const rbW3 = last3.reduce((a, w) => a + W.lines.filter(o => o.w === w && o.team === tm && o.pos === "RB").reduce((b, o) => b + (o.wp || 0), 0), 0);
  const field = backs.map(p => ({ p, sh: rbW ? p.wp / rbW : 0, sh3: rbW3 ? p.weeks.filter(x => last3.includes(x.w)).reduce((a, x) => a + (x.wp || 0), 0) / rbW3 : null })).sort((a, b) => b.sh - a.sh);
  return { tm, games: tw.length, tgt: T("tgt"), tree, field };
}


(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f2 = n => (Math.round((n || 0) * 100) / 100).toFixed(2);
  const f1 = n => (Math.round((n || 0) * 10) / 10).toFixed(1);
  const sign = n => (n > 0 ? "+" : n < 0 ? "−" : "") + f1(Math.abs(n));
  const signInt = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.round(Math.abs(n)).toLocaleString();
  const rec = r => r.w + "-" + r.l + (r.t ? "-" + r.t : "");
  const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const views = ["home", "standings", "week", "rivals", "members", "history", "draft", "moves", "trades", "chart", "advisor", "gifts", "prophets", "work"];
  const moreViews = ["members", "history", "draft", "moves", "rivals", "gifts", "prophets", "work"];
  const deskViews = ["advisor", "chart", "trades"];
  const st = { model: null, year: null, week: null, rival: null, rivalB: null, rivalScope: "all", apScope: null, tradeScope: "all", withPO: false, standView: "final", member: null, goto: null, me: null, wireKind: "pickups", wireScope: "all", wireMode: "share", wireBar: "avg", values: null, tv: null, chartPos: "all", prView: "acts", gWeek: null, gView: "position", gTeam: null, gCache: {}, ppCache: {}, stakeCache: {}, dCache: {}, scaleCache: {}, prayAll: false, multi: null, mtPick: "", mtTo: "", mtSel: null, mtPair: true, mtLock: new Set(), mtRes: null, chartOpen: null, trade: { a: null, b: null, aGets: [], bGets: [] }, ideasFor: null, ideaCache: {} };
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} } };

  const season = () => st.model.seasons.find(s => s.year === st.year);
  const seasonOf = year => st.model.seasons.find(s => s.year === year);
  const ownerName = uid => (st.model.owners[uid] || {}).name || "Unknown";
  const teamIn = (uid, s) => (s && s.teamName[uid]) || (st.model.owners[uid] && st.model.owners[uid].teams[(s || {}).year]) || ownerName(uid);
  const who = (uid, s) => `<span class="who"><b>${esc(teamIn(uid, s))}</b><span>${esc(ownerName(uid))}</span></span>`;
  const whoInline = (uid, s) => `<b>${esc(teamIn(uid, s))}</b> <span class="muted">${esc(ownerName(uid))}</span>`;
  // Tappable player name: opens the player card anywhere in the app
  const pn = (pid, name) => pid && pid !== "0" ? `<button type="button" class="plink" data-pid="${esc(pid)}">${esc(name)}</button>` : esc(name);
  const pIdx = () => (st.pIdx !== undefined ? st.pIdx : (st.pIdx = prophIndex(st.model)));
  const wkOf = () => (st.wk !== undefined ? st.wk : (st.wk = workload(st.model)));
  const ownTag = pid => { const o = Object.entries(st.model.latest.currentRosters || {}).find(([, r]) => r.includes(pid)); return o ? ownerName(o[0]) : "Free agent"; };
  const shPct = x => x == null ? "–" : Math.round(x * 100) + "%";
  const roleTag = r => r ? `<span class="tag role">${esc(r)}</span>` : "";
  const moveCls = (now, base, bar) => now == null || base == null ? "" : now - base >= (bar || 0.05) ? "w" : now - base <= -(bar || 0.05) ? "l" : "muted";
  const TR_NAME = { tgt: "Target share", att: "Rush share" };
  const trIsFill = T => !!(T && T.move && T.move.gone);
  const trArrow = p => { const m = p.trend && p.trend.move; if (!m) return ""; const fill = !!m.gone; return `<span class="tr ${fill ? "fill" : m.up ? "up" : "down"}" role="img" aria-label="${esc(TR_NAME[m.f])} ${m.up ? "up" : "down"} ${Math.abs(Math.round(m.d * 1000) / 10)} points, last 3 games${fill ? ", filling in" : ""}">${m.up ? "▲" : "▼"}</span>`; };
  const trGone = g => { const n = (st.model.players[g.pid] || [g.pid])[0]; return `${esc(n)}: ${g.moved ? `now with ${esc(g.moved)}` : g.back ? `back in Week ${g.back}` : g.status ? esc(g.status) : "out of the lineup"}`; };
  const trMoved = x => x.moved ? `now with ${esc(x.moved)}` : x.status ? esc(x.status) : "out of the lineup";
  const prOf = s => { st.prCache = st.prCache || {}; return s.year in st.prCache ? st.prCache[s.year] : (st.prCache[s.year] = prophecy(s, st.model.projections)); };
  const T = (uid, s) => `<b>${esc(teamIn(uid, s))}</b> <span class="muted">(${esc(ownerName(uid))})</span>`;
  const sec = (title, kick) => `<h2>${esc(title)}</h2>${kick ? `<p class="kick">${kick}</p>` : ""}`;
  const poChips = () => `<div class="chips" role="group" aria-label="Games counted"><button data-po="0" aria-pressed="${!st.withPO}">Regular season</button><button data-po="1" aria-pressed="${st.withPO}">With postseason</button></div>`;
  const gameTag = g => !g ? "" : g.title ? '<span class="tag gold">Final</span>' : g.kind === "playoff" ? '<span class="tag gold">Playoff</span>' : g.lidGame ? '<span class="tag lid">Lid game</span>' : g.kind === "consolation" ? '<span class="tag">Toilet bowl</span>' : "";
  const activeOwners = () => Object.values(st.model.owners).filter(o => o.active).sort((a, b) => a.name.localeCompare(b.name));
  const allOwners = () => Object.values(st.model.owners).filter(o => o.seasons.length).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  const ownerOptions = (sel) => allOwners().map(o => `<option value="${esc(o.uid)}"${o.uid === sel ? " selected" : ""}>${esc(o.name)}${o.active ? "" : " (retired)"}</option>`).join("");
  const goBtn = (view, section, extra) => `<button type="button" class="go" data-go="${view}" data-sec="${esc(section)}"${extra || ""}>`;

  /* ---------- The sermon: a scored pool of stories, Baptist delivery ----------
     sermonBook() walks every scored week in order. Each story gets a news score from how rare it is in
     league history, then what happened to the standings, minus what ran in the last two weeks. The result
     is fixed by the data, so everyone sees the same sermon and past weeks never change.
     Rules: a team gets at most two lines and one negative line a week. Truth gates keep a joke off a week
     that did not earn it. The commissioner can lead at most once in any four weeks. */
  const SERMON_MAX = 7, SERMON_HOME = 5;
  const SERMON_N = v => `<b class="num">${f2(v)}</b>`;
  const SERMON_BANK = {
      high: [
        (A, p) => `${A} preached ${p}. Can I get an amen?`,
        (A, p) => `${A} put up ${p}. The choir stood up for that one.`,
        (A, p) => `${A} dropped ${p}. Somebody pass the offering plate.`,
        (A, p) => `${A} scored ${p}. That sermon ran long and nobody minded.`,
        (A, p) => `${A} went for ${p}. Front row at the revival.`,
        (A, p) => `${A} hung ${p} on the board. The deacons are taking notes.`,
        (A, p) => `${A} posted ${p}. Pastor is already using it as a sermon illustration.`,
        (A, p) => `${A} rang up ${p}. Hallelujah, and pass the rolls.`,
      ],
      blowout: [
        (A, B, m) => `${A} sent ${B} to the back pew by ${m}. Somebody check on him after service.`,
        (A, B, m) => `${A} beat ${B} by ${m}. That was less a game than a testimony.`,
        (A, B, m) => `${A} ran ${B} out of the fellowship hall by ${m}.`,
        (A, B, m) => `${A} handled ${B} by ${m}. Not even a potluck can fix that.`,
        (A, B, m) => `${A} beat ${B} by ${m}. The ushers had to clear the aisle.`,
        (A, B, m) => `${A} took ${B} apart by ${m}. Somebody start a meal train.`,
        (A, B, m) => `${A} won by ${m}. ${B} has been added to the Wednesday prayer list.`,
        (A, B, m) => `${A} beat ${B} by ${m}. That one is going in the church newsletter.`,
      ],
      upset: [
        (A, B) => `${A} took down ${B}, a team with a much better record. Five smooth stones.`,
        (A, B) => `${A} knocked off ${B} despite the worse record. Goliath had it coming.`,
        (A, B) => `${A} beat ${B}, who had the much better record. The last shall be first.`,
        (A, B) => `${A} toppled ${B} against the odds. Somebody tell the Philistines.`,
        (A, B) => `${A} upset ${B}. Nobody in the congregation saw that coming.`,
        (A, B) => `${A} beat the better team, ${B}. Mustard seed, meet mountain.`,
      ],
      close: [
        (A, B, m) => `${A} escaped ${B} by ${m}. Sweating like a deacon in a wool suit in July.`,
        (A, B, m) => `${A} edged ${B} by ${m}. Decided on the last verse of the last hymn.`,
        (A, B, m) => `${A} slipped past ${B} by ${m}. Closer than the potluck line at noon.`,
        (A, B, m) => `${A} survived ${B} by ${m}. Somebody was praying hard Monday night.`,
        (A, B, m) => `${A} beat ${B} by ${m}. That one went all the way to the benediction.`,
        (A, B, m) => `${A} held off ${B} by ${m}. Tighter than the church budget.`,
      ],
      tough: [
        (A, p) => `${A} scored ${p} and still lost. Even Job is wincing.`,
        (A, p) => `${A} put up ${p} and lost anyway. Some weeks the rain falls on the just.`,
        (A, p) => `${A} scored ${p} and came home with a loss. That belongs on the prayer list.`,
        (A, p) => `${A} had ${p} and lost. Wrong opponent, wrong Sunday.`,
        (A, p) => `${A} lost despite ${p}. Most weeks that wins. Not this one.`,
        (A, p) => `${A} scored ${p} and lost. Somebody bring that man a casserole.`,
      ],
      lucky: [
        (A, p) => `${A} won with just ${p}. That is grace, not works.`,
        (A, p) => `${A} won with ${p}. Undeserved, and he will take it.`,
        (A, p) => `${A} won on ${p}. His opponent showed him mercy.`,
        (A, p) => `${A} scraped by with ${p}. Not pretty, but it counts.`,
        (A, p) => `${A} won with ${p}. Don't ask how. Just say thank you.`,
        (A, p) => `${A} won with ${p}. A win is a win, even from the back row.`,
      ],
      asleep: [
        (A, p) => `${A} left ${p} points on his bench. The usher had to wake him up.`,
        (A, p) => `${A} left ${p} on the bench. Nodding off during the sermon again.`,
        (A, p) => `${A} benched ${p} points. Set your lineup like you mean it, brother.`,
        (A, p) => `${A} left ${p} sitting on the bench. Talents buried in the ground.`,
        (A, p) => `${A} left ${p} on the bench. Somebody get him a lineup accountability partner.`,
        (A, p) => `${A} benched ${p} points. Even the nursery sets a better lineup.`,
      ],
      badbeat: [
        (A, B, p, n, of) => `${A} beat ${n} of ${of} teams with ${p} and still lost to ${B}. He would have beaten nearly anyone else in the building.`,
        (A, B, p, n, of) => `${A} scored ${p}, better than ${n} of ${of} teams, and lost to ${B}. Somebody check the schedule maker's heart.`,
        (A, B, p, n, of) => `${A} outscored ${n} of ${of} teams with ${p} and still fell to ${B}. The race is not to the swift. Ecclesiastes 9:11.`,
        (A, B, p, n, of) => `${A} beat ${n} of ${of} teams and lost anyway, to ${B}. That loss needs a support group.`,
        (A, B, p, n, of) => `${A} put up ${p}, ahead of ${n} of ${of} teams, and lost to ${B}. He has filed a formal complaint with the deacon board.`,
        (A, B, p, n, of) => `${A} scored ${p}, better than ${n} of ${of} teams, and still lost to ${B}. Peace be with him. He will need it.`,
      ],
      regret: [
        (A, b, s, d) => `${A} benched ${b} and started ${s}. That swap cost ${d} points. The deacons are reviewing the tape.`,
        (A, b, s, d) => `${A} started ${s} over ${b} and gave away ${d}. He will be confessing that one at small group.`,
        (A, b, s, d) => `${A} sat ${b} for ${s}. ${d} points, gone. Lord, have mercy on that lineup.`,
        (A, b, s, d) => `${A} chose ${s} over ${b} and lost ${d} points on the swap. Even the nursery saw that coming.`,
        (A, b, s, d) => `${A} benched ${b} in favor of ${s}: minus ${d}. Pride goes before a fall, and so does that lineup.`,
        (A, b, s, d) => `${A} left ${b} on the bench and started ${s}. That is ${d} points he will hear about all week.`,
      ],
      low: [
        (A, p) => `${A} managed ${p}. Bless his heart, and his roster.`,
        (A, p) => `${A} scored ${p}. We will keep him in our prayers.`,
        (A, p) => `${A} put up ${p}. That team needs a revival.`,
        (A, p) => `${A} posted ${p}. Still wandering in the wilderness.`,
        (A, p) => `${A} scored ${p}. Somebody bring him a covered dish.`,
        (A, p) => `${A} had ${p}. A long week in the valley.`,
      ],
    player: [
      (A, n, p) => `${n} scored ${p} for ${A}. Sunday School star of the week.`,
      (A, n, p) => `${A} got ${p} from ${n}. Somebody give that man a perfect attendance pin.`,
      (A, n, p) => `${n} gave ${A} ${p}. He has been asked to teach next week.`,
      (A, n, p) => `${A} leaned on ${n} for ${p}. Loaves and fishes not required.`,
      (A, n, p) => `${n} put up ${p} for ${A}. Put him on the nominating committee.`,
      (A, n, p) => `${n} went for ${p} for ${A}. The whole pew stood up.`,
    ],
    prodigal: [
      (A, B, n, p, wk) => `${A} dropped ${n} in Week ${wk}. ${n} just gave ${B} ${p}. The prodigal did not come home.`,
      (A, B, n, p, wk) => `${n} scored ${p} for ${B}. ${A} let him walk in Week ${wk}. Some sheep do not come back.`,
      (A, B, n, p, wk) => `${B} got ${p} from ${n}, the same man ${A} dropped in Week ${wk}. That receipt is still on file.`,
      (A, B, n, p, wk) => `${A} let ${n} go in Week ${wk}. ${B} is thankful: ${p} this week.`,
    ],
    prophet: [
      (A, n, pr, ac) => `${n} was projected for ${pr} and scored ${ac} for ${A}. The prophets did not see that coming.`,
      (A, n, pr, ac) => `Sleeper said ${pr}. ${n} said ${ac}. ${A} is not complaining.`,
      (A, n, pr, ac) => `${A} started ${n} for ${pr} and got ${ac}. Exceeding abundantly.`,
      (A, n, pr, ac) => `${n} beat his ${pr} projection with ${ac} for ${A}. Somebody update the prophecy.`,
    ],
    falseprophet: [
      (A, n, pr, ac) => `${n} was projected for ${pr} and scored ${ac} for ${A}. Test the prophets.`,
      (A, n, pr, ac) => `Sleeper promised ${A} ${pr} from ${n}. He delivered ${ac}. False prophet.`,
      (A, n, pr, ac) => `${A} trusted ${n} for ${pr} and got ${ac}. Put not your trust in projections.`,
      (A, n, pr, ac) => `${n} gave ${A} ${ac} against a projection of ${pr}. Beware of false prophets.`,
    ],
    elo: [
      (A, d) => `${A} gained ${d} Elo points, the biggest climb of the week. Moving up the pews.`,
      (A, d) => `${A} added ${d} to his Elo rating. The deacons have noticed.`,
      (A, d) => `${A} climbed ${d} Elo points this week. Up to the front row.`,
      (A, d) => `${d} Elo points for ${A}, the week's biggest gain. Somebody save him a seat.`,
    ],
    rivalry: [
      (A, B, n) => `${A} finally beat ${B}, ending a ${n}-game skid in the series. Patience is a fruit of the Spirit.`,
      (A, B, n) => `${A} had lost ${n} straight to ${B}. Not anymore. Let the church say amen.`,
      (A, B, n) => `${B} had beaten ${A} ${n} straight. That streak is over. The walls of Jericho came down too.`,
      (A, B, n) => `After ${n} straight losses to ${B}, ${A} got one back. Forty years in the wilderness felt shorter.`,
    ],
    // Joined stories: two facts about the same team or game, told once
    hp: [
      (A, n, p, v) => `${A} put up ${p}, and ${v} of it came from ${n}. The choir stood up for that one.`,
      (A, n, p, v) => `${A} scored ${p} behind ${v} from ${n}. Can I get an amen?`,
      (A, n, p, v) => `${n} gave ${A} ${v} on the way to ${p}. Hallelujah, and pass the rolls.`,
      (A, n, p, v) => `${A} went for ${p}. ${n} did ${v} of that. Somebody pass the offering plate.`,
    ],
    hb: [
      (A, B, p, m) => `${A} scored ${p} and beat ${B} by ${m}. Somebody open a window.`,
      (A, B, p, m) => `${A} hung ${p} on ${B} and won by ${m}. No closing hymn required.`,
      (A, B, p, m) => `${A} put up ${p}, the best of the week, and ${B} lost by ${m}. The ushers have stopped counting.`,
      (A, B, p, m) => `${B} caught ${A} on a ${p} Sunday and lost by ${m}. Wrong week to visit.`,
    ],
    br: [
      (A, B, m, b, s, d, tot) => `${A} beat ${B} by ${m} with ${b} on the bench for ${s}. The right lineup makes it ${tot}.`,
      (A, B, m, b, s, d) => `${A} won by ${m} and still sat ${b} for ${s}. That is ${d} points of mercy for ${B}.`,
      (A, B, m, b, s, d) => `${A} started ${s} over ${b}, gave away ${d}, and still beat ${B} by ${m}. Some men do not need the whole sermon.`,
      (A, B, m, b, s, d, tot) => `${A} beat ${B} by ${m}. With ${b} in for ${s}, that is ${tot}. Be thankful for small mercies.`,
    ],
    bl: [
      (A, B, m, p) => `${A} beat ${B} by ${m}. That ${p} was also the low score of the week, so the casseroles are on the way.`,
      (A, B, m, p) => `${B} managed ${p}, the week's low, and lost to ${A} by ${m}. Bless his heart, and his roster.`,
      (A, B, m, p) => `${B} scored ${p}, the lowest of the week, and ${A} won by ${m}. He is on the Wednesday prayer list.`,
      (A, B, m, p) => `${A} won by ${m} against the week's lowest score, ${p} from ${B}. That team needs a revival.`,
    ],
    rl: [
      (A, B, m, b, s, d) => `${B} lost to ${A} by ${m} with ${b} on the bench for ${s}. That swap was worth ${d}. He will be confessing that one at small group.`,
      (A, B, m, b, s, d) => `${B} sat ${b} for ${s}, gave away ${d}, and lost to ${A} by ${m}. The deacons are reviewing the tape.`,
      (A, B, m, b, s, d) => `${A} beat ${B} by ${m}, and ${b} sat while ${s} started. Minus ${d}. Lord, have mercy on that lineup.`,
      (A, B, m, b, s) => `${B} fell to ${A} by ${m}. Start ${b} over ${s} and that is a win. Pride goes before a fall.`,
    ],
    ll: [
      (A, p, b, s, d) => `${A} managed ${p} with ${b} on the bench for ${s}. That is ${d} points he will hear about all week.`,
      (A, p, b, s) => `${A} scored ${p} and started ${s} over ${b}. Bless his heart, and his lineup.`,
      (A, p, b, s) => `${A} posted ${p}, the week's low, and sat ${b} for ${s}. Still wandering in the wilderness.`,
      (A, p, b, s, d) => `${A} had ${p}. Starting ${b} over ${s} adds ${d}. A long week in the valley.`,
    ],
    bb: [
      (A, B, p, h, n, of) => `${A} beat ${n} of ${of} teams with ${p}, then drew ${B} on a ${h} Sunday. Wrong opponent, wrong week.`,
      (A, B, p, h, n, of) => `${B} scored ${h}, the best of the week, and it had to come against ${A}. His ${p} beat ${n} of ${of} teams and did not matter.`,
      (A, B, p, h, n, of) => `${A} put up ${p}, ahead of ${n} of ${of} teams. ${B} had ${h}. Some Sundays the rain falls on the just.`,
      (A, B, p, h) => `${A} needed more than ${p} because ${B} brought ${h}. That loss needs a support group.`,
    ],
    ul: [
      (A, B, p) => `${A} beat ${B}, a team with the much better record, on just ${p}. Goliath did not even make him work.`,
      (A, B, p) => `${A} won with ${p}, the lowest winning score of the week, and the victim was ${B}. Five smooth stones, and not very big ones.`,
      (A, B, p) => `${A} took down ${B} with only ${p}. The last shall be first, even on a slow Sunday.`,
      (A, B, p) => `${A} beat the better team, ${B}, with ${p}. Don't ask how. Just say thank you.`,
    ],
    cl: [
      (A, B, p, m) => `${A} won on ${p}, and ${B} missed by ${m}. Somebody was praying hard Monday night.`,
      (A, B, p, m) => `${A} beat ${B} by ${m} with just ${p}. Two teams, one hymn, nobody on key.`,
      (A, B, p, m) => `${A} held off ${B} by ${m} with ${p}. Tighter than the church budget, and about as exciting.`,
      (A, B, p, m) => `${A} scraped past ${B} by ${m} on ${p}. Undeserved, and he will take it.`,
    ],
  };
  // Sermon titles. Negative stories never name the man, because this card gets screenshotted.
  const SERMON_TITLE = {
    streak: [(F, L, x) => `${x} Straight and Still Not Humble`, (F, L, x) => `${x} Straight. Somebody Pass the Plate`, (F, L, x) => `${F} Has Won ${x} Straight`, (F, L, x) => `${x} in a Row, and the Choir Is Tired`],
    record: [F => `A New Page in the Book of Numbers`, F => `${F} Rewrites the Book of Numbers`],
    high: [F => `The Book of ${F}`, F => `${F} Takes the Pulpit`, F => `A Word from ${F}`, F => `${F} Ran Long and Nobody Minded`],
    blowout: [() => `The Back Pew Is Filling Up`, () => `Not Even the Potluck Can Help`, () => `Fire and Brimstone Sunday`, F => `${F} Showed No Mercy`],
    upset: [F => `${F} and the Giant`, F => `Goliath Never Saw ${F} Coming`, () => `Slingshot Sunday`, () => `A Good Week for the Little Guy`],
    close: [() => `All Four Verses`, () => `Nobody Left Early`, F => `${F} by a Whisker`, () => `Down to the Last Amen`],
    badbeat: [F => `The Trials of ${F}`, F => `${F} Would Like a Word with the Schedule Maker`, () => `When Bad Beats Happen to Good Teams`, F => `The Patience of ${F}`],
    tough: [F => `The Patience of ${F}`, F => `A Hard Word for ${F}`, () => `Wrong Opponent, Wrong Sunday`, () => `The Rain Falls on the Just`],
    lucky: [F => `${F} Will Take It`, () => `Undeserved and Unbothered`, () => `Ugly Wins Count Too`, F => `Mercy for ${F}`],
    regret: [() => `The Wrong Man Started`, () => `A Lineup Confession`, () => `The Deacons Reviewed the Tape`, () => `Pride Goes Before a Fall`],
    asleep: [() => `Wake Up, Brother`, () => `Asleep in the Pew`, () => `Talents in the Ground`, () => `The Usher Has Questions`],
    prodigal: [() => `The One That Got Away`, () => `The Prodigal Did Not Come Home`, () => `Check the Waiver Receipts`, () => `Some Sheep Do Not Come Back`],
    prophet: [() => `Nobody Projected That`, () => `The Prophets Missed This One`, () => `Exceeding Abundantly`, () => `Somebody Update the Prophecy`],
    falseprophet: [() => `Beware of False Prophets`, () => `Test the Prophets`, () => `Put Not Your Trust in Projections`, () => `The Projection Lied`],
    elo: [F => `${F} Is Moving Up the Pews`, F => `Save ${F} a Seat`, F => `${F} Heads for the Front Row`, () => `A Good Week to Climb`],
    rivalry: [F => `${F} Finally Got One`, () => `The Streak Is Over`, () => `A Long Time Coming`, () => `The Walls Came Down`],
    player: [() => `Sunday School Star`, F => `${F} Found His Star Pupil`, () => `One Man Carried the Offering`, () => `Perfect Attendance`],
    low: [() => `A Long Week in the Valley`, () => `Still in the Wilderness`, () => `Somebody Bring a Covered Dish`, () => `We Will Keep Him in Our Prayers`],
  };
  const SERMON_RANK = { high: 1, blowout: 1, upset: 1, tough: 1, badbeat: 1, regret: 1, asleep: 1, player: 1, prodigal: 1, prophet: 1, falseprophet: 1, elo: 1, rivalry: 1, close: -1, lucky: -1, low: -1 };
  const SERMON_CAT = { high: "score", low: "score", blowout: "game", close: "game", upset: "game", badbeat: "luck", tough: "luck", lucky: "luck", regret: "lineup", asleep: "lineup", player: "player", prodigal: "news", prophet: "news", falseprophet: "news", elo: "news", rivalry: "news" };
  // Rotating formats: the same facts in a different frame each week
  const SERMON_TONE = { high: 1, hb: 1, hp: 1, blowout: 1, upset: 1, ul: 1, player: 1, prophet: 1, elo: 1, rivalry: 1, lucky: 1, low: -1, ll: -1, asleep: -1, regret: -1, rl: -1, falseprophet: -1, prodigal: -1, bl: -1, tough: -1, badbeat: -1, bb: -1 };
  const SERMON_FORMATS = [
    { kicker: "This week's sermon", label: () => "" },
    { kicker: "This week's bulletin", label: t => t > 0 ? "Praise report" : t < 0 ? "Prayer request" : "Announcement" },
    { kicker: "Business meeting minutes", label: t => t > 0 ? "New business" : t < 0 ? "Referred to committee" : "Noted in the minutes" },
    { kicker: "This week's sermon", label: (t, i) => `Point ${i + 1}` },
  ];
  const SERMON_AMEN = ["Go in peace.", "Let us close in prayer.", "See you Sunday.", "Drive safe in the parking lot."];
  const sermonHash = str => { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; };

  function sermonRanks(s, w) {
    const r = {}; s.uids.forEach(u => { r[u] = { uid: u, w: 0, pf: 0 }; });
    s.teamWeeks.filter(t => t.week <= w && t.result && !t.playoff && r[t.uid]).forEach(t => { r[t.uid].pf += t.pts; if (t.result === "W") r[t.uid].w++; else if (t.result === "T") r[t.uid].w += 0.5; });
    const rank = {}; Object.values(r).sort((a, b) => b.w - a.w || b.pf - a.pf).forEach((x, i) => { rank[x.uid] = i + 1; });
    return rank;
  }

  // Stories from outside the weekly awards. Each one must clear its own bar.
  function sermonNews(s, w, mem) {
    const tws = s.teamWeeks.filter(t => t.week === w && t.result), out = {};
    (s.wire || []).filter(e => e.leg < w && e.drops.length && !(st.model.owners[e.uid] || {}).orphan).forEach(e => e.drops.forEach(pid => {
      if (["K", "DEF"].includes(String(s.pinfo(pid)[1]).toUpperCase())) return;
      tws.forEach(t => { if (t.uid === e.uid) return; const x = t.starters.find(y => y.pid === pid); if (x && x.pts >= 20 && (!out.prodigal || x.pts > out.prodigal.pts || (x.pts === out.prodigal.pts && e.leg >= out.prodigal.wk))) out.prodigal = { uid: e.uid, to: t.uid, pid, pts: x.pts, wk: e.leg }; });
    }));
    const stars = mem.ix && mem.ix.season === s ? prophWeekStars(mem.ix, w) : null;
    if (stars && stars.best.gap >= 15) out.prophet = stars.best;
    // A zero usually means he did not play, and that is no joke. Take the worst man who suited up.
    if (stars) { const P = mem.ix.proj.weeks[w] || {}; let low = null; Object.entries(mem.ix.startOf[w] || {}).forEach(([pid, uid]) => { const pr = P[pid], ac = mem.ix.act(w, pid); if (pr == null || !ac || ac <= 0) return; const gap = Math.round((ac - pr) * 100) / 100; if (!low || gap < low.gap) low = { pid, uid, proj: pr, act: ac, gap }; }); if (low && low.gap <= -15) out.falseprophet = low; }
    const up = (mem.elo[s.year + ":" + w] || []).sort((p, q) => q.d - p.d)[0];
    if (up && up.d > 0) out.elo = up;
    s.games.filter(g => g.week === w && g.a.pts !== g.b.pts).forEach(g => {
      const win = g.a.pts > g.b.pts ? g.a.uid : g.b.uid, lose = win === g.a.uid ? g.b.uid : g.a.uid;
      const key = [win, lose].sort().join("|"), past = mem.series[key] || (mem.series[key] = []);
      let n = 0; for (let i = past.length - 1; i >= 0 && past[i] === lose; i--) n++;
      if (n >= 3 && (!out.rivalry || n > out.rivalry.n)) out.rivalry = { uid: win, vs: lose, n };
      past.push(win);
    });
    return out;
  }

  function sermonWeek(s, w, mem) {
    const a = {}; weekAwards(s, w).forEach(x => { a[x.key] = x; });
    if (!a.high) return null;
    mem.news = sermonNews(s, w, mem);
    const metric = { prodigal: mem.news.prodigal && mem.news.prodigal.pts, prophet: mem.news.prophet && mem.news.prophet.gap, falseprophet: mem.news.falseprophet && -mem.news.falseprophet.gap, elo: mem.news.elo && mem.news.elo.d, rivalry: mem.news.rivalry && mem.news.rivalry.n, high: a.high.value, blowout: a.blowout && a.blowout.value, close: a.close && a.close.value, upset: a.upset && a.upset.gap, badbeat: a.badbeat && a.badbeat.value, tough: a.tough && a.tough.value, lucky: a.lucky && a.lucky.value, player: a.player && a.player.value, regret: a.regret && a.regret.value, asleep: a.asleep && a.asleep.value, low: a.low && a.low.value };
    const rarity = k => { const h = mem.hist[k] || [], v = metric[k]; if (h.length < 5) return 50; return 100 * h.filter(x => SERMON_RANK[k] > 0 ? x < v : x > v).length / h.length; };
    const remember = () => Object.keys(metric).forEach(k => { if (metric[k] != null) (mem.hist[k] = mem.hist[k] || []).push(metric[k]); });

    // Truth gates: the joke has to fit what happened
    const tws = s.teamWeeks.filter(t => t.week === w && t.result);
    const sorted = tws.map(t => t.pts).sort((x, y) => x - y), median = sorted[Math.floor(sorted.length / 2)];
    const played = s.teamWeeks.filter(t => t.week <= w && t.game);
    const seasonAvg = played.reduce((n, t) => n + t.pts, 0) / (played.length || 1);
    const gate = { blowout: x => x.value >= 25, close: x => x.value <= 10, tough: x => x.value >= median, lucky: x => x.value < median, regret: x => x.value >= 8, asleep: x => x.value >= 15, low: x => x.value <= seasonAvg * 0.9 };
    Object.keys(gate).forEach(k => { if (a[k] && !gate[k](a[k])) delete a[k]; });
    if (a.regret && a.asleep && a.regret.uid === a.asleep.uid) delete a.asleep;
    if (a.badbeat && a.tough && a.badbeat.uid === a.tough.uid) delete a.tough;

    // Live facts, and what the week did to the standings
    const allTw = st.model.seasons.filter(x => +x.year <= +s.year).flatMap(x => x.teamWeeks.filter(t => t.game && (x.year !== s.year || t.week <= w)));
    const streakOf = uid => { let n = 0; s.teamWeeks.filter(t => t.uid === uid && t.result && t.week <= w).sort((p, q) => q.week - p.week).every(t => (t.result === "W" ? ++n : 0)); return n; };
    const tail = {}, bonus = { rivalry: 15 }; let streakUsed = false;
    if (a.high) { const v = a.high.value; if (allTw.every(t => t.pts <= v)) { tail.high = " A new league record."; bonus.high = 40; } else if (played.every(t => t.pts <= v) && w > 1) { tail.high = " That is the season high."; bonus.high = 12; } }
    if (a.low && w > 1 && played.every(t => t.pts >= a.low.value)) { tail.low = " Lowest score of the season so far."; bonus.low = 12; }
    ["high", "blowout", "upset", "close", "lucky"].forEach(k => { if (streakUsed || !a[k]) return; const n = streakOf(a[k].uid); if (n >= 3) { tail[k] = (tail[k] || "") + ` ${esc(ownerName(a[k].uid))} has won ${n} straight.`; bonus[k] = (bonus[k] || 0) + (n >= 4 ? 10 : 4); streakUsed = true; if (n >= 4) mem.streak = { uid: a[k].uid, n }; } });
    const moves = {};
    if (w >= 3 && !tws[0].playoff) {
      const P = s.playoffTeams, was = sermonRanks(s, w - 1), now = sermonRanks(s, w);
      s.uids.forEach(u => { const b = was[u], n = now[u]; if (n === 1 && b !== 1) moves[u] = "takes over first place"; else if (n <= P && b > P) moves[u] = "moves into a playoff spot"; else if (n > P && b <= P) moves[u] = "drops out of the playoff field"; });
    }

    // The base stories
    const P = (r, pid) => `<b>${esc(s.pinfo(pid)[0])}</b> (${f1(pid === r.bench ? r.bPts : r.sPts)})`;
    const D = v => `<b class="num">${f1(v)}</b>`;
    const N = SERMON_N;
    const story = (key, uids, victims, args, extra) => Object.assign({ key, bank: key, keys: [key], cat: SERMON_CAT[key], uids, victims, args, score: rarity(key) + (bonus[key] || 0), tail: tail[key] || "" }, extra || {});
    const S = {};
    if (a.high) S.high = story("high", [a.high.uid], [], T => [T(a.high.uid), N(a.high.value)]);
    if (a.blowout) S.blowout = story("blowout", [a.blowout.uid, a.blowout.vs], [a.blowout.vs], T => [T(a.blowout.uid), T(a.blowout.vs), N(a.blowout.value)]);
    if (a.upset) S.upset = story("upset", [a.upset.uid, a.upset.vs], [a.upset.vs], T => [T(a.upset.uid), T(a.upset.vs)]);
    if (a.close) S.close = story("close", [a.close.uid, a.close.vs], [a.close.vs], T => [T(a.close.uid), T(a.close.vs), N(a.close.value)]);
    if (a.badbeat) S.badbeat = story("badbeat", [a.badbeat.uid, a.badbeat.vs], [], T => [T(a.badbeat.uid), T(a.badbeat.vs), N(a.badbeat.value), a.badbeat.beat, a.badbeat.of]);
    if (a.tough) S.tough = story("tough", [a.tough.uid], [a.tough.uid], T => [T(a.tough.uid), N(a.tough.value)]);
    if (a.lucky) S.lucky = story("lucky", [a.lucky.uid], [], T => [T(a.lucky.uid), N(a.lucky.value)]);
    if (a.regret) { const r = a.regret.regret; S.regret = story("regret", [a.regret.uid], [a.regret.uid], T => [T(a.regret.uid), P(r, r.bench), P(r, r.starter), D(r.diff)]); }
    if (a.asleep) S.asleep = story("asleep", [a.asleep.uid], [a.asleep.uid], T => [T(a.asleep.uid), N(a.asleep.value)]);
    if (a.player) S.player = story("player", [a.player.uid], [], T => [T(a.player.uid), `<b>${esc(s.pinfo(a.player.pid)[0])}</b>`, N(a.player.value)], { filler: rarity("player") < 85 });
    if (mem.news.prodigal) { const x = mem.news.prodigal; S.prodigal = story("prodigal", [x.uid, x.to], [x.uid], T => [T(x.uid), T(x.to), `<b>${esc(s.pinfo(x.pid)[0])}</b>`, N(x.pts), x.wk]); }
    if (mem.news.prophet) { const x = mem.news.prophet; S.prophet = story("prophet", [x.uid], [], T => [T(x.uid), `<b>${esc(s.pinfo(x.pid)[0])}</b>`, D(x.proj), D(x.act)]); }
    if (mem.news.falseprophet) { const x = mem.news.falseprophet; S.falseprophet = story("falseprophet", [x.uid], [x.uid], T => [T(x.uid), `<b>${esc(s.pinfo(x.pid)[0])}</b>`, D(x.proj), D(x.act)]); }
    if (mem.news.elo) { const x = mem.news.elo; S.elo = story("elo", [x.uid], [], T => [T(x.uid), D(x.d)], { filler: rarity("elo") < 85, noLead: true }); }
    if (mem.news.rivalry) { const x = mem.news.rivalry; S.rivalry = story("rivalry", [x.uid, x.vs], [], T => [T(x.uid), T(x.vs), x.n]); }
    if (a.low) S.low = story("low", [a.low.uid], [a.low.uid], T => [T(a.low.uid), N(a.low.value)]);

    // Joined stories replace their parts
    const join = (bank, parts, top, uids, victims, args, extra) => {
      if (!parts.every(k => S[k])) return;
      const tails = parts.map(k => S[k].tail).join("");
      const score = Math.max(...parts.map(k => S[k].score)) + 8;
      const lead = S[top];
      parts.forEach(k => { delete S[k]; });
      S[bank] = Object.assign({ key: top, bank, keys: parts, cat: lead.cat, uids, victims, args, score, tail: tails }, extra || {});
    };
    if (S.regret && a.regret.lostGame) {
      const r = a.regret.regret, t = tws.find(x => x.uid === a.regret.uid), opp = t.opp, m = t.oppPts - t.pts;
      if (S.close && a.close.uid === opp) delete S.close;
      if (S.tough && a.tough.uid === a.regret.uid) delete S.tough;
      S.regret.score += 12;
      join("rl", ["regret"], "regret", [a.regret.uid, opp], [a.regret.uid], T => [T(opp), T(a.regret.uid), N(m), P(r, r.bench), P(r, r.starter), D(r.diff)]);
    }
    if (S.badbeat && S.high && a.badbeat.vs === a.high.uid) join("bb", ["badbeat", "high"], "badbeat", [a.badbeat.uid, a.high.uid], [], T => [T(a.badbeat.uid), T(a.high.uid), N(a.badbeat.value), N(a.high.value), a.badbeat.beat, a.badbeat.of]);
    if (S.high && S.blowout && a.high.uid === a.blowout.uid) join("hb", ["high", "blowout"], "high", [a.high.uid, a.blowout.vs], [a.blowout.vs], T => [T(a.high.uid), T(a.blowout.vs), N(a.high.value), N(a.blowout.value)]);
    if (S.high && S.player && a.high.uid === a.player.uid) join("hp", ["high", "player"], "high", [a.high.uid], [], T => [T(a.high.uid), `<b>${esc(s.pinfo(a.player.pid)[0])}</b>`, N(a.high.value), N(a.player.value)]);
    if (S.blowout && S.regret && a.blowout.uid === a.regret.uid) { const r = a.regret.regret; join("br", ["blowout", "regret"], "blowout", [a.blowout.uid, a.blowout.vs], [a.blowout.vs], T => [T(a.blowout.uid), T(a.blowout.vs), N(a.blowout.value), P(r, r.bench), P(r, r.starter), D(r.diff), N(a.blowout.value + r.diff)]); if (S.br && S.low && a.low.uid === a.blowout.vs) { S.br.tail += ` ${esc(ownerName(a.low.uid))}'s ${f2(a.low.value)} was the low score of the week.` + S.low.tail; S.br.keys = S.br.keys.concat("low"); delete S.low; } }
    if (S.blowout && S.low && a.blowout.vs === a.low.uid) join("bl", ["blowout", "low"], "blowout", [a.blowout.uid, a.blowout.vs], [a.blowout.vs], T => [T(a.blowout.uid), T(a.blowout.vs), N(a.blowout.value), N(a.low.value)]);
    if (S.upset && S.lucky && a.upset.uid === a.lucky.uid) join("ul", ["upset", "lucky"], "upset", [a.upset.uid, a.upset.vs], [a.upset.vs], T => [T(a.upset.uid), T(a.upset.vs), N(a.lucky.value)]);
    if (S.close && S.lucky && a.close.uid === a.lucky.uid) join("cl", ["close", "lucky"], "close", [a.close.uid, a.close.vs], [a.close.vs], T => [T(a.close.uid), T(a.close.vs), N(a.lucky.value), N(a.close.value)]);
    if (S.low && S.regret && a.low.uid === a.regret.uid) { const r = a.regret.regret; join("ll", ["low", "regret"], "low", [a.low.uid], [a.low.uid], T => [T(a.low.uid), N(a.low.value), P(r, r.bench), P(r, r.starter), D(r.diff)]); }

    // Memory: what ran lately costs points
    const last = mem.log[mem.log.length - 1], prev = mem.log[mem.log.length - 2];
    const pool = Object.values(S).map(x => {
      let adj = x.score;
      x.keys.forEach(k => { if (last && last.keys.includes(k)) adj -= 18; if (prev && prev.keys.includes(k)) adj -= 8; });
      x.uids.forEach(u => { if (last) adj -= Math.min(10, 5 * (last.teams[u] || 0)); if (moves[u]) adj += 14; });
      return Object.assign(x, { adj: adj + (sermonHash(s.year + w + x.bank) % 100) / 100 });
    }).sort((p, q) => q.adj - p.adj);

    // The lead: the top story, unless that man or that kind of story led last week.
    const leadScore = x => x.adj - (["low", "asleep", "regret"].includes(x.key) ? 12 : 0) - (last && last.lead === x.key ? 25 : 0) - (last && last.leadUid === x.uids[0] ? 15 : 0);
    const commishBusy = mem.log.slice(-3).some(p => p.leadUid === mem.commish);
    const lead = pool.filter(x => !x.filler && !x.noLead && !(commishBusy && x.uids[0] === mem.commish)).sort((p, q) => leadScore(q) - leadScore(p))[0];
    if (!lead) { remember(); return null; }

    // Fill the card: two lines a team, one negative line a man, two stories a category
    const lines = {}, hit = {}, cats = {}, chosen = [];
    const fits = (x, cap) => !x.uids.some(u => (lines[u] || 0) >= 2) && !x.victims.some(u => hit[u]) && (cats[x.cat] || 0) < cap;
    const take = x => { x.uids.forEach(u => { lines[u] = (lines[u] || 0) + 1; }); x.victims.forEach(u => { hit[u] = 1; }); cats[x.cat] = (cats[x.cat] || 0) + 1; chosen.push(x); };
    take(lead);
    pool.forEach(x => { if (x !== lead && !x.filler && chosen.length < SERMON_MAX && fits(x, 2) && !(x.key === "elo" && chosen.some(c => c.uids[0] === x.uids[0]))) take(x); });
    if (chosen.length < 4) pool.forEach(x => { if (!chosen.includes(x) && chosen.length < 4 && fits(x, 3)) take(x); });
    // An Elo line adds nothing when the same man already has a story
    const dup = chosen.findIndex(x => x.key === "elo" && chosen.some(c => c !== x && c.uids[0] === x.uids[0]));
    if (dup > 0 && chosen.length > 4) chosen.splice(dup, 1);

    // Order: lead first, then the best story that differs in kind from the one before it
    const rest = chosen.slice(1), order = [lead];
    while (rest.length) { const prior = order[order.length - 1].cat; const i = Math.max(0, rest.findIndex(x => x.cat !== prior)); order.push(rest.splice(i, 1)[0]); }

    // Bank lines rotate through every option before any repeats
    const draw = (bank, n) => { const u = mem.used[bank] || 0; mem.used[bank] = u + 1; return (sermonHash(bank) + u) % n; };
    const named = {};
    const final = order.map(x => {
      const idx = draw(x.bank, SERMON_BANK[x.bank].length); let move = "";
      const u = x.uids.find(id => moves[id] && !named[id] && (moves[id].startsWith("drops") || !x.victims.includes(id))); if (u) { named[u] = 1; move = ` ${esc(ownerName(u))} ${moves[u]}.`; }
      return { bank: x.bank, idx, args: x.args, tail: x.tail + move, keys: x.keys, uids: x.uids, cat: x.cat };
    });

    const F = esc(ownerName(lead.uids[0])), L = lead.uids[1] ? esc(ownerName(lead.uids[1])) : "";
    const hot = mem.streak && mem.streak.uid === lead.uids[0] && lead.keys.some(k => tail[k] && tail[k].includes("straight")) ? mem.streak.n : 0;
    const tk = hot ? "streak" : lead.keys.includes("high") && bonus.high >= 40 ? "record" : lead.key;
    const tb = SERMON_TITLE[tk], title = tb[draw("title-" + tk, tb.length)](F, L, hot);
    mem.streak = null;
    remember();
    const teams = {}; final.forEach(x => x.uids.forEach(u => { teams[u] = (teams[u] || 0) + 1; }));
    return { title, final, keys: final.flatMap(x => x.keys), teams, lead: lead.key, leadUid: lead.uids[0], format: draw("format", SERMON_FORMATS.length) };
  }

  function sermonBook() {
    const M = st.model; if (M.sermons) return M.sermons;
    const elo = {}; eloRatings(M).forEach(r => r.hist.forEach(x => { if (x.d != null && !x.carry) (elo[x.year + ":" + x.week] = elo[x.year + ":" + x.week] || []).push({ uid: r.uid, d: x.d }); }));
    const book = {}, mem = { hist: {}, used: {}, log: [], series: {}, elo, ix: pIdx(), commish: (Object.values(M.owners).find(o => o.handle === COMMISH) || {}).uid };
    M.seasons.slice().sort((p, q) => +p.year - +q.year).forEach(s => {
      book[s.year] = {}; mem.log = [];
      s.weeks.slice().sort((p, q) => p - q).forEach(w => { const plan = sermonWeek(s, w, mem); if (plan) { book[s.year][w] = plan; mem.log.push(plan); } });
    });
    M.sermons = book;
    return book;
  }

  // short: first names only, for the Home card that gets screenshotted
  function sermon(s, w, short) {
    const plan = (sermonBook()[s.year] || {})[w];
    if (!plan) return { title: "", lines: [] };
    const name = short ? uid => `<b>${esc(ownerName(uid))}</b>` : uid => T(uid, s), fmt = SERMON_FORMATS[plan.format];
    const lines = plan.final.map((x, i) => { const lab = fmt.label(SERMON_TONE[x.bank] || 0, i); return (lab ? `<span class="sl">${lab}</span>` : "") + SERMON_BANK[x.bank][x.idx](...x.args(name)) + x.tail; });
    return { title: plan.title, kicker: fmt.kicker, lines, benediction: sermonBenediction(s, w) };
  }

  // The closing line looks ahead, so only the newest sermon has one
  function sermonBenediction(s, w) {
    if (s !== st.model.latest || s.complete || w !== s.weeks[s.weeks.length - 1]) return "";
    const sd = stakesData(s), g = sd && sd.games[0]; if (!g) return "";
    const swing = c => (c && c.winPo != null && c.lossPo != null ? c.winPo - c.lossPo : -1);
    const u = swing(g.ca) >= swing(g.cb) ? g.a : g.b, c = u === g.a ? g.ca : g.cb, o = u === g.a ? g.b : g.a;
    if (swing(c) <= 0) return "";
    return `<b>${esc(ownerName(g.a))}</b> meets <b>${esc(ownerName(g.b))}</b> in Week ${sd.week}. A win puts ${esc(ownerName(u))} at <b class="num">${Math.round(c.winPo * 100)}%</b> to make the playoffs. A loss leaves him at <b class="num">${Math.round(c.lossPo * 100)}%</b>. ${SERMON_AMEN[w % SERMON_AMEN.length]}`;
  }

  /* ---------- Recap awards: always twelve tiles, so rows fill at 2, 3, and 4 columns ---------- */
  function recapTiles(s, w) {
    const a = {}; weekAwards(s, w).forEach(x => { a[x.key] = x; });
    const tws = s.teamWeeks.filter(t => t.week === w && t.result);
    const tile = (cls, t, v, n, d) => `<div class="award ${cls}"><span class="t">${esc(t)}</span><span class="v">${v}</span><span class="n">${n}</span><span class="d">${d}</span></div>`;
    const aw = k => { const x = a[k]; if (!x) return null; const vs = x.vs ? `<span class="d">over ${esc(teamIn(x.vs, s))}</span>` : ""; return `<div class="award ${x.key}"><span class="t">${esc(x.title)}</span><span class="v">${f2(x.value)}</span><span class="n">${esc(teamIn(x.uid, s))}</span><span class="d">${esc(x.note)}</span>${vs}</div>`; };
    const ix = pIdx(), ws = ix && ix.season === s ? prophWeekStars(ix, w) : null;
    const prophet = (k, t, x, note) => ws ? tile(k, t, sign(x.gap), pn(x.pid, s.pinfo(x.pid)[0]), `${esc(note)}. Projected ${f1(x.proj)}, scored ${f1(x.act)}, for ${esc(ownerName(x.uid))}.`) : null;
    const topAt = pos => { let b = null; tws.forEach(t => t.starters.forEach(x => { if (x.pid !== "0" && s.pinfo(x.pid)[1] === pos && (!b || x.pts > b.pts)) b = { ...x, uid: t.uid }; })); return b; };
    const playerTile = (t, b, note) => b ? tile("", t, f2(b.pts), esc(teamIn(b.uid, s)), `${esc(s.pinfo(b.pid)[0])}. ${esc(note)}`) : null;
    const eff = tws.map(t => ({ uid: t.uid, e: t.pts + (t.lost || 0) > 0 ? t.pts / (t.pts + (t.lost || 0)) : 0 })).sort((p, q) => q.e - p.e)[0];
    let bench = null; tws.forEach(t => { const on = new Set(t.starters.map(x => x.pid)); Object.entries(t.pp || {}).forEach(([pid, v]) => { if (!on.has(pid) && (!bench || v > bench.pts)) bench = { pid, pts: v, uid: t.uid }; }); });
    let climb = null; tws.forEach(t => { const was = s.teamWeeks.find(x => x.uid === t.uid && x.week === w - 1 && x.result); if (was && (!climb || t.pts - was.pts > climb.d)) climb = { uid: t.uid, d: t.pts - was.pts }; });
    return [aw("high"), aw("low"), aw("blowout"), aw("close"), aw("tough"), aw("lucky"), aw("player"), aw("upset"), aw("badbeat"), aw("regret"),
      ws && prophet("high", "Prophecy Fulfilled", ws.best, "Furthest over his projection"), ws && prophet("low", "False Prophet", ws.worst, "Furthest under his projection"),
      aw("asleep"), aw("bench"),
      eff && tile("high", "Good and Faithful", (eff.e * 100).toFixed(1) + "%", esc(teamIn(eff.uid, s)), "Closest to his best possible lineup"),
      playerTile("Armor of God", topAt("DEF"), "Top defense of the week"), playerTile("Best Foot Forward", topAt("K"), "Top kicker of the week"),
      playerTile("Still Small Voice", bench, "Top score left on any bench"),
      climb && tile("high", "Revival Meeting", "+" + f2(climb.d), esc(teamIn(climb.uid, s)), "Biggest jump from last week")].filter(Boolean).slice(0, 12);
  }

  /* ---------- Testimonies: outside player notes, latest week only ---------- */
  const NOTE_TAG = { call: ["New Calling", "t-up"], pew: ["Back Pew", "t-down"], manna: ["Manna", ""], fast: ["Fasting", ""] };
  const noteList = () => ((st.notes && st.notes.notes) || []);
  const noteTag = n => { const t = NOTE_TAG[n.tag]; return t ? `<span class="tag ${t[1]}">${esc(t[0])}</span>` : ""; };
  const noteSource = () => st.notes ? `Week ${esc(st.notes.week)}, per ${esc(st.notes.source)}.` : "";
  function testimonyTile(s) {
    const ros = s.currentRosters || {}, on = pid => Object.values(ros).some(r => r.includes(pid));
    const all = noteList().filter(n => on(n.pid)); if (!all.length) return "";
    const mine = st.me && ros[st.me] ? all.filter(n => ros[st.me].includes(n.pid)) : [];
    const pool = mine.length ? mine : all, k = (typeof DYK_SEED === "number" ? DYK_SEED : 0) + ((st.raw && st.raw.dykBump) || 0);
    const n = pool[k % pool.length];
    return `<div class="didyou"><span class="dk">${mine.length ? "A testimony from your roster" : "Testimony"}</span><span class="dt">${pn(n.pid, s.pinfo(n.pid)[0])}${noteTag(n)} ${esc(n.text)}</span><span class="fine">${noteSource()}</span></div>`;
  }

  /* ---------- Home: the 30-second front door ---------- */
  function home() {
    const s = st.model.latest;
    const w = s.weeks[s.weeks.length - 1];
    if (!w) return `<p class="empty">No scored weeks yet.</p>`;
    const preach = sermon(s, w, true), lines = preach.lines.slice(0, SERMON_HOME);
    let h = meBlock(s);
    h += `<section class="hero share"><div class="share-top"><span class="share-brand">Gambling Baptist</span><span class="share-wk">${esc(s.year)} · Week ${w}</span></div><p class="hero-k">${preach.kicker}</p><h2 class="hero-h st">${preach.title}</h2><ol class="sermon">${lines.map(l => `<li>${l}</li>`).join("")}</ol>${preach.benediction ? `<p class="sermon-ben"><span class="sl">Benediction</span>${preach.benediction}</p>` : ""}<p class="share-hint">Screenshot this card and post it in GroupMe.</p>${goBtn("week", "Tuesday Recap")}Read the full recap</button></section>`;
    const rec0 = recordOfWeek();
    if (rec0) h += `<div class="didyou"><span class="dk">Did you know</span><span class="dt">${rec0}</span></div>`;
    h += testimonyTile(s);
    { const sd = !s.complete ? stakesData(s) : null; if (sd && sd.games.length) { h += `<section class="gotw"><h3>The Big Revival · Week ${sd.week}'s game of the week</h3><p class="muted sm">The matchup that moves the playoff odds most.</p>${stakeCard(sd.games[0], sd.pp, true)}<button type="button" class="go-btn" data-go="standings" data-sec="What's at Stake">Every game's stakes</button></section>`; } }

    // Trophy race and lid watch
    if (!s.complete && s.regWeeks.length) {
      const pp = ppOf(s);
      let pr = powerRankings(s);
      if (pp.odds) pr = pr.slice().sort((a, b) => pp.odds[b.uid].po - pp.odds[a.uid].po || b.score - a.score);
      const row = (r, i) => `<div class="row"><div><span class="rank">${i}</span>${whoInline(r.uid, s)}</div><div class="r">${rec(r)}<small>${pp.odds ? "playoff odds " + pct(pp.odds[r.uid].po, pp.status[r.uid]) : "power " + f1(r.score)}</small></div></div>`;
      h += `<div class="cols two">`;
      h += `<div><h3>Trophy race</h3><div class="list">${pr.slice(0, 3).map((r, i) => row(r, i + 1)).join("")}</div></div>`;
      h += `<div><h3>Lid watch</h3><div class="list">${pr.slice(-3).map((r, i) => row(r, pr.length - 2 + i)).join("")}</div></div></div>`;
      h += `<p class="fine">${pp.odds ? "Ranked by playoff odds from the Playoff Picture on the Bulletin." : "Ranked by the Pulpit Power Rankings on the Bulletin."}</p>`;
    }

    // Only here
    h += sec("The stuff Sleeper won't tell you", "Three seasons of league data, run through the numbers. Tap any card to dig in.");
    // Cards sort into "This season" and "All time" by title
    const SEASON_TILES = new Set(["Schedule help", "Walk a Mile in His Schedule", "Coaching %", "Spiritual gifts", "Trade chart", "Prophecy check", "The laborers"]);
    const bucket = { season: [], all: [] };
    const tile = (view, section, title, fact, extra) => { bucket[SEASON_TILES.has(title) ? "season" : "all"].push(`${goBtn(view, section, extra)}<span class="tt">${title}</span><span class="tf">${fact}</span><span class="tc" aria-hidden="true">›</span></button>`); return ""; };
    const byLuck = s.standings.slice().sort((a, b) => b.luck - a.luck);
    if (byLuck.length > 1) h += tile("standings", "Everyone Plays Everyone", "Schedule help", `${esc(ownerName(byLuck[0].uid))}'s schedule has handed him ${sign(byLuck[0].luck)} wins his points did not earn. ${esc(ownerName(byLuck[byLuck.length - 1].uid))}'s has cost him ${f1(Math.abs(byLuck[byLuck.length - 1].luck))}.`);
    let swing = null;
    if (s.regWeeks.length) s.uids.forEach(u => { const sw = scheduleSwap(s, u); const own = sw.find(x => x.own); const best = sw.filter(x => !x.own)[0]; if (own && best && (!swing || best.w - own.w > swing.d)) swing = { u, own, best, d: best.w - own.w }; });
    if (swing && swing.d > 0) h += tile("rivals", "Walk a Mile in His Schedule", "Walk a Mile in His Schedule", `${esc(ownerName(swing.u))} is ${rec(swing.own)}. With ${esc(ownerName(swing.best.uid))}'s schedule he would be ${rec(swing.best)}.`, ` data-who="${esc(swing.u)}"`);
    const led = tradeLedger(st.model);
    if (led.length > 1) { const ringer = led.slice().sort((a, b) => b.rings - a.rings)[0]; const tail = ringer && ringer.rings ? ` ${esc(ownerName(ringer.uid))} is ${signInt(ringer.net)} on raw points, but ${ringer.rings} of his trades brought in players who started in his ${esc(ringer.ringYears.join(", "))} title run.` : ` ${esc(ownerName(led[led.length - 1].uid))} is ${signInt(led[led.length - 1].net)}.`; h += tile("trades", "The Business Meeting", "The trade ledger", `${esc(ownerName(led[0].uid))} leads at ${signInt(led[0].net)} points, all time.${tail}`); }
    if (s.regWeeks.length >= 2) { const rc = reportCard(st.model, s).rows.slice().sort((a, b) => b.eff - a.eff); h += tile("standings", "Report Card", "Coaching %", `${esc(ownerName(rc[0].uid))} started ${(rc[0].eff * 100).toFixed(1)}% of his best possible lineup this year. ${esc(ownerName(rc[rc.length - 1].uid))} is at ${(rc[rc.length - 1].eff * 100).toFixed(1)}%.`); }
    const commishUid = (Object.values(st.model.owners).find(o => o.handle === COMMISH) || {}).uid;
    const pairs = rivalryPairs(st.model, false).filter(p => p.n >= 3 && p.a !== commishUid && p.b !== commishUid).sort((a, b) => (b.diff / b.n) - (a.diff / a.n) || b.n - a.n);
    if (pairs.length) { const p = pairs[0]; const lead = p.aw >= p.bw ? p.a : p.b, trail = lead === p.a ? p.b : p.a; const r = pairRecord(pairs, lead, trail); h += tile("rivals", "The Feud Board", "The Feud Board", `${esc(ownerName(lead))} owns ${esc(ownerName(trail))}, ${rec(r)} all time. Every current member's rivalries on one board.`); }
    { const Wp = wireStats(st.model, "pickups", null).rows.filter(r => r.n >= 15); if (Wp.length >= 2) { const early = Wp.slice().sort((a, b) => a.med - b.med)[0]; const owl = Wp.filter(r => (r.blocks.night || 0) >= 5).sort((a, b) => b.share("night") - a.share("night"))[0]; const em = (Math.round(early.med) + 240) % 1440; h += tile("moves", "When the Flock Moves", "When the flock moves", `${esc(ownerName(early.uid))}'s median pickup lands at ${Math.floor(em / 60) % 12 || 12}:${String(em % 60).padStart(2, "0")} ${em < 720 ? "a.m." : "p.m."} ${owl ? `${esc(ownerName(owl.uid))} makes ${Math.round(owl.share("night") * 100)}% of his after 11 p.m.` : ""}`); } }
    { const el = eloRatings(st.model).filter(r => !(st.model.owners[r.uid] || {}).orphan && st.model.owners[r.uid].active); if (el.length > 1) { const pk = el.slice().sort((a, b) => b.peak.elo - a.peak.elo)[0]; h += tile("history", "Elo Ratings", "Elo ratings", `${esc(ownerName(el[0].uid))} is the best team in the league by Elo, at ${Math.round(el[0].elo)}. ${pk.uid !== el[0].uid ? `${esc(ownerName(pk.uid))} holds the all-time peak, ${Math.round(pk.peak.elo)}.` : "He also holds the all-time peak."}`); } }
    { const bbs = badBeats(st.model); if (bbs.length) { const b0 = bbs[0]; h += tile("history", "The Book of Numbers", "Bad beats", `${esc(ownerName(b0.uid))} scored ${f1(b0.pts)} in ${esc(b0.year)} week ${b0.week}, beat ${b0.beat} of ${b0.of} teams, and lost to ${esc(ownerName(b0.opp))}.`); } }
    if (st.me) { const gd = giftsData(st.model.latest); const d = gd.data; if (d && d.rank[st.me]) { const r = d.rank[st.me], ks = G_CORE.slice().sort((x, y) => r[x] - r[y]); h += tile("gifts", "Spiritual Gifts", "Spiritual gifts", `Your strongest group ${d.mode === "current" ? "this week" : "lately"}: ${ks[0]}, ${ordinal(r[ks[0]])} in the league. Thinnest: ${ks[ks.length - 1]}, ${ordinal(r[ks[ks.length - 1]])}.`); } }
    if (st.tv) { const top = st.tv.cons.list[0]; const fa = st.tv.cons.list.find(e => !(e.pid && st.tv.owner[e.pid])); h += tile("chart", "Trade Chart", "Trade chart", `${Object.keys(st.tv.week.sources).length} expert sources blended into one value. ${esc(top.name)} sits atop The Pulpit at ${f1(top.value)}.${fa ? ` Best free agent: ${esc(fa.name)} (${f1(fa.value)}).` : ""}`); }
    { const W = s === st.model.latest ? wkOf() : null; if (W) { const top = Object.values(W.players).filter(p => p.g >= 3 && p.pos !== "QB").sort((a, b) => b.wpg - a.wpg)[0]; if (top) h += tile("work", "The Laborers", "The laborers", `${esc(s.pinfo(top.pid)[0] || top.pid)} gets the most work of any back or receiver: ${f1(top.wpg)} Workload points a game. Target trees, backfield splits, and who turns work into points.`); } }
    { const pr = prophecy(s, st.model.projections); const tl = pr ? Object.values(pr.teams).filter(t => t.n) : []; if (tl.length > 1) { tl.sort((a, b) => b.perWeek - a.perWeek); const lo = tl[tl.length - 1]; h += tile("prophets", "Prophecy Check", "Prophecy check", `${esc(ownerName(tl[0].uid))}'s starters ${tl[0].perWeek >= 0 ? `beat Sleeper's projections by ${f1(tl[0].perWeek)} a week, the most in the league` : `came closest to Sleeper's projections, ${f1(Math.abs(tl[0].perWeek))} a week under`}. ${esc(ownerName(lo.uid))}'s are ${lo.perWeek >= 0 ? "up" : "down"} ${f1(Math.abs(lo.perWeek))}.`); } }
    const lids = st.model.seasons.filter(x => x.lid);
    if (lids.length) h += tile("history", "Church History", "The lid ledger", lids.map(x => `${esc(ownerName(x.lid))} ${esc(x.year)}`).join(", ") + ". The toilet bowl lid remembers.");
    if (bucket.season.length) h += `<h3 class="tiles-h">This season</h3><div class="tiles">${bucket.season.join("")}</div>`;
    if (bucket.all.length) h += `<h3 class="tiles-h">All time</h3><div class="tiles">${bucket.all.join("")}</div>`;
    return h + refreshPanel();
  }

  /* ---------- Personal card ---------- */
  function meBlock(s) {
    if (!st.me || !st.model.owners[st.me] || !s.uids.includes(st.me)) {
      return `<section class="me-pick"><b>Who are you?</b><span class="muted sm">Pick your name and this page opens on your team. It is remembered on this phone only.</span><div class="chips wrap">${activeOwners().map(o => `<button data-me="${esc(o.uid)}">${esc(o.name)}</button>`).join("")}</div></section>`;
    }
    const uid = st.me, row = s.standings.find(r => r.uid === uid);
    const pr = s.regWeeks.length ? powerRankings(s) : [];
    const pRank = pr.findIndex(r => r.uid === uid) + 1;
    const last = s.teamWeeks.filter(t => t.uid === uid && t.result).sort((a, b) => b.week - a.week)[0];
    const pairs = rivalryPairs(st.model, false);
    const h2h = headToHead(st.model, uid, null, true).filter(r => r.games >= 3);
    const nem = h2h.slice().sort((a, b) => ((a.w + a.t / 2) / a.games) - ((b.w + b.t / 2) / b.games) || b.games - a.games)[0];
    let out = `<section class="me-card"><div class="me-top"><span class="me-hi">${esc(ownerName(uid))}, here is your week</span><button class="linkish" data-me="">Not you?</button></div><div class="me-grid">`;
    out += `<div><span class="mk">Record</span><span class="mv num">${row ? rec(row) : ""}</span><span class="md">${row ? ordinal(row.rank) + " in the standings" : ""}</span></div>`;
    if (pRank) out += `<div><span class="mk">Power rank</span><span class="mv num">${ordinal(pRank)}</span><span class="md">of ${pr.length}</span></div>`;
    if (row) out += `<div><span class="mk">Schedule help</span><span class="mv num">${sign(row.luck)}</span><span class="md">${row.luck > 0.5 ? "wins handed to you" : row.luck < -0.5 ? "wins taken from you" : "an honest record"}</span></div>`;
    if (last) out += `<div><span class="mk">Week ${last.week}</span><span class="mv num ${last.result === "W" ? "w" : last.result === "L" ? "l" : ""}">${last.result} ${f1(last.pts)}</span><span class="md">vs ${esc(ownerName(last.opp))}, ${f1(last.oppPts)}</span></div>`;
    out += `</div>`;
    { const sd = !s.complete ? stakesData(s) : null; const g = sd && sd.games.find(x => x.a === uid || x.b === uid);
      if (g) { const line = stakeSentence(uid, uid === g.a ? g.ca : g.cb, sd.pp); out += `<p class="me-line me-stake"><b>Week ${sd.week} vs ${esc(ownerName(uid === g.a ? g.b : g.a))}.</b> ${esc(line)} ${seriesLine(g, uid)}</p>`; } }
    if (nem && nem.w < nem.l) out += `<p class="me-line">Your nemesis: <b>${esc(ownerName(nem.uid))}</b> owns you ${nem.w}-${nem.l}${nem.t ? "-" + nem.t : ""}.</p>`;
    if (st.tv) { const n = tvIdeas(uid).length; out += `<div class="me-ideas">${goBtn("advisor", "Trade Ideas")}${n ? `${n} trade ${n === 1 ? "idea" : "ideas"} for you this week` : "Open the Trade Advisor"}</button></div>`; }
    out += `</section>`;
    return out;
  }

  /* ---------- Did you know ---------- */
  // "Did you know" rotates on every publish: build.py --publish bumps DYK_SEED, so each refresh shows a different fact.
  function recordOfWeek() {
    const at = allTime(st.model, false);
    const facts = [];
    const pn = pid => (st.model.players && st.model.players[pid] ? st.model.players[pid][0] : "a bench player");
    const gameFact = (g, lead) => { const wn = g.a.pts >= g.b.pts ? g.a : g.b, ls = wn === g.a ? g.b : g.a; return `${lead}: ${esc(ownerName(wn.uid))} beat ${esc(ownerName(ls.uid))} by <b>${f2(g.margin)}</b> in ${esc(g.year)} week ${g.week}.`; };
    const top = at.top[0]; if (top) facts.push(`The highest score in league history is <b>${f2(top.pts)}</b>, by ${esc(ownerName(top.uid))} in ${esc(top.year)} week ${top.week}.`);
    const lo = at.bottom[0]; if (lo) facts.push(`The lowest score in league history is <b>${f2(lo.pts)}</b>, by ${esc(ownerName(lo.uid))} in ${esc(lo.year)} week ${lo.week}.`);
    if (at.blow[0]) facts.push(gameFact(at.blow[0], "The biggest blowout ever"));
    if (at.close[0]) facts.push(gameFact(at.close[0], "The closest game ever"));
    if (at.close[1]) facts.push(gameFact(at.close[1], "The second-closest game ever"));
    const ap = allPlay(st.model); if (ap.length) facts.push(`Best all-play record in league history: ${esc(ownerName(ap[0].uid))}, <b>${ap[0].allW}-${ap[0].allL}</b> against every team every week.`);
    const strk = st.model.seasons.map(s => { const r = seasonRecords(s, false).streak; return r ? { ...r, year: s.year } : null; }).filter(Boolean);
    const sMax = Math.max(0, ...strk.map(r => r.n)), sTop = strk.filter(r => r.n === sMax);
    if (sTop.length) facts.push(`Longest winning streak on record: <b>${sMax} straight</b>, by ${sTop.map(r => `${esc(ownerName(r.uid))} in ${esc(r.year)}`).join(" and ")}.`);
    const rg = regretList(st.model)[0]; if (rg) facts.push(`Worst benching on record: ${esc(ownerName(rg.uid))} sat ${esc(pn(rg.bench))} (${f1(rg.bPts)}) and started ${esc(pn(rg.starter))} (${f1(rg.sPts)}) in ${esc(rg.year)} week ${rg.week}. That is <b>${f1(rg.diff)} points</b> left on the pew.`);
    { const L0 = st.model.latest, prx = prOf(L0); const tl = prx ? Object.values(prx.teams).filter(t => t.n) : [];
      if (tl.length > 1) { const hi = tl.slice().sort((a, b) => b.over - a.over || b.perWeek - a.perWeek)[0]; facts.push(`${esc(ownerName(hi.uid))}'s starters have beaten Sleeper's projection in <b>${hi.over} of ${hi.n} weeks</b> this season, the most in the league.`); }
      const ix = pIdx(); if (ix) { let top = null; ix.weeks.forEach(w => { const x = prophWeekStars(ix, w); if (x && (!top || x.best.gap > top.gap)) top = { ...x.best, week: w }; }); if (top) facts.push(`Biggest beat of a projection this season: ${esc(L0.pinfo(top.pid)[0])}, <b>${sign(top.gap)}</b> in week ${top.week} for ${esc(ownerName(top.uid))}. Projected ${f1(top.proj)}, scored ${f1(top.act)}.`); } }
    const ps = prodigalSons(st.model)[0]; if (ps) facts.push(`The one that got away: ${esc(ownerName(ps.dropper))} dropped ${esc(ps.name)} in ${esc(ps.year)} week ${ps.week}. He scored <b>${f1(ps.pts)}</b> for other teams after that.`);
    const cg = closeGames(st.model).filter(r => r.n >= 4 && st.model.owners[r.uid] && st.model.owners[r.uid].active); if (cg.length > 1) { const b = cg[0], wst = cg[cg.length - 1]; facts.push(`Ice in his veins: ${esc(ownerName(b.uid))} is <b>${b.w}-${b.l}${b.t ? "-" + b.t : ""}</b> in games decided by under 10 points. ${esc(ownerName(wst.uid))} is ${wst.w}-${wst.l}${wst.t ? "-" + wst.t : ""}.`); }
    const rp = rivalryPairs(st.model, false); if (rp.length) { const m = rp.slice().sort((a, b) => b.n - a.n)[0]; facts.push(`The most-played rivalry is ${esc(ownerName(m.a))} vs ${esc(ownerName(m.b))}: <b>${m.n} meetings</b>, ${m.aw}-${m.bw}${m.t ? "-" + m.t : ""}.`); }
    const tl = tradeLedger(st.model); if (tl.length) { const busy = tl.slice().sort((a, b) => b.trades - a.trades)[0], best = tl.slice().sort((a, b) => b.net - a.net)[0]; facts.push(`${esc(ownerName(busy.uid))} has made <b>${busy.trades} trades</b>, the most in the league.`); if (best.net > 0) facts.push(`Best trade balance in league history: ${esc(ownerName(best.uid))}, <b>+${f1(best.net)}</b> starting points from trades.`); }
    const wr = wireStats(st.model); if (wr && wr.rows && wr.rows.length) { const mv = wr.rows.slice().sort((a, b) => b.n - a.n)[0]; facts.push(`Most waiver wire moves on record: ${esc(ownerName(mv.uid))}, with <b>${mv.n}</b>.`); }
    const champs = {}; (at.champs || []).forEach(c => { const u = c.champion; if (!u || !c.complete) return; champs[u] = (champs[u] || 0) + 1; }); const cc = Object.entries(champs).sort((a, b) => b[1] - a[1]); if (cc.length && cc[0][1] > 1) facts.push(`${esc(ownerName(cc[0][0]))} has <b>${cc[0][1]} titles</b>, the most in the league.`);
    if (!facts.length) return "";
    const n = (typeof DYK_SEED === "number" ? DYK_SEED : 0) + ((st.raw && st.raw.dykBump) || 0);
    return facts[((n % facts.length) + facts.length) % facts.length];
  }

  /* ---------- Charts: hand-built SVG, one data series plus a labeled reference ---------- */
  function scatterChart(rows, sc) {
    if (!rows.length) return "";
    const W = 340, H = 260, L = 34, B = 34, T = 12, Rr = 12;
    const maxV = Math.max(1, ...rows.map(r => Math.max(r.expW, r.w + r.t / 2)));
    const top = Math.ceil(maxV);
    const x = v => L + (v / top) * (W - L - Rr), y = v => H - B - (v / top) * (H - B - T);
    const step = top > 20 ? 5 : top > 8 ? 2 : 1;
    let g = "";
    for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text><text class="tick" x="${x(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`;
    g += `<line class="ref" x1="${x(0)}" y1="${y(0)}" x2="${x(top)}" y2="${y(top)}"/>`;
    g += `<text class="zone" x="${L + 8}" y="${T + 14}">Schedule helped</text><text class="zone" x="${W - Rr - 4}" y="${H - B - 8}" text-anchor="end">Schedule hurt</text>`;
    const sorted = rows.slice().sort((a, b) => b.luck - a.luck);
    const labelIds = new Set([sorted[0].uid, sorted[sorted.length - 1].uid, st.me]);
    rows.forEach(r => {
      const act = r.w + r.t / 2, cx = x(r.expW), cy = y(act), me = r.uid === st.me;
      const tip = `${ownerName(r.uid)}: ${rec(r)} actual, ${f1(r.expW)} expected wins, schedule help ${sign(r.luck)}`;
      g += `<g class="pt${me ? " me" : ""}" data-tip="${esc(tip)}" tabindex="0"><circle class="hit" cx="${cx}" cy="${cy}" r="14"/><circle class="dot" cx="${cx}" cy="${cy}" r="${me ? 7 : 5}"/></g>`;
      if (labelIds.has(r.uid)) g += `<text class="dlabel" x="${cx + (cx > W - 90 ? -10 : 10)}" y="${cy - 8}" text-anchor="${cx > W - 90 ? "end" : "start"}">${esc(ownerName(r.uid))}</text>`;
    });
    g += `<text class="axis" x="${(L + W - Rr) / 2}" y="${H - 4}" text-anchor="middle">Expected wins from points</text><text class="axis" transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Actual wins</text>`;
    return `<figure class="chart"><figcaption><b>Points vs. record</b><span class="muted sm">${sc ? esc(sc.year) : "All seasons"}. Dots above the line won more than their points earned. Tap a dot for details.</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of expected wins against actual wins for each member">${g}</svg></figure>`;
  }

  function lineChart(uid) {
    const o = st.model.owners[uid];
    const sel = st.model.seasons.find(x => x.year === st.year && x.uids.includes(uid)) || st.model.seasons.slice().reverse().find(x => x.uids.includes(uid));
    if (!sel) return "";
    const weeks = sel.weeks.filter(w => sel.teamWeeks.some(t => t.uid === uid && t.week === w && t.result));
    if (weeks.length < 2) return "";
    const mine = weeks.map(w => sel.teamWeeks.find(t => t.uid === uid && t.week === w).pts);
    const avg = weeks.map(w => { const all = sel.teamWeeks.filter(t => t.week === w && t.result); return all.reduce((a, t) => a + t.pts, 0) / all.length; });
    const W = 340, H = 220, L = 34, B = 30, T = 14, Rr = 52;
    const lo = Math.floor(Math.min(...mine, ...avg) / 20) * 20, hi = Math.ceil(Math.max(...mine, ...avg) / 20) * 20;
    const x = i => L + (weeks.length === 1 ? 0 : i / (weeks.length - 1)) * (W - L - Rr), y = v => H - B - ((v - lo) / (hi - lo || 1)) * (H - B - T);
    let g = "";
    for (let v = lo; v <= hi; v += 20) g += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    weeks.forEach((w, i) => { if (weeks.length <= 10 || i % 2 === 0) g += `<text class="tick" x="${x(i)}" y="${H - B + 16}" text-anchor="middle">${w}</text>`; });
    const path = arr => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    g += `<path class="refline" d="${path(avg)}"/><path class="line" d="${path(mine)}"/>`;
    mine.forEach((v, i) => { const t = sel.teamWeeks.find(tt => tt.uid === uid && tt.week === weeks[i]); g += `<g class="pt" data-tip="${esc(`Week ${weeks[i]}: ${f2(v)} (${t.result} vs ${ownerName(t.opp)}). League average ${f1(avg[i])}`)}" tabindex="0"><circle class="hit" cx="${x(i)}" cy="${y(v)}" r="12"/><circle class="dot ${t.result === "W" ? "won" : "lost"}" cx="${x(i)}" cy="${y(v)}" r="4.5"/></g>`; });
    g += `<text class="dlabel" x="${x(weeks.length - 1) + 8}" y="${y(mine[mine.length - 1]) + 4}">${esc(o.name)}</text><text class="dlabel ref" x="${x(weeks.length - 1) + 8}" y="${y(avg[avg.length - 1]) + (Math.abs(y(avg[avg.length - 1]) - y(mine[mine.length - 1])) < 14 ? 16 : 4)}">League avg</text>`;
    g += `<text class="axis" x="${(L + W - Rr) / 2}" y="${H - 2}" text-anchor="middle">Week</text>`;
    return `<figure class="chart"><figcaption><b>${esc(o.name)}'s weekly scores</b><span class="muted sm">${esc(sel.year)}. Filled dots are wins, open dots are losses. Tap a dot for details.</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.name)} weekly scores against the league average">${g}</svg></figure>`;
  }

  /* ---------- Bulletin ---------- */
  function standings() {
    const s = season();
    let h = "";
    if (s.champion || s.lid) h += `<div class="hardware">`;
    if (s.champion) h += `<div class="champ"><div class="glyph" aria-hidden="true"></div><div><div class="lbl">${esc(s.year)} champion</div><b>${esc(teamIn(s.champion, s))}</b><div class="muted">${esc(ownerName(s.champion))} beat ${esc(teamIn(s.runnerUp, s))} in the final</div></div></div>`;
    if (s.lid) h += `<div class="champ lid"><div class="glyph" aria-hidden="true"></div><div><div class="lbl">${esc(s.year)} toilet bowl</div><b>${esc(teamIn(s.lid, s))}</b><div class="muted">${esc(ownerName(s.lid))} took home the lid</div></div></div>`;
    if (s.champion || s.lid) h += `</div>`;
    const done = s.regWeeks.length;
    const showFinal = s.finalTable && st.standView === "final";
    h += sec("The Bulletin", !s.complete ? `Standings after week ${done}` : showFinal ? "Final standings after the playoffs" : "Final regular season standings");
    if (s.finalTable) h += `<div class="chips" role="group" aria-label="Standings view"><button data-view="final" aria-pressed="${showFinal}">After playoffs</button><button data-view="regular" aria-pressed="${!showFinal}">Regular season</button></div>`;
    const altar = (cols, text, cls) => `<tr class="altar${cls ? " " + cls : ""}"><td colspan="${cols}"><span>${text}</span></td></tr>`;
    if (showFinal) {
      h += `<div class="scroll"><table class="data" data-hide="1,4"><thead><tr><th>Team</th><th>Seed</th><th>Regular</th><th>Postseason</th><th>PF</th><th class="l-al">Result</th></tr></thead><tbody>`;
      s.finalTable.forEach(r => {
        const cls = ["Champion", "Runner-up", "Third place"].includes(r.label) ? "tag gold" : r.label === "Toilet bowl lid" ? "tag lid" : "tag";
        h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${r.finish}</span>${whoInline(r.uid, s)}</td><td>${r.seed}</td><td>${rec(r)}</td><td>${r.pw}-${r.pl}${r.pt ? "-" + r.pt : ""}</td><td>${f2(r.pf + r.postPts)}</td><td class="l-al"><span class="${cls} flush">${esc(r.label)}</span></td></tr>`;
        if (r.finish === s.playoffTeams) h += altar(6, "Playoff teams above, toilet bowl below");
        if (s.lid && r.finish === s.finalTable.length - 2) h += altar(6, "The lid game", "lid");
      });
      h += `</tbody></table></div><p class="fine">Places come from the playoff and toilet bowl brackets. In the toilet bowl the lower score advances, so the team that loses its way to the bottom finishes last and takes the lid. PF here includes postseason games.</p>`;
    } else {
      const hh = !s.complete ? hotHand(s) : {};
      const showForm = Object.keys(hh).length > 0;
      h += `<div class="scroll"><table class="data" data-hide="${showForm ? "3,4,5,6" : "3,4,5"}"><thead><tr><th>Team</th><th>Record</th>${showForm ? "<th>Form</th>" : ""}<th>PF</th><th>PA</th><th>Streak</th><th>All-play</th><th>Sched help</th></tr></thead><tbody>`;
      s.standings.forEach(r => {
        const champ = r.uid === s.champion ? '<span class="tag gold">Champion</span>' : "";
        const fm = hh[r.uid]; const fcell = !showForm ? "" : !fm ? "<td></td>" : `<td class="${fm.delta >= 10 ? "w" : fm.delta <= -10 ? "l" : ""}" title="Last 3 weeks ${f1(fm.recent)} vs season ${f1(fm.avg)}">${fm.delta >= 10 ? "▲ " : fm.delta <= -10 ? "▼ " : ""}${sign(fm.delta)}</td>`;
        h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${r.rank}</span>${whoInline(r.uid, s)}${champ}</td><td>${rec(r)}</td>${fcell}<td>${f2(r.pf)}</td><td>${f2(r.pa)}</td><td class="${r.streak[0] === "W" ? "w" : r.streak[0] === "L" ? "l" : ""}">${esc(r.streak)}</td><td>${r.allW}-${r.allL}${r.allT ? "-" + r.allT : ""}</td><td class="${r.luck > 0.5 ? "w" : r.luck < -0.5 ? "l" : ""}">${sign(r.luck)}</td></tr>`;
        if (r.rank === s.playoffTeams) h += altar(showForm ? 8 : 7, `Altar call: the top ${s.playoffTeams} come forward to the playoffs`);
      });
      h += `</tbody></table></div><p class="fine">${showForm ? "Form is a team's average over the last three weeks minus its season average. An arrow marks a swing of 10 points or more. " : ""}Sched help is real wins minus the wins your scores would earn against an average schedule. It is explained under Everyone Plays Everyone below.</p>`;
    }
    if (!s.complete && s.regWeeks.length) h += pictureBlock(s);
    if (!s.complete && s.regWeeks.length) h += stakesBlock(s);
    if (!s.complete && s.regWeeks.length) h += powerBlock(s);
    h += allPlayBlock(s);
    h += reportBlock(s);
    const recs = seasonRecords(s, st.withPO);
    h += sec("Mountaintops and Valleys", `${esc(s.year)} ${st.withPO ? "regular season and postseason" : "regular season"}`) + (s.playoffUids.size ? poChips() : "");
    h += `<div class="cols"><div><h3>Mountaintop weeks</h3><div class="list">`;
    recs.top.forEach(t => { h += `<div class="row"><div>${whoInline(t.uid, s)}${gameTag(t.game)}</div><div class="r">${f2(t.pts)}<small>Week ${t.week}</small></div></div>`; });
    h += `</div></div><div><h3>Valley weeks</h3><div class="list">`;
    recs.bottom.forEach(t => { h += `<div class="row"><div>${whoInline(t.uid, s)}${gameTag(t.game)}</div><div class="r">${f2(t.pts)}<small>Week ${t.week}</small></div></div>`; });
    h += `</div></div></div>`;
    if (recs.streak) h += `<h3>Longest revival</h3><div class="row"><div>${whoInline(recs.streak.uid, s)}</div><div class="r">${recs.streak.n} straight wins</div></div>`;
    return h;
  }

  /* ---------- What's at Stake: next week's games, from things Sleeper does not show ---------- */
  const ppOf = s => (st.ppCache[s.year] = st.ppCache[s.year] || playoffPicture(s));
  function stakesData(s) {
    if (st.stakeCache[s.year] !== undefined) return st.stakeCache[s.year];
    const pp = ppOf(s);
    if (!pp.stakes || !pp.stakes.games.length) return (st.stakeCache[s.year] = null);
    const pairs = rivalryPairs(st.model, true);
    const elo = {}; eloRatings(st.model).forEach(r => { elo[r.uid] = r.elo; });
    if (st.tv && s === st.model.latest) giftsData(s);
    const gw = st.gCache[s.year + ":cur"] || null;
    const games = pp.stakes.games.map(g => {
      const ca = pp.stakes.cond[g.a], cb = pp.stakes.cond[g.b];
      const swing = c => (c && c.winPo != null && c.lossPo != null ? c.winPo - c.lossPo : 0);
      const ser = pairRecord(pairs, g.a, g.b);
      const ea = elo[g.a], eb = elo[g.b];
      const pA = ea != null && eb != null ? 1 / (1 + Math.pow(10, (eb - ea) / 400)) : null;
      let edge = null;
      if (gw && gw.rank[g.a] && gw.rank[g.b]) {
        const adv = (x, y) => G_CORE.map(k => ({ k, d: gw.rank[y][k] - gw.rank[x][k], rx: gw.rank[x][k], ry: gw.rank[y][k] })).filter(e => e.d > 0).sort((p, q) => q.d - p.d)[0] || null;
        edge = { a: adv(g.a, g.b), b: adv(g.b, g.a) };
      }
      return { a: g.a, b: g.b, ca, cb, swing: swing(ca) + swing(cb), ser, pA, edge };
    });
    games.sort((x, y) => y.swing - x.swing);
    return (st.stakeCache[s.year] = { week: pp.stakes.week, games, pp });
  }
  const sPct = (v, stt) => (v == null ? "n/a" : pct(v, stt === "alive" ? "alive" : null));
  function seriesLine(g, me) {
    const other = me === g.a ? g.b : g.a, r = me === g.a ? g.ser : g.ser && { w: g.ser.l, l: g.ser.w, t: g.ser.t, n: g.ser.n };
    if (!r || !r.n) return `First meeting with ${esc(ownerName(other))}.`;
    const t = r.t ? "-" + r.t : "";
    return r.w > r.l ? `You lead ${esc(ownerName(other))} ${r.w}-${r.l}${t} all time.` : r.w < r.l ? `${esc(ownerName(other))} leads the series ${r.l}-${r.w}${t}.` : `The series is even, ${r.w}-${r.l}${t}.`;
  }
  function stakeSentence(u, c, pp) {
    const stt = pp.status[u];
    if (stt === "clinched") return "Playoff spot locked. This one is for seeding and pride.";
    if (stt === "eliminated") return c && c.winLast != null && (c.winLast > 0.005 || c.lossLast > 0.005) ? `Win and last-place odds fall to ${sPct(c.winLast)}. Lose and they climb to ${sPct(c.lossLast)}.` : "Out of the playoff race. Play spoiler.";
    if (!c || c.winPo == null || c.lossPo == null) return "";
    return `Win: playoff odds ${sPct(c.winPo, "alive")}. Lose: ${sPct(c.lossPo, "alive")}.${c.lossLast != null && c.lossLast >= 0.05 ? ` A loss puts last-place odds at ${sPct(c.lossLast)}.` : ""}`;
  }
  function stakeHTML(u, c, pp) {
    if (pp.status[u] !== "alive" || !c || c.winPo == null || c.lossPo == null) return esc(stakeSentence(u, c, pp));
    return `Playoff odds: <b>${esc(sPct(c.winPo, "alive"))}</b> with a win, <b>${esc(sPct(c.lossPo, "alive"))}</b> with a loss.${c.lossLast != null && c.lossLast >= 0.05 ? ` A loss puts last-place odds at ${esc(sPct(c.lossLast))}.` : ""}`;
  }
  function edgeLine(g) {
    if (!g.edge) return "";
    const one = (u, e, o) => (e ? `${esc(ownerName(u))}'s ${e.k}s rank ${ordinal(e.rx)}, ${esc(ownerName(o))}'s ${ordinal(e.ry)}` : "");
    const parts = [one(g.a, g.edge.a, g.b), one(g.b, g.edge.b, g.a)].filter(Boolean);
    return parts.length ? parts.join(". ") + "." : "";
  }
  function stakeCard(g, pp, big) {
    const fav = g.pA == null ? "" : g.pA >= 0.5 ? `Elo leans ${esc(ownerName(g.a))}, ${Math.round(g.pA * 100)}%` : `Elo leans ${esc(ownerName(g.b))}, ${Math.round((1 - g.pA) * 100)}%`;
    const ser = !g.ser || !g.ser.n ? "First meeting" : g.ser.w === g.ser.l ? `Series even ${g.ser.w}-${g.ser.l}${g.ser.t ? "-" + g.ser.t : ""}` : `${esc(ownerName(g.ser.w > g.ser.l ? g.a : g.b))} leads the series ${Math.max(g.ser.w, g.ser.l)}-${Math.min(g.ser.w, g.ser.l)}${g.ser.t ? "-" + g.ser.t : ""}`;
    const side = u => `<div class="stk-side${u === st.me ? " me" : ""}"><div class="stk-who">${whoInline(u, st.model.latest)}</div><div class="stk-odds">${stakeHTML(u, u === g.a ? g.ca : g.cb, pp)}</div></div>`;
    const el = edgeLine(g);
    return `<div class="stk${big ? " big" : ""}">${side(g.a)}<div class="stk-vs" aria-hidden="true">vs</div>${side(g.b)}<p class="stk-meta">${[ser, fav].filter(Boolean).join(" · ")}${el ? `<br>${el}` : ""}</p></div>`;
  }
  function stakesBlock(s) {
    const sd = stakesData(s); if (!sd) return "";
    let h = sec("What's at Stake", `Week ${sd.week}, game by game. "Let us run with endurance the race that is set before us." Hebrews 12:1. The biggest swing in playoff odds comes first.`);
    sd.games.forEach((g, i) => { h += stakeCard(g, sd.pp, i === 0); });
    h += `<details class="explain"><summary>How the stakes work</summary><p>These come from the same 10,000 simulations as the playoff odds. Each simulation plays out the rest of the regular season. We then split them by who won this week's game, so "Win" is the playoff odds across the simulations where that team won, and "Lose" across the ones where it lost.</p><p>Last place means last in the regular-season standings, which puts a team on the road to the lid. The lid itself is settled in the toilet bowl.</p><p>The Elo lean comes from the league Elo ratings on Church History. Position ranks come from Spiritual Gifts for this week. The series counts every meeting, playoffs and toilet bowl included.</p></details>`;
    return h;
  }

  const pct = (v, stt) => stt === "clinched" ? "In" : stt === "eliminated" ? "Out" : v >= 0.995 ? (stt ? ">99%" : Math.round(v * 100) + "%") : v < 0.005 ? (stt === "alive" || v > 0 ? "<1%" : "0%") : Math.round(v * 100) + "%";
  function pictureBlock(s) {
    const pp = ppOf(s);
    const rows = s.standings.slice();
    if (pp.odds) rows.sort((a, b) => pp.odds[b.uid].po - pp.odds[a.uid].po || a.rank - b.rank);
    const left = pp.regLeft.length;
    let h = sec("Playoff Picture", left ? `${left} regular-season ${left === 1 ? "week" : "weeks"} left. The top ${s.playoffTeams} make it${pp.byes ? `, and the top ${pp.byes} get a bye` : ""}.` : "The regular season is over.");
    const stTag = u => { const x = pp.status[u]; return x === "clinched" ? '<span class="tag gold flush">Clinched</span>' : x === "eliminated" ? '<span class="tag flush">Eliminated</span>' : pp.status[u + ":magic"] != null ? `<span class="muted nw">Magic&nbsp;${pp.status[u + ":magic"]}</span>` : '<span class="muted">Needs help</span>'; };
    const sosTxt = u => pp.sosRank[u] ? ordinal(pp.sosRank[u]) : "";
    if (pp.odds) {
      h += `<div class="scroll"><table class="data pp" data-hide="2,3"><thead><tr><th>Team</th><th>Playoffs</th><th>Bye</th><th>Proj W</th><th>Schedule</th><th class="l-al">Status</th></tr></thead><tbody>`;
      rows.forEach(r => { const o = pp.odds[r.uid]; h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team">${whoInline(r.uid, s)} <span class="muted num nw">${rec(r)}</span></td><td><b>${pct(o.po, pp.status[r.uid])}</b></td><td>${pp.byes ? pct(o.bye) : ""}</td><td>${f1(o.projW)}</td><td>${sosTxt(r.uid)}</td><td class="l-al">${stTag(r.uid)}</td></tr>`; });
      h += `</tbody></table></div>`;
    } else {
      h += `<div class="scroll"><table class="data"><thead><tr><th>Team</th><th>Record</th><th class="l-al">Status</th></tr></thead><tbody>`;
      s.standings.forEach(r => { h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${r.rank}</span>${whoInline(r.uid, s)}</td><td>${rec(r)}</td><td class="l-al">${stTag(r.uid)}</td></tr>`; });
      h += `</tbody></table></div><p class="stakes sm"><b>Playoff odds and schedule strength are waiting on data.</b> They need the remaining schedule, which the updated export now collects. Run the export again and they turn on.</p>`;
    }
    h += `<details class="explain"><summary>How the playoff picture works</summary>${pp.odds ? `<p>Playoff odds come from 10,000 simulations of the rest of the regular season. Each team's weekly score is drawn from its own scoring so far, pulled slightly toward the league average because a few weeks is a small sample. Ties in the standings go to points for, the league's tiebreaker.</p><p>Schedule ranks each team's remaining opponents by how much they score: 1st is the toughest road left, ${ordinal(s.uids.length)} the easiest. Proj W is the average final win total across the simulations.</p>` : ""}<p>Clinched and Eliminated are exact, not simulated. Clinched means no combination of results can push the team out of the top ${s.playoffTeams}. Eliminated means at least ${s.playoffTeams} teams are already guaranteed to finish ahead.</p><p>Magic is the magic number: how many more wins guarantee a spot no matter what anyone else does. A team that ties on wins counts as a threat, because points for are not settled yet. Needs help means even winning out does not guarantee it.</p></details>`;
    return h;
  }

  function powerBlock(s) {
    const canRev = !!(st.tv && s === st.model.latest && String(st.tv.week.season) === String(s.year) && !s.complete);
    const view = canRev && st.prView === "rev" ? "rev" : "acts";
    if (view === "rev") {
      const rows = tvFuture(st.tv.cons, s, powerRankings(s));
      let h = sec("Pulpit Power Rankings", "Revelation: who is built to win from here. Mostly roster strength from the trade values, plus scoring so far.");
      h += prToggle(view, canRev) + asOfBanner();
      h += `<div class="scroll"><table class="data" data-hide="3,4"><thead><tr><th>Team</th><th>Record</th><th>Roster</th><th>Pts/G</th><th>Last 3</th><th>Future</th></tr></thead><tbody>`;
      rows.forEach((r, i) => { h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${i + 1}</span>${whoInline(r.uid, s)}</td><td>${rec(r)}</td><td>${f1(r.roster)}</td><td>${f1(r.ppg)}</td><td>${f1(r.recent)}</td><td><b>${f1(r.fscore)}</b></td></tr>`; });
      h += `</tbody></table></div>`;
      h += `<details class="explain"><summary>How Revelation works</summary><p>Roster is the value of each team's current roster, scored so the strongest roster in the league is 100. It takes the best legal starting lineup by trade value, then adds a little bench depth: half the value of the best bench player, then 35%, 25%, and 15% for the next three. Kickers and defenses are left out. Rosters include this week's moves.</p><p>Future blends three measures, each scaled so the league's best team scores 1 and the worst scores 0: 60% roster, 25% points per game this season, and 15% the last three weeks.</p><p>Why so little for the last three weeks: in our league's 2024 and 2025 seasons, the season average predicted the rest of the season's scoring better than the last three weeks did, by a wide margin. Three games is mostly noise. Roster value already reflects injuries, trades, and players on the rise.</p><p>Trade values only go back to week 7 of 2026, so these weights are a judgment call, not yet tested against results. Revelation shows only for the current season.</p></details>`;
      return h;
    }
    const rows = powerRankings(s);
    let h = sec("Pulpit Power Rankings", "Acts: who is preaching right now. Half all-play win rate, a quarter points per game, a quarter the last three weeks.");
    h += prToggle(view, canRev);
    h += `<div class="scroll"><table class="data" data-hide="2,3"><thead><tr><th>Team</th><th>Record</th><th>All-play %</th><th>Pts/G</th><th>Last 3</th><th>Power</th></tr></thead><tbody>`;
    rows.forEach((r, i) => { h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${i + 1}</span>${whoInline(r.uid, s)}</td><td>${rec(r)}</td><td>${(r.ap * 100).toFixed(1)}</td><td>${f1(r.ppg)}</td><td>${f1(r.recent)}</td><td><b>${f1(r.score)}</b></td></tr>`; });
    return h + `</tbody></table></div>`;
  }

  function prToggle(view, canRev) {
    if (!canRev) return "";
    return `<div class="chips" role="group" aria-label="Power ranking view"><button data-prview="acts" aria-pressed="${view === "acts"}">Acts · right now</button><button data-prview="rev" aria-pressed="${view === "rev"}">Revelation · from here</button></div>`;
  }

  function allPlayBlock(s) {
    const years = st.model.seasons.map(x => x.year);
    if (st.apScope !== "all" && !years.includes(st.apScope)) st.apScope = s.year;
    const scope = st.apScope;
    const rows = allPlay(st.model, scope === "all" ? null : scope);
    const sc = scope === "all" ? null : seasonOf(scope);
    let h = sec("Everyone Plays Everyone", "Every week, every score against every other team. Your record if you played the whole league every Sunday.");
    h += `<div class="chips" role="group" aria-label="All-play range">${years.slice().reverse().map(y => `<button data-ap="${y}" aria-pressed="${scope === y}">${y}</button>`).join("")}<button data-ap="all" aria-pressed="${scope === "all"}">All ${years.length} seasons</button></div>`;
    h += `<div class="scroll"><table class="data" data-hide="3,4,5"><thead><tr><th>${sc ? "Team" : "Owner"}</th><th>Actual</th><th>All-play</th><th>All-play %</th><th>Median</th><th>Expected W</th><th>Sched help</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
      const o = st.model.owners[r.uid];
      const name = sc ? whoInline(r.uid, sc) : `<b>${esc(o.name)}</b>${o.active ? "" : '<span class="tag">Retired</span>'} <span class="muted">${r.seasons} ${r.seasons === 1 ? "season" : "seasons"}</span>`;
      h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${i + 1}</span>${name}</td><td>${rec(r)}</td><td>${r.allW}-${r.allL}${r.allT ? "-" + r.allT : ""}</td><td>${(r.pct * 100).toFixed(1)}</td><td>${r.medW}-${r.medL}${r.medT ? "-" + r.medT : ""}</td><td>${f1(r.expW)}</td><td class="${r.luck > 0.5 ? "w" : r.luck < -0.5 ? "l" : ""}">${sign(r.luck)}</td></tr>`;
    });
    h += `</tbody></table></div>`;
    h += scatterChart(rows, sc);
    h += `<details class="explain"><summary>How schedule help works</summary><p>Each week your score is ranked against every other team's score. In a 12-team week, beat 8 of the other 11 and you go 8 and 3 for that week in the all-play standings.</p><p>Your all-play win rate times your real games played gives Expected W, the wins an average schedule would have produced. Schedule help is your real wins minus Expected W. Plus 2.0 means the schedule handed you two wins your points did not earn. Minus 2.0 means you lost two games your scores usually win. Near zero means your record is honest.</p><p>Median is a second record: each week you also play the league's median score. Beat it and you get a win.</p><p>A word on names: providence belongs to God, and He is not picking fantasy winners. This column is arithmetic about schedules.</p></details>`;
    return h;
  }

  function reportBlock(s) {
    if (s.regWeeks.length < 2) return "";
    const rc = reportCard(st.model, s);
    let h = sec("Report Card", `${esc(s.year)} regular season. Lineup skill, consistency, and heartbreak.`);
    h += `<div class="awards">${rc.awards.map(a => `<div class="award"><span class="t">${esc(a.title)}</span><span class="v sm">${esc(a.value)}</span><span class="n">${esc(teamIn(a.uid, s))}</span><span class="d">${esc(ownerName(a.uid))}. ${esc(a.note)}.</span></div>`).join("")}</div>`;
    const rows = rc.rows.slice().sort((a, b) => b.eff - a.eff);
    const prR = prOf(s), fc = uid => { const c = prR && prR.teams[uid] && prR.teams[uid].calls; return c ? `<td>${c.n ? `${c.right}/${c.n}` : "0"}</td>` : ""; };
    h += `<div class="scroll gap"><table class="data" data-hide="${prR ? "2,3,4,7,8" : "2,3,4,6,7"}"><thead><tr><th>Team</th><th>Coaching %</th><th>Pts left</th><th>Avg</th><th>Swing</th><th>Wrong calls</th>${prR ? "<th>Faith calls</th>" : ""}<th>Close L</th><th>Bad beats</th><th>Upsets</th></tr></thead><tbody>`;
    rows.forEach(r => { h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team">${whoInline(r.uid, s)}</td><td>${(r.eff * 100).toFixed(1)}</td><td>${f1(r.lost)}</td><td>${f1(r.avg)}</td><td>${f1(r.sd)}</td><td>${r.wrong}</td>${fc(r.uid)}<td>${r.closeL}</td><td>${r.badBeats}</td><td>${r.upsets}</td></tr>`; });
    if (prR) h += `<p class="fine">Faith calls: lineup calls against Sleeper's projection that paid off, out of all such calls. <button type="button" class="linkish" data-go="prophets" data-sec="Walking by faith">See Prophecy Check</button></p>`;
    h += `</tbody></table></div><details class="explain"><summary>How the report card works</summary><p>Coaching % is the points you scored divided by the best lineup you could have started from the same roster that week, with hindsight, using the lineup slots your league actually uses. Pts left is the season total of that gap.</p><p>Swing is the standard deviation of your weekly scores: low is steady, high is boom or bust. Close L counts losses by under 5 points. Upsets counts the weeks your win was the league's biggest upset, against a team whose win rate was at least 20 points higher going in.</p><p>Wrong calls counts the times a bench player who could legally fill a starting spot outscored the starter by 5 points or more. Each bench player and each starting spot counts once per week. Bad beats counts losses where you outscored at least 70% of the league that week.</p></details>`;
    return h;
  }

  /* ---------- Tuesday Recap ---------- */
  function week() {
    const s = season();
    if (!s.weeks.length) return `<p class="empty">No scored weeks yet for ${esc(s.year)}.</p>`;
    if (!s.weeks.includes(st.week)) st.week = s.weeks[s.weeks.length - 1];
    let h = sec("Tuesday Recap", `${esc(s.year)}, week ${st.week}${st.week >= s.pws ? ", playoffs" : ""}`) + `<div class="chips" role="group" aria-label="Choose a week">`;
    s.weeks.forEach(w => { h += `<button data-week="${w}" aria-pressed="${w === st.week}" class="${w >= s.pws ? "po" : ""}">${w}</button>`; });
    h += `</div>`;
    if (s.pws <= s.weeks[s.weeks.length - 1]) h += `<p class="fine">Dashed weeks are playoff weeks.</p>`;
    const preach = sermon(s, st.week), lines = preach.lines;
    if (lines.length) h += `<div class="hero slim"><p class="hero-k">${preach.kicker}</p><h2 class="hero-h st">${preach.title}</h2><ol class="sermon">${lines.map(l => `<li>${l}</li>`).join("")}</ol>${preach.benediction ? `<p class="sermon-ben"><span class="sl">Benediction</span>${preach.benediction}</p>` : ""}</div>`;
    h += `<h3>Awards</h3><div class="awards">${recapTiles(s, st.week).join("")}`;
    h += `</div><h3>Matchups</h3><div class="games">`;
    s.games.filter(g => g.week === st.week).sort((a, b) => (a.kind === "consolation") - (b.kind === "consolation") || !!b.lidGame - !!a.lidGame || b.margin - a.margin).forEach(g => {
      const side = (x, y) => { const c = x.pts > y.pts ? "won" : "lost"; return `<span class="nm ${c}">${who(x.uid, s)}</span><span class="sc ${c}">${f2(x.pts)}</span>`; };
      const lab = g.lidGame ? '<span class="tag lid glab">Lid game</span>' : g.kind === "consolation" ? '<span class="tag glab">Toilet bowl</span>' : g.title ? '<span class="tag gold glab">Championship</span>' : g.kind === "playoff" ? '<span class="tag gold glab">Playoff</span>' : "";
      h += `<div class="game">${lab}${side(g.a, g.b)}${side(g.b, g.a)}</div>`;
    });
    return h + `</div>`;
  }

  /* ---------- Rivalries ---------- */
  function rivals() {
    const s = season();
    const pairs = rivalryPairs(st.model, st.withPO);
    const act = activeOwners();
    const commish = (Object.values(st.model.owners).find(o => o.handle === COMMISH) || {}).uid;
    const featPool = pairs.filter(p => p.a !== commish && p.b !== commish);
    if (!st.rival || !st.model.owners[st.rival]) {
      const top = featPool.slice().sort((a, b) => b.n - a.n || a.diff - b.diff)[0];
      st.rival = top ? top.a : act[0].uid; if (!st.rivalB && top) st.rivalB = top.b;
    }
    if (!st.rivalB || st.rivalB === st.rival || !st.model.owners[st.rivalB]) {
      const mine = pairs.filter(p => p.a === st.rival || p.b === st.rival).sort((a, b) => b.n - a.n || a.diff - b.diff)[0];
      st.rivalB = mine ? (mine.a === st.rival ? mine.b : mine.a) : (act.find(o => o.uid !== st.rival) || {}).uid;
    }
    let h = sec("Rivalries", "As iron sharpens iron, so one man sharpens another. Proverbs 27:17.") + poChips();

    // Featured feuds
    const enough = featPool.filter(p => p.n >= 3);
    const mostPlayed = featPool.slice().sort((a, b) => b.n - a.n || a.diff - b.diff)[0];
    const usedIds = new Set(mostPlayed ? [mostPlayed.a, mostPlayed.b] : []);
    const fresh = p => !usedIds.has(p.a) && !usedIds.has(p.b);
    const closest = enough.filter(fresh).sort((a, b) => a.diff - b.diff || a.avgMargin - b.avgMargin)[0];
    if (closest) { usedIds.add(closest.a); usedIds.add(closest.b); }
    const lopsided = (enough.filter(fresh).sort((a, b) => (b.diff / b.n) - (a.diff / a.n) || b.n - a.n)[0]) || null;
    const feud = (title, p, line) => { if (!p) return ""; const lead = p.aw >= p.bw ? p.a : p.b, trail = lead === p.a ? p.b : p.a; const r = pairRecord(pairs, lead, trail); return `<button type="button" class="feud" data-pa="${esc(lead)}" data-pb="${esc(trail)}"><span class="ft">${title}</span><span class="fn">${esc(ownerName(lead))} vs ${esc(ownerName(trail))}</span><span class="fr num">${rec(r)}</span><span class="fd">${line(r)}</span></button>`; };
    h += `<div class="feuds">`;
    h += feud("Most played", mostPlayed, r => `${r.n} meetings`);
    if (closest && closest !== mostPlayed) h += feud(closest.diff === 0 ? "Dead even" : "Closest series", closest, r => `Average margin ${f1(r.avgMargin)}`);
    if (lopsided && lopsided !== mostPlayed && lopsided !== closest) h += feud("Most lopsided", lopsided, r => r.l === 0 && !r.t ? `${r.n} meetings, never lost` : `${r.n} meetings`);
    h += `</div>`;

    // Series detail
    const A = st.rival, B = st.rivalB;
    h += sec("Head to Head", "Pick any two members, retired ones included.");
    h += `<div class="pick"><select id="rival" aria-label="First member">${ownerOptions(A)}</select><span class="vs">vs</span><select id="rivalB" aria-label="Second member">${ownerOptions(B)}</select></div>`;
    const x = pairRecord(pairs, A, B);
    if (!x) h += `<p class="empty">${esc(ownerName(A))} and ${esc(ownerName(B))} have never met${st.withPO ? "" : " in the regular season"}.</p>`;
    else {
      const big = side => x.games.filter(g => side ? g.me > g.them : g.them > g.me).sort((a, b) => b.margin - a.margin)[0];
      const bA = big(true), bB = big(false);
      h += `<div class="score"><div><span class="sn">${esc(ownerName(A))}</span><span class="sv num">${x.w}</span></div><div class="sx">${x.t ? x.t + (x.t === 1 ? " tie" : " ties") : "series"}</div><div><span class="sn">${esc(ownerName(B))}</span><span class="sv num">${x.l}</span></div></div>`;
      h += `<div class="awards three"><div class="award"><span class="t">Total points</span><span class="v sm num">${f1(x.pf)} to ${f1(x.pa)}</span></div><div class="award"><span class="t">Average margin</span><span class="v sm num">${f1(x.avgMargin)}</span></div><div class="award"><span class="t">Meetings</span><span class="v sm num">${x.n}</span></div></div>`;
      if (bA || bB) h += `<div class="list">${bA ? `<div class="row"><div>Biggest ${esc(ownerName(A))} win</div><div class="r">${f2(bA.margin)}<small>${esc(bA.year)} week ${bA.week}</small></div></div>` : ""}${bB ? `<div class="row"><div>Biggest ${esc(ownerName(B))} win</div><div class="r">${f2(bB.margin)}<small>${esc(bB.year)} week ${bB.week}</small></div></div>` : ""}</div>`;
      h += `<h3>Every meeting</h3><div class="list">${x.games.slice().reverse().map(g => `<div class="row"><div>${esc(g.year)} week ${g.week}${g.title ? ' <span class="tag gold">Final</span>' : g.kind === "playoff" ? ' <span class="tag gold">Playoff</span>' : g.lidGame ? ' <span class="tag lid">Lid game</span>' : g.kind === "consolation" ? ' <span class="tag">Toilet bowl</span>' : ""}</div><div class="r ${g.me > g.them ? "w" : g.me < g.them ? "l" : ""}">${f2(g.me)} to ${f2(g.them)}<small>${g.me > g.them ? esc(ownerName(A)) + " won" : g.me < g.them ? esc(ownerName(B)) + " won" : "Tie"}</small></div></div>`).join("")}</div>`;
    }

    // Feud board
    h += sec("The Feud Board", "Read across: the row member's record against the column member, all seasons. Blue squares mean the row member leads the series. Tan squares mean he trails. Tap a square for the full series.");
    const abbr = {}; const used = {};
    act.forEach(o => { let a = o.name.includes(" ") ? o.name.split(" ").map(x => x[0]).join("") : o.name.slice(0, 3); if (used[a]) a = o.name.slice(0, 2) + o.name.slice(-1); used[a] = 1; abbr[o.uid] = a; });
    h += `<div class="scroll"><table class="matrix"><thead><tr><th></th>${act.map(o => `<th title="${esc(o.name)}">${esc(abbr[o.uid])}</th>`).join("")}</tr></thead><tbody>`;
    act.forEach(r => {
      h += `<tr><th>${esc(r.name)}</th>`;
      act.forEach(c => {
        if (r.uid === c.uid) { h += `<td class="self" aria-hidden="true"></td>`; return; }
        const x = pairRecord(pairs, r.uid, c.uid);
        if (!x) { h += `<td class="none"><span aria-label="never played">·</span></td>`; return; }
        const cls = x.w > x.l ? "lead" : x.w < x.l ? "trail" : "even";
        const sel = (st.rival === r.uid && st.rivalB === c.uid) ? " on" : "";
        h += `<td class="${cls}${sel}"><button type="button" data-pa="${esc(r.uid)}" data-pb="${esc(c.uid)}" aria-label="${esc(r.name)} ${rec(x)} against ${esc(c.name)}">${x.w}-${x.l}</button></td>`;
      });
      h += `</tr>`;
    });
    h += `</tbody></table></div><p class="fine">Current members only. ${st.withPO ? "Includes postseason games: playoffs, the championship, and the toilet bowl." : "Regular season games only. Switch to With postseason to add playoff and toilet bowl games."}</p>`;

    // Against the congregation
    h += sec("Against the Congregation", `${esc(ownerName(A))} against every opponent.`);
    h += `<div class="chips" role="group" aria-label="Scope"><button data-scope="all" aria-pressed="${st.rivalScope === "all"}">All seasons</button><button data-scope="season" aria-pressed="${st.rivalScope === "season"}">${esc(s.year)} only</button></div>`;
    const rows = headToHead(st.model, A, st.rivalScope === "season" ? s.year : null, st.withPO);
    if (!rows.length) h += `<p class="empty">No games in this range.</p>`;
    else {
      const tot = rows.reduce((a, r) => ({ w: a.w + r.w, l: a.l + r.l, t: a.t + r.t }), { w: 0, l: 0, t: 0 });
      h += `<p class="kick">${esc(ownerName(A))} is <b>${rec(tot)}</b> ${st.withPO ? "with postseason games included" : "in the regular season"}.</p>`;
      h += `<div class="scroll"><table class="data" data-hide="2,3"><thead><tr><th>Opponent</th><th>Record</th><th>PF</th><th>PA</th><th>Last meeting</th></tr></thead><tbody>`;
      rows.forEach(r => {
        const o = st.model.owners[r.uid];
        const res = r.last.me > r.last.them ? "w" : r.last.me < r.last.them ? "l" : "";
        h += `<tr><td class="team"><b>${esc(o.name)}</b>${o.active ? "" : '<span class="tag">Retired</span>'}</td><td class="${r.w > r.l ? "w" : r.l > r.w ? "l" : ""}">${rec(r)}</td><td>${f2(r.pf)}</td><td>${f2(r.pa)}</td><td><span class="${res}">${f2(r.last.me)} to ${f2(r.last.them)}</span> <span class="muted">${esc(r.last.year)} wk ${r.last.week}</span></td></tr>`;
      });
      h += `</tbody></table></div>`;
    }

    // Schedule swap
    if (s.uids.includes(A) && s.regWeeks.length) {
      const sw = scheduleSwap(s, A);
      const own = sw.find(r => r.own);
      h += sec("Walk a Mile in His Schedule", `${esc(ownerName(A))}'s ${esc(s.year)} scores, replayed against every other team's schedule. His real record is ${rec(own)}.`);
      h += `<div class="list">${sw.map(r => `<div class="row"><div>${r.own ? "<b>His own schedule</b>" : `${esc(ownerName(r.uid))}'s schedule`}</div><div class="r ${r.w > own.w ? "w" : r.w < own.w ? "l" : ""}">${rec(r)}</div></div>`).join("")}</div>`;
    } else if (!s.uids.includes(A)) {
      h += `<p class="fine">Walk a Mile in His Schedule appears when the first member played in ${esc(s.year)}.</p>`;
    }
    return h;
  }

  /* ---------- Members ---------- */
  function memberWire(uid) {
    const W0 = wireStats(st.model, "pickups", null);
    const r = W0.rows.find(x => x.uid === uid);
    if (!r || r.n < 5) return "";
    const W = 340, L = 4, cw = (W - L - 2) / 24, rh = 22, H = 18 + rh + 2, rmax = Math.max(1, ...r.hours);
    let g = heatAxis(L, cw, 11);
    HOURS.forEach((hh, j) => { const v = r.hours[hh]; g += `<rect class="hc h${heatLvl(v, rmax)}" x="${L + j * cw + 0.5}" y="19" width="${cw - 1.5}" height="${rh - 3}" rx="2" data-tip="${esc(`${hrLong(hh)} hour: ${v} ${v === 1 ? "pickup" : "pickups"}`)}"/>`; });
    const top = BLOCKS.slice().sort((a, b) => r.share(b.key) - r.share(a.key))[0];
    return `<h3>When he works the wire</h3><figure class="chart"><figcaption><span class="muted sm">Median pickup time: <b>${clock(r.med)}</b>, busiest block: ${top.name}, ${Math.round(r.share(top.key) * 100)}% of ${r.n} pickups.</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pickups by hour">${g}</svg></figure><div class="linkwrap">${goBtn("moves", "When the Flock Moves")}See everyone's hours</button></div>`;
  }

  // Member page: this season's roster strength, from Revelation and Spiritual Gifts
  function memberRoster(uid) {
    const s = st.model.latest; giftsData(s);
    const ros = st.gCache[s.year + ":ros"], cur = st.gCache[s.year + ":cur"];
    if (!ros || !ros.rank[uid]) return "";
    const fut = tvFuture(st.tv.cons, s, powerRankings(s)), fi = fut.findIndex(r => r.uid === uid), fr = fut[fi];
    let h = `<h3>The roster, by gift</h3><div class="me-grid mini">`;
    if (fr) h += `<div><span class="mk">Revelation</span><span class="mv num">${ordinal(fi + 1)}</span><span class="md">of ${fut.length}, looking ahead</span></div><div><span class="mk">Roster value</span><span class="mv num">${f1(fr.roster)}</span><span class="md">best roster = 100</span></div>`;
    if (cur && cur.rank[uid]) h += `<div><span class="mk">Week ${cur.week}</span><span class="mv num">${ordinal(cur.rank[uid].total)}</span><span class="md">${cur.scoring === "proj" ? "projected lineup" : "lineup by value"}</span></div>`;
    h += `</div><div class="gbars">`;
    const r = ros.rank[uid], t = ros.teams[uid];
    G_KEYS.slice().sort((a, b) => r[a] - r[b]).forEach(k => { const band = gBand(r[k], ros.n); h += `<div class="grow"><span class="gl">${k}</span><span class="gbar" role="img" aria-label="${k}: ${ordinal(r[k])} of ${ros.n}"><i class="${band}" style="width:${Math.max(3, t.groups[k] / ros.max[k] * 100).toFixed(1)}%"></i></span><span class="gr ${band}">#${r[k]}</span></div>`; });
    h += `</div><p class="fine">Rest of season, by trade value.</p><div class="linkwrap"><button type="button" class="go-btn" data-go="gifts" data-sec="Spiritual Gifts" data-gteam="${esc(uid)}">Open in Spiritual Gifts</button></div>`;
    return h;
  }

  function members() {
    const pool = allOwners();
    if (!st.member || !st.model.owners[st.member]) st.member = (pool.find(o => o.handle === "BentonPerret") || pool[0]).uid;
    const p = memberProfile(st.model, st.member);
    const o = p.o;
    let h = sec("Member Directory", "One page per member, every season.");
    h += `<div class="pick"><select id="member" aria-label="Member">${ownerOptions(st.member)}</select></div>`;
    h += `<div class="champ"><div class="glyph" aria-hidden="true"></div><div><b>${esc(o.name)}</b>${o.active ? "" : '<span class="tag">Retired</span>'}<div class="muted">${esc(o.handle || "")} on Sleeper. Member since ${esc(o.seasons[0])}, ${o.seasons.length} ${o.seasons.length === 1 ? "season" : "seasons"}.</div></div></div>`;
    const tile = (t, v, d) => `<div class="award"><span class="t">${t}</span><span class="v sm">${v}</span>${d ? `<span class="d">${d}</span>` : ""}</div>`;
    h += `<h3>By the numbers</h3><div class="awards">`;
    h += tile("Record", rec(p.at), `${((p.at.pct || 0) * 100).toFixed(1)}% in the regular season`);
    h += tile("All-play", `${p.ap.allW || 0}-${p.ap.allL || 0}`, `Schedule help ${sign(p.ap.luck || 0)} wins`);
    h += tile("Hardware", `<span class="nw">${p.at.titles || 0} ${p.at.titles === 1 ? "trophy" : "trophies"}</span> · <span class="nw">${p.at.lids || 0} ${p.at.lids === 1 ? "lid" : "lids"}</span>`, `${p.at.playoffs || 0} playoff ${p.at.playoffs === 1 ? "trip" : "trips"}`);
    h += tile("Coaching", p.eff != null ? (p.eff * 100).toFixed(1) + "%" : "None yet", "Career lineup efficiency");
    const prM = prOf(st.model.latest), TM = prM && prM.teams[st.member];
    if (TM && TM.n) {
      const rk = Object.values(prM.teams).filter(t => t.n).sort((a, b) => b.perWeek - a.perWeek), i = rk.findIndex(t => t.uid === st.member);
      h += tile("Prophecy", `${sign(TM.perWeek)} a week`, `${ordinal(i + 1)} of ${rk.length}. ${esc(st.model.latest.year)} starters against projection`);
      h += tile("Walking by faith", TM.calls.n ? `${TM.calls.right} of ${TM.calls.n}` : "No calls", TM.calls.n ? `Lineup calls against projection paid off, ${sign(TM.calls.net)} net` : "Always started the higher projection");
    }
    if (p.hi) h += tile("Best week", f2(p.hi.pts), `${esc(p.hi.year)} week ${p.hi.week}`);
    if (p.lo) h += tile("Worst week", f2(p.lo.pts), `${esc(p.lo.year)} week ${p.lo.week}`);
    if (p.ledger) h += tile("Trade balance", signInt(p.ledger.net), `${p.ledger.trades} ${p.ledger.trades === 1 ? "trade" : "trades"}`);
    { const el = eloRatings(st.model); const i = el.findIndex(r => r.uid === st.member); if (i >= 0) h += tile("Elo", String(Math.round(el[i].elo)), `${ordinal(el.filter(r => !(st.model.owners[r.uid] || {}).orphan).findIndex(r => r.uid === st.member) + 1)} in the league, peak ${Math.round(el[i].peak ? el[i].peak.elo : el[i].elo)}`); }
    { const cg = closeGames(st.model, true).find(r => r.uid === st.member); if (cg) h += tile("Close games", `${cg.w}-${cg.l}${cg.t ? "-" + cg.t : ""}`, "Decided by under 10, postseason included"); }
    h += `</div>`;
    h += lineChart(st.member);
    h += memberWire(st.member);
    h += `<h3>Season by season</h3><div class="list">`;
    p.finishes.slice().reverse().forEach(f => { h += `<div class="row"><div><b>${esc(f.team)}</b> <span class="muted">${esc(f.year)}, ${esc(f.rec)}${f.seed ? ", " + f.seed + " seed" : ""}</span></div><div class="r">${f.finish ? ordinal(f.finish) + " of " + f.of : f.seed ? ordinal(f.seed) + " so far" : "In progress"}<small>${esc(f.label)}</small></div></div>`; });
    h += `</div><div class="cols"><div><h3>Rivals</h3><div class="list">`;
    const rv = (label, r) => r ? `<div class="row"><div><b>${label}</b> <span class="muted">${esc(ownerName(r.uid))}</span></div><div class="r">${rec(r)}<small>${r.games} games</small></div></div>` : "";
    h += rv("Most played", p.rival) + (p.nemesis && (!p.rival || p.nemesis.uid !== p.rival.uid) ? rv("Nemesis", p.nemesis) : "") + (p.victim && (!p.rival || p.victim.uid !== p.rival.uid) ? rv("Favorite opponent", p.victim) : "");
    h += `</div><p class="fine">Includes postseason games, toilet bowl too. Nemesis and favorite opponent need at least 3 meetings.</p></div><div><h3>Most trusted starters</h3><div class="list">${p.favorites.map(f => `<div class="row"><div><b>${pn(f.pid, f.name)}</b> <span class="muted">${esc(f.pos)}</span></div><div class="r">${f.n} starts<small>${f1(f.pts)} points</small></div></div>`).join("")}</div></div></div>`;
    { const rg = regretList(st.model).find(r => r.uid === st.member); if (rg) h += `<h3>Worst benching</h3><div class="row"><div>Benched <b>${pn(rg.bench, rg.pinfo(rg.bench)[0])}</b> (${f1(rg.bPts)}) <span class="muted">for ${pn(rg.starter, rg.pinfo(rg.starter)[0])} (${f1(rg.sPts)})</span></div><div class="r l">−${f1(rg.diff)}<small>${esc(rg.year)} week ${rg.week}${rg.cost ? ", cost the game" : ""}</small></div></div>`; }
    { const ps = prodigalSons(st.model).find(x => x.dropper === st.member && !["K", "DEF"].includes(String(x.pos).toUpperCase())); if (ps) h += `<h3>The one that got away</h3><div class="row"><div>Dropped <b>${pn(ps.pid, ps.name)}</b> <span class="muted">${esc(ps.pos)}, ${esc(ps.year)} week ${ps.week}. Mostly for ${esc(ownerName(ps.to))} after that.</span></div><div class="r">${f1(ps.pts)}<small>points for others</small></div></div>`; }
    if (TM && TM.players) {
      const pl0 = Object.values(TM.players).filter(x => x.n >= 2).map(x => ({ ...x, gap: x.act - x.proj }));
      if (pl0.length >= 2) {
        pl0.sort((a, b) => b.gap - a.gap);
        const L0 = st.model.latest, row0 = (x, t) => `<div class="row"><div><b>${t}</b> ${pn(x.pid, L0.pinfo(x.pid)[0])} <span class="muted">${esc(L0.pinfo(x.pid)[1] || "")}</span></div><div class="r ${x.gap > 0 ? "w" : x.gap < 0 ? "l" : ""}">${sign(x.gap)}<small>beat it ${x.beat} of ${x.n} weeks on his roster</small></div></div>`;
        h += `<h3>His prophecy, ${esc(L0.year)}</h3><div class="list">${row0(pl0[0], "Exceeded:")}${row0(pl0[pl0.length - 1], "Fell short:")}</div><p class="fine">Players on his roster, started or not, against Sleeper's projection, at least 2 weeks with him.</p>`;
      }
    }
    if (st.tv && st.model.latest.uids.includes(st.member) && !st.model.latest.complete) h += memberRoster(st.member);
    { const s0 = st.model.latest; if (s0.drafted.length && s0.uids.includes(st.member)) { const c = draftData(s0).cards.find(x => x.uid === st.member); if (c) h += `<div class="row sower-line"><div>${gradeTag(c.grade)} <b>Draft grade</b> <span class="muted">${esc(s0.year)}: ${c.kept.length} of ${c.n} still on the roster, ${c.traded.length} traded, ${c.dropped.length} dropped</span></div><div class="r"><button type="button" class="linkish" data-go="draft" data-sec="The Sower">The Sower</button></div></div>`; } }
    if (st.tv && st.model.latest.uids.includes(st.member)) { const ideas = tvIdeas(st.member); h += `<h3>Trade ideas this week</h3>` + (ideas.length ? `<div class="ideas">${ideas.map((t, i) => ideaCard(st.member, t, i, st.member !== st.me)).join("")}</div>` : `<p class="fine">No trade passes both the fair and the win-win test for him this week.</p>`); }
    if (p.bestPick) h += `<h3>Best draft pick</h3><div class="row"><div><b>${esc(p.bestPick.name)}</b> <span class="muted">${esc(p.bestPick.position)}, ${esc(p.bestPick.year)} pick ${p.bestPick.pick_no}</span></div><div class="r">${f1(p.bestPick.seasonPts)}<small>${ordinal(p.bestPick.ptsRank)} in points</small></div></div>`;
    if (p.ledger && p.ledger.best) h += `<h3>Best trade</h3><div class="row"><div>Got <b>${esc(p.ledger.best.got.join(", ") || "picks")}</b> <span class="muted">for ${esc(p.ledger.best.gave.join(", ") || "picks")}</span></div><div class="r ${p.ledger.best.net >= 0 ? "w" : "l"}">${signInt(p.ledger.best.net)}<small>${esc(p.ledger.best.year)} week ${p.ledger.best.week}</small></div></div>`;
    return h;
  }

  /* ---------- Church History ---------- */
  function history() {
    const at = allTime(st.model, st.withPO);
    let h = sec("Church History", "Champions and lid holders by year.");
    h += `<div class="stakes"><b>The stakes</b><p>The champion takes home the trophy and picks the charity that gets the pot. Last place takes home an actual toilet bowl lid, decided by the toilet bowl bracket.</p></div><div class="list">`;
    at.champs.slice().reverse().forEach(c => {
      const s = seasonOf(c.year);
      h += c.champion ? `<div class="row yr"><div class="hw"><div><span class="tag gold flush">Trophy</span><div>${whoInline(c.champion, s)}<span class="muted sm hw-n">beat ${esc(ownerName(c.runnerUp))} in the final</span></div></div><div><span class="tag lid flush">Lid</span><div>${c.lid ? whoInline(c.lid, s) : '<span class="muted">none</span>'}</div></div></div><div class="r">${esc(c.year)}</div></div>`
        : `<div class="row"><div class="muted">Season in progress</div><div class="r">${esc(c.year)}</div></div>`;
    });
    h += `</div>` + sec("Membership Roll", "Every member since year one.") + poChips();
    h += `<div class="scroll"><table class="data" data-hide="1,4,5"><thead><tr><th>Member</th><th>Seasons</th><th>Record</th><th>Win %</th><th>Pts/G</th><th>Playoffs</th><th>Titles</th><th>Lids</th></tr></thead><tbody>`;
    at.table.forEach(r => { h += `<tr><td class="team"><b>${esc(r.name)}</b>${r.active ? "" : '<span class="tag">Retired</span>'}</td><td>${r.seasons}</td><td>${rec(r)}</td><td>${(r.pct * 100).toFixed(1)}</td><td>${f1(r.ppg)}</td><td>${r.playoffs}</td><td>${r.titles ? `<span class="tag gold flush">${r.titles}</span>` : "0"}</td><td>${r.lids ? `<span class="tag lid flush">${r.lids}</span>` : "0"}</td></tr>`; });
    h += `</tbody></table></div><p class="fine">${st.withPO ? "Records include postseason games: playoffs, the championship, and the toilet bowl." : "Records count regular season games."} Members are tracked by Sleeper account, so a new team name keeps the same history.</p>`;
    const line = (t, extra) => `<div class="row"><div><b>${esc(teamIn(t.uid, seasonOf(t.year)))}</b> <span class="muted">${esc(ownerName(t.uid))}</span>${gameTag(t.game)}</div><div class="r">${extra}<small>${esc(t.year)} week ${t.week}</small></div></div>`;
    h += sec("The Book of Numbers", st.withPO ? "All-time records, postseason included." : "All-time records, regular season.");
    h += `<div class="cols"><div><h3>Highest scores</h3><div class="list">${at.top.map(t => line(t, f2(t.pts))).join("")}</div></div>`;
    h += `<div><h3>Lowest scores</h3><div class="list">${at.bottom.map(t => line(t, f2(t.pts))).join("")}</div></div>`;
    const gline = g => { const wn = g.a.pts >= g.b.pts ? g.a : g.b, ls = wn === g.a ? g.b : g.a; return `<div class="row"><div><b>${esc(ownerName(wn.uid))}</b> <span class="muted">over ${esc(ownerName(ls.uid))}</span>${gameTag(g)}</div><div class="r">${f2(g.margin)}<small>${esc(g.year)} week ${g.week}</small></div></div>`; };
    h += `<div><h3>Biggest blowouts</h3><div class="list">${at.blow.map(gline).join("")}</div></div>`;
    h += `<div><h3>Closest games</h3><div class="list">${at.close.map(gline).join("")}</div></div></div>`;
    const bbs = badBeats(st.model).slice(0, 5);
    if (bbs.length) h += `<h3>Worst bad beats</h3><p class="fine top">Regular-season losses where the loser outscored the most of the league that week.</p><div class="list">${bbs.map(b => `<div class="row"><div><b>${esc(ownerName(b.uid))}</b> <span class="muted">lost to ${esc(ownerName(b.opp))}, ${f1(b.pts)} to ${f1(b.oppPts)}</span></div><div class="r">beat ${b.beat} of ${b.of}<small>${esc(b.year)} week ${b.week}</small></div></div>`).join("")}</div>`;
    const rgs = regretList(st.model).slice(0, 5);
    if (rgs.length) h += `<h3>Worst benchings</h3><p class="fine top">The biggest gaps between a benched player and the starter he could have replaced, any week, postseason included.</p><div class="list">${rgs.map(r => `<div class="row"><div><b>${esc(ownerName(r.uid))}</b> <span class="muted">benched ${esc(r.pinfo(r.bench)[0])} (${f1(r.bPts)}) for ${esc(r.pinfo(r.starter)[0])} (${f1(r.sPts)})</span></div><div class="r l">−${f1(r.diff)}<small>${esc(r.year)} week ${r.week}${r.cost ? ", cost the game" : ""}</small></div></div>`).join("")}</div>`;
    h += closeBlock();
    h += eloBlock();
    return h;
  }

  function closeBlock() {
    const rows = closeGames(st.model, st.withPO).filter(r => !(st.model.owners[r.uid] || {}).orphan).sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.n - a.n);
    if (!rows.length) return "";
    let h = sec("Close-Game Record", `Games decided by under 10 points, all seasons${st.withPO ? ", postseason included" : ", regular season"}.`);
    h += `<div class="bars">${rows.map(r => `<div class="bar-row${r.uid === st.me ? " me" : ""}"><span class="bn">${esc(ownerName(r.uid))}</span><span class="bt split"><span class="bf" style="width:${(r.w / Math.max(1, r.n)) * 100}%"></span></span><span class="bv num">${r.w}-${r.l}${r.t ? "-" + r.t : ""}</span></div>`).join("")}</div>`;
    h += `<p class="fine">The blue share of each bar is wins. Sorted by wins minus losses, so a 5-1 record ranks above 3-0. Most members have only a handful of close games, so a hot streak here can be chance as much as nerve.</p>`;
    return h;
  }

  function eloBlock() {
    const rows = eloRatings(st.model).filter(r => !(st.model.owners[r.uid] || {}).orphan);
    if (!rows.length) return "";
    if (!st.eloWho || !rows.some(r => r.uid === st.eloWho)) st.eloWho = (rows.find(r => r.uid === st.me) || rows[0]).uid;
    let h = sec("Elo Ratings", "A chess-style rating for every member. Beat a strong team and you gain more. Lose to a weak one and you drop more.");
    h += `<div class="list">${rows.map((r, i) => { const o = st.model.owners[r.uid]; const lastD = r.last ? r.last.d : 0; return `<div class="row${r.uid === st.me ? " me-row" : ""}"><div><span class="rank">${i + 1}</span><b>${esc(o.name)}</b>${o.active ? "" : '<span class="tag">Retired</span>'} <span class="muted sm">peak ${Math.round(r.peak ? r.peak.elo : r.elo)}${r.peak ? ", " + esc(r.peak.year) + " wk " + r.peak.week : ""}</span></div><div class="r">${Math.round(r.elo)}<small class="${lastD > 0 ? "w" : lastD < 0 ? "l" : ""}">${lastD > 0 ? "▲" : lastD < 0 ? "▼" : ""} ${lastD ? Math.abs(Math.round(lastD)) + " last game" : ""}</small></div></div>`; }).join("")}</div>`;
    h += `<div class="pick" style="margin-top:14px"><select id="eloWho" aria-label="Elo chart member">${rows.map(r => `<option value="${esc(r.uid)}"${r.uid === st.eloWho ? " selected" : ""}>${esc(ownerName(r.uid))}</option>`).join("")}</select></div>`;
    h += eloChart(rows.find(r => r.uid === st.eloWho));
    h += `<details class="explain"><summary>How Elo works</summary><p>Every member starts at 1500. After each game, the winner takes points from the loser. The swap is bigger when the underdog wins and bigger for a lopsided score, so beating the top team by 40 moves you more than beating the last-place team by 2.</p><p>Every game counts: regular season, playoffs, and the toilet bowl. Between seasons every rating moves a third of the way back toward 1500, so last year matters but does not lock anyone in. New members start at 1500.</p></details>`;
    return h;
  }

  function eloChart(r) {
    if (!r) return "";
    const pts = r.hist.filter(x => !x.carry);
    if (pts.length < 2) return "";
    const W = 340, H = 210, L = 38, B = 28, T = 14, Rr = 10;
    const vals = pts.map(p => p.elo).concat([1500]);
    const lo = Math.floor(Math.min(...vals) / 50) * 50, hi = Math.ceil(Math.max(...vals) / 50) * 50;
    const x = i => L + (i / (pts.length - 1)) * (W - L - Rr), y = v => H - B - ((v - lo) / (hi - lo || 1)) * (H - B - T);
    let g = "";
    for (let v = lo; v <= hi; v += 50) g += `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    g += `<line class="ref" x1="${L}" x2="${W - Rr}" y1="${y(1500)}" y2="${y(1500)}"/><text class="zone" x="${W - Rr}" y="${y(1500) - 5}" text-anchor="end">Average, 1500</text>`;
    let prevYear = null;
    pts.forEach((p, i) => { if (p.year !== prevYear) { g += `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="tick" x="${x(i) + 3}" y="${H - B + 15}">${esc(p.year)}</text>`; prevYear = p.year; } });
    g += `<path class="line" d="${pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.elo).toFixed(1)}`).join(" ")}"/>`;
    const last = pts[pts.length - 1];
    g += `<circle class="dot" cx="${x(pts.length - 1)}" cy="${y(last.elo)}" r="5"/>`;
    if (r.peak) { const pi = pts.findIndex(p => p.year === r.peak.year && p.week === r.peak.week && Math.abs(p.elo - r.peak.elo) < 0.01); if (pi >= 0) g += `<circle class="dot" cx="${x(pi)}" cy="${y(r.peak.elo)}" r="4"/><text class="dlabel" x="${x(pi)}" y="${y(r.peak.elo) - 9}" text-anchor="${pi > pts.length * 0.75 ? "end" : "middle"}">Peak ${Math.round(r.peak.elo)}</text>`; }
    return `<figure class="chart"><figcaption><b>${esc(ownerName(r.uid))}'s Elo, game by game</b><span class="muted sm">Each step is one game. Vertical lines mark new seasons.</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Elo rating over time for ${esc(ownerName(r.uid))}">${g}</svg></figure>`;
  }

  /* ---------- Draft Day ---------- */
  // Draft Day data, cached per season. Current season uses trade values; past seasons use position ranks.
  function draftData(s) {
    const key = s.year + ":" + (st.tv ? st.tv.week.week : 0);
    if (st.dCache[key]) return st.dCache[key];
    const live = !!(st.tv && s === st.model.latest && String(st.tv.week.season) === String(s.year));
    const picks = draftPicks(s, live ? st.tv.cons : null, st.model.players || {}, live ? st.model.injuries : null);
    const cards = draftCards(s, picks);
    const trend = live ? draftTrend(s, st.tv.hist, st.model.players || {}) : null;
    return (st.dCache[key] = { live, picks, cards, trend });
  }
  const gradeTag = g => `<span class="grade g-${g[0].toLowerCase()}">${esc(g)}</span>`;

  function draft() {
    const s = season();
    const d = s.drafted;
    if (!d.length) return `<p class="empty">No draft found for ${esc(s.year)}.</p>`;
    const D = draftData(s), live = D.live;
    const how = live ? `each pick's trade value today against the value expected at that pick` : `where each player finished at his position against where he was drafted at it, by points per game played`;
    let h = sec("Draft Day", `${esc(s.year)} draft, judged by ${how}. Kickers and defenses are left out.`);
    if (live) h += asOfBanner();
    const healthy = D.picks.filter(p => !p.hurt);
    const steals = healthy.filter(p => p.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 5);
    const busts = healthy.filter(p => p.round <= 3 && p.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 5);
    const pline = p => `<div class="row"><div><b>${pn(p.player_id || p.pid, p.name)}</b> <span class="muted">${esc(p.position)}, ${esc(ownerName(p.uid))}, pick ${p.pick_no}</span></div><div class="r ${p.gap > 0 ? "w" : "l"}">${live ? sign(p.gap) : (p.gap > 0 ? "+" : "") + p.gap}<small>${live ? `worth ${f1(p.val)}, pick expects ${f1(p.exp)}` : `drafted ${esc(p.position)}${p.draftPos}, finished ${esc(p.position)}${p.finishPos}`}</small></div></div>`;
    h += `<div class="cols"><div><h3>Loaves and fishes</h3><p class="fine top">Picks that fed a multitude: ${live ? "the most value over what the pick should bring" : "the biggest climbs above where they were drafted at their position"}.</p><div class="list">${steals.map(pline).join("") || '<p class="empty">None yet.</p>'}</div></div><div><h3>Built on sand</h3><p class="fine top">First three rounds, healthy, and washed out anyway.</p><div class="list">${busts.map(pline).join("") || '<p class="empty">None. Every early pick held up.</p>'}</div></div></div>`;
    // The Prayer List: early picks lost to injury
    const rank = p => (p.status === "IR" || p.status === "Out" || p.status === "PUP" ? 0 : 1);
    const pray = D.picks.filter(p => p.hurt && p.round <= 6).sort((a, b) => rank(a) - rank(b) || b.zero - a.zero || a.pick_no - b.pick_no);
    h += `<h3>The prayer list</h3><p class="fine top">Picks from the first six rounds lost to injury. Lift them up.</p>`;
    if (!pray.length) h += `<p class="empty">Nobody on it. Praise be.</p>`;
    else {
      const show = st.prayAll ? pray : pray.slice(0, 8);
      h += `<div class="list">${show.map(p => `<div class="row"><div><b>${pn(p.player_id || p.pid, p.name)}</b> <span class="muted">${esc(p.position)}, ${esc(ownerName(p.uid))}, pick ${p.pick_no}</span>${p.status ? ` <span class="inj">${esc(p.status)}</span>` : ""}</div><div class="r">${p.zero ? `${p.zero} ${p.zero === 1 ? "week" : "weeks"}<small>with zero points</small>` : `${esc(p.status || "")}<small>Sleeper status</small>`}</div></div>`).join("")}</div>`;
      if (pray.length > show.length) h += `<button type="button" class="go-btn" data-prayall="1">Show all ${pray.length}</button>`;
      h += `<p class="fine">Weeks missed are estimated: weeks a player scored zero while on a league roster, ${s.year in NFL_BYES ? "byes excluded" : "one assumed bye removed"}. Time spent unrostered is not counted.${live ? " Status comes from Sleeper." : ""}</p>`;
    }
    h += sowerBlock(s, D);
    const totals = {};
    d.forEach(p => { totals[p.uid] = (totals[p.uid] || 0) + p.seasonPts; });
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    h += `<h3>The harvest</h3><p class="fine top">Total points from each member's draft class, wherever those players ended up.</p><div class="list">`;
    ranked.forEach(([uid, pts], i) => { h += `<div class="row"><div><span class="rank">${i + 1}</span>${whoInline(uid, s)}</div><div class="r">${f1(pts)}</div></div>`; });
    h += `</div>`;
    const slots = [];
    d.filter(p => p.round === 1).sort((a, b) => a.pick_no - b.pick_no).forEach(p => slots.push(p.uid));
    const rounds = Math.max(...d.map(p => p.round));
    const valOf = pid => (live && st.tv.cons.byPid[pid] ? st.tv.cons.byPid[pid].value : null);
    h += `<h3>Draft board</h3>${live ? '<p class="fine top">Each cell shows points so far, then trade value today.</p>' : ""}<div class="scroll"><table class="data board"><thead><tr><th>Rd</th>${slots.map(uid => `<th class="l-al">${esc(ownerName(uid))}</th>`).join("")}</tr></thead><tbody>`;
    for (let r = 1; r <= rounds; r++) {
      h += `<tr><td>${r}</td>`;
      slots.forEach(uid => { const p = d.find(x => x.round === r && x.uid === uid); const vv = p ? valOf(p.player_id) : null; h += p ? `<td class="pk">${esc(p.name)}<span>${esc(p.position)}, ${f1(p.seasonPts)}${vv != null ? ` · value ${f1(vv)}` : ""}</span></td>` : `<td class="pk muted">·</td>`; });
      h += `</tr>`;
    }
    return h + `</tbody></table></div>`;
  }

  // The Sower: one report card per draft class (Matthew 13)
  function sowerBlock(s, D) {
    const live = D.live, unit = live ? "value" : "spots";
    let h = sec("The Sower", `"Some fell on good soil, where it produced a crop." Matthew 13:8. Each draft class, graded on a curve against the league${live ? ", and regraded every week as values move" : ""}.`);
    const prevG = live && D.trend && D.trend.length > 1 ? D.trend[D.trend.length - 2] : null;
    D.cards.forEach(c => {
      const was = prevG && prevG.grades[c.uid] && prevG.grades[c.uid] !== c.grade ? `<span class="sw-was">Was ${esc(prevG.grades[c.uid])} in week ${prevG.week}</span>` : "";
      const gave = live ? c.dropped.filter(p => p.val >= 20).sort((a, b) => b.val - a.val) : [];
      const fmt = x => (live ? f1(x) : String(Math.round(x)));
      const sumV = arr => (live ? ` (${f1(arr.reduce((a, p) => a + p.val, 0))})` : "");
      h += `<details class="sower${c.uid === st.me ? " me" : ""}"><summary><span class="sw-top">${gradeTag(c.grade)}<span class="sw-who">${whoInline(c.uid, s)}${was}</span><span class="sw-gap ${c.gap >= 0 ? "w" : "l"}">${c.gap >= 0 ? "+" : ""}${fmt(c.gap)}<small>${unit}</small></span></span>`;
      h += `<span class="sw-fates"><span>Good soil <b>${c.kept.length}</b>${sumV(c.kept)}</span><span>Carried off <b>${c.traded.length}</b>${sumV(c.traded)}</span><span>Rocky ground <b>${c.dropped.length}</b>${sumV(c.dropped)}</span><span>Among thorns <b>${c.thorns.length}</b></span><span class="sw-tap">Tap for every pick</span></span></summary>`;
      h += `<div class="sw-body">`;
      if (gave.length) h += `<p class="fine">Gave away for nothing: ${gave.slice(0, 3).map(p => `${esc(p.name)} (dropped${p.fate.week ? " week " + p.fate.week : ""}, now worth ${f1(p.val)})`).join(", ")}.</p>`;
      if (live && c.thornCost >= 5) h += `<p class="fine">Thorns cost this class ${f1(c.thornCost)} points of value.</p>`;
      h += `<div class="list">${c.picks.map(p => { const f = p.fate.kind === "kept" ? "Good soil" : p.fate.kind === "traded" ? `Carried off${p.fate.to ? " to " + esc(ownerName(p.fate.to)) : ""}` : `Rocky ground${p.fate.week ? ", week " + p.fate.week : ""}`; return `<div class="row"><div><b>${esc(p.name)}</b> <span class="muted">${esc(p.position)}, pick ${p.pick_no}. ${f}${p.hurt ? ". Among thorns" : ""}</span></div><div class="r ${p.gap >= 0 ? "w" : "l"}">${p.gap >= 0 ? "+" : ""}${fmt(p.gap)}<small>${live ? `worth ${f1(p.val)}` : `${esc(p.position)}${p.draftPos} to ${esc(p.position)}${p.finishPos}`}</small></div></div>`; }).join("")}</div></div></details>`;
    });
    h += `<details class="explain"><summary>How the grades work</summary><p>Each pick gets a gap. ${live ? "This season, the gap is the player's trade value today minus the value expected at his pick, read from the same 100-point curve as the Trade Chart: pick 1 expects 100, pick 12 about 75, pick 50 about 35." : "In past seasons, the gap is how many spots he finished above or below where he was drafted at his position, by points per game played."} A class's score is the sum of its gaps.</p><p>Grades are on a curve: an A means well above the league average class, a C below it. So every week somebody gets the top grade and somebody gets the F. Take it up with the Sower.</p><p>Picks count toward the drafter's grade wherever they are now. Good soil means still on his team, carried off means traded, rocky ground means dropped, and among thorns means injured: missed two or more weeks${live ? " or listed by Sleeper as IR, Out, PUP, or Doubtful" : ""}.</p></details>`;
    return h;
  }

  /* ---------- Waiver Wire ---------- */
  function moves() {
    const s = season();
    const m = s.moves;
    if (!m.some(x => x.type !== "trade")) return sec("Waiver Wire", "") + `<p class="empty">No waiver or free agent moves recorded for ${esc(s.year)}.</p>`;
    let h = sec("Waiver Wire", `${esc(s.year)} pickups, drops, and claims.`);
    const adds = m.filter(x => (x.type === "waiver" || x.type === "free_agent") && x.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 8);
    h += `<h3>Found sheep</h3><p class="fine top">Best pickups, counting only weeks the player started for the team that added him.</p>`;
    h += adds.length ? `<div class="list">${adds.map(x => `<div class="row"><div><b>${esc(x.name)}</b> <span class="muted">${esc(x.pos)}, ${esc(teamIn(x.uid, s))}${x.dropped.length ? ", dropped " + esc(x.dropped.join(", ")) : ""}</span></div><div class="r">${f1(x.pts)}<small>added week ${x.week}</small></div></div>`).join("")}</div>` : `<p class="empty">No pickup has scored in a starting lineup yet.</p>`;
    h += gleanBlock(s);
    h += wireBlock(s);
    const count = {};
    m.filter(x => x.type === "waiver" || x.type === "free_agent").forEach(x => { count[x.uid] = (count[x.uid] || 0) + 1; });
    const busy = Object.entries(count).sort((a, b) => b[1] - a[1]);
    h += prodigalBlock(s);
    h += sec("Never Misses a Wednesday", `Most waiver and free agent adds in ${esc(s.year)}.`) + `<div class="list">${busy.map(([uid, n]) => `<div class="row"><div>${whoInline(uid, s)}</div><div class="r">${n} ${n === 1 ? "add" : "adds"}</div></div>`).join("")}</div>`;
    return h;
  }

  /* ---------- Trades ---------- */
  // Trade Desk: one hub over the Advisor, the Trade Chart, and the trade Ledger
  const deskBar = v => `<div class="desk"><div class="desk-t"><b>Trade Desk</b><span class="muted sm">"Give, and it will be given to you." Luke 6:38</span></div><nav class="seg" aria-label="Trade Desk">${[["advisor", "Advisor"], ["chart", "Chart"], ["trades", "Ledger"]].map(([k, l]) => `<a href="#${k}"${k === v ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav></div>`;
  function trades() {
    const s = season();
    let h = deskBar("trades") + sec("Trades", `${esc(s.year)} trades, plus the all-time trade ledger.`);
    const m = s.moves;
    h += ledgerBlock(s);
    const trades = m.filter(x => x.type === "trade");
    const live = !!(st.tv && s === st.model.latest && String(st.tv.week.season) === String(s.year));
    const TS = live && trades.length ? scalesData(s) : null;
    if (TS) h += scalesBlock(s, TS);
    h += sec("Potluck Swaps", `Every ${esc(s.year)} trade, newest first.${TS ? " Each one weighed two ways: points so far, and value today." : ""}`);
    if (!trades.length) h += `<p class="empty">No trades this season.</p>`;
    trades.slice().reverse().forEach(t => {
      h += `<div class="trade"><div class="muted sm">Week ${t.week}</div><div class="sides">`;
      t.sides.forEach(x => {
        h += `<div class="side"><b>${esc(teamIn(x.uid, s))}</b> <span class="muted">received</span><ul>${x.got.map(p => `<li>${pn(p.pid, p.name)} <span class="muted">${esc(p.pos)}, ${f1(p.pts)}</span></li>`).join("")}${x.picks.map(p => `<li class="muted">${esc(p)} pick</li>`).join("")}</ul><div class="${x.net > 0 ? "w" : x.net < 0 ? "l" : "muted"} sm">${f1(x.total)} in, ${f1(x.given)} out, net ${sign(x.net)}</div>${(() => { const ix = pIdx(); if (!ix || ix.season !== s || !x.got.length) return ""; let g = 0, n = 0; x.got.forEach(p => { const L = playerLine(ix, p.pid, { from: t.week }); g += L.sum.gap; n += L.sum.n; }); return n ? `<div class="sm ${g > 0 ? "w" : g < 0 ? "l" : "muted"}">Since the trade: ${sign(g)} against projection <span class="muted">(${n} player-${n === 1 ? "week" : "weeks"}, wherever they played)</span></div>` : ""; })()}${x.ring ? '<span class="tag gold flush">Title trade</span>' : ""}</div>`;
      });
      h += `</div>`;
      const r = TS && TS.rows.find(x => x.t === t);
      if (r) h += scaleLine(r, s);
      h += `</div>`;
    });
    return h;
  }

  // Weighed on the Scales (Daniel 5:27): every trade judged again with today's trade values
  function scalesData(s) {
    const key = s.year + ":" + st.tv.week.week;
    return (st.scaleCache[key] = st.scaleCache[key] || tradeScales(s, st.tv.hist));
  }
  function scaleLine(r, s) {
    const pts = Object.entries(r.pts).sort((a, b) => b[1] - a[1])[0];
    const ptsTxt = pts && Math.abs(pts[1]) >= 0.5 ? `${esc(ownerName(pts[0]))} +${f1(pts[1])}` : "even";
    const gap = Math.round(Math.abs(r.ev.diff) * 100);
    const now = r.multi ? (r.favors ? `${esc(r.label)}, ${esc(ownerName(r.favors))} came out furthest ahead; the widest gap is ${gap}%` : `${esc(r.label)}, every team within ${gap}%`) : r.favors ? `${esc(r.label)}, ${esc(ownerName(r.favors))}'s side worth ${gap}% more` : `${esc(r.label)}, ${gap}% apart`;
    const last = st.tv.hist.length > 1 ? r.trend[r.trend.length - 2] : null;
    const moved = last && last.label !== r.label ? ` Was ${esc(last.label.toLowerCase())} in week ${last.week}.` : "";
    const then = r.then && r.then.week !== st.tv.week.week ? ` When made: ${esc(r.then.label.toLowerCase())}, ${Math.round(Math.abs(r.then.diff) * 100)}% apart.` : "";
    return `<p class="scale-line"><span><b>Points so far:</b> ${ptsTxt}.</span> <span><b>Value today:</b> ${now}.${then}${moved}</span></p>`;
  }
  function scalesBlock(s, TS) {
    let h = sec("Weighed on the Scales", `"You have been weighed on the scales and found wanting." Daniel 5:27. Every ${esc(s.year)} trade judged again with this week's trade values, wherever the players are now.`);
    const bal = Object.entries(TS.bal).sort((a, b) => b[1] - a[1]);
    h += `<h3>Value balance</h3><p class="fine top">Value received minus value sent, across every trade this season, using the Trade Advisor's math.</p><div class="list">`;
    bal.forEach(([u, x], i) => { h += `<div class="row${u === st.me ? " me" : ""}"><div><span class="rank">${i + 1}</span>${whoInline(u, s)}</div><div class="r ${x > 0.5 ? "w" : x < -0.5 ? "l" : ""}">${sign(x)}</div></div>`; });
    h += `</div>`;
    const spoiled = TS.rows.filter(r => r.favors && !r.multi).sort((a, b) => Math.abs(b.ev.diff) - Math.abs(a.ev.diff)).slice(0, 3);
    if (spoiled.length) {
      h += `<h3>Spoiled like manna</h3><p class="fine top">Kept overnight, it spoiled (Exodus 16:20). The trades that look most lopsided today.</p><div class="list">`;
      spoiled.forEach(r => { const win = r.favors, lose = win === r.a ? r.b : r.a; const got = (win === r.a ? r.aGets : r.bGets).map(tvName).join(", "), gave = (win === r.a ? r.bGets : r.aGets).map(tvName).join(", "); h += `<div class="row"><div><b>${esc(ownerName(win))}</b> got ${esc(got)} <span class="muted">from ${esc(ownerName(lose))} for ${esc(gave)}, week ${r.t.week}</span></div><div class="r">${Math.round(Math.abs(r.ev.diff) * 100)}%<small>apart today</small></div></div>`; });
      h += `</div>`;
    }
    h += `<details class="explain"><summary>How the scales work</summary><p>Each trade is weighed with this week's trade values, using the same math as the Trade Advisor: values raised to the 1.5 power, plus roster-spot credit for the side that got fewer players. A player counts at today's value even if he was dropped or traded again later, so later moves never change a trade's score.</p><p>Labels are for hindsight, not blame: within 10% is still even, within 30% is leaning, and beyond that it spoiled like manna. A trade can be fair when made and spoil later.</p><p>Points so far is the existing ledger: what each side's new players scored in its starting lineup. Trades undone within 48 hours are ignored everywhere. ${TS.skipped ? `${TS.skipped} trade${TS.skipped === 1 ? "" : "s"} with draft picks or more than two teams ${TS.skipped === 1 ? "is" : "are"} not weighed.` : ""}</p></details>`;
    return h;
  }

  // Gleanings (Ruth 2): this season's pickups against their projections, only weeks on the roster of the member who added them
  function gleanBlock(s) {
    const ix = pIdx(); if (!ix || ix.season !== s) return "";
    const rows = s.moves.filter(m => (m.type === "waiver" || m.type === "free_agent") && !["K", "DEF"].includes(String(m.pos).toUpperCase()) && !(st.model.owners[m.uid] || {}).orphan).map(m => ({ m, L: playerLine(ix, m.pid, { from: m.week, uid: m.uid }) })).filter(x => x.L.sum.n);
    if (!rows.length) return "";
    let h = `<h3>Gleanings</h3><p class="fine top">Pickups against Sleeper's projection, counting only weeks on the roster of the member who added them. Kickers and defenses are left out.</p>`;
    const by = {}; rows.forEach(x => { const b = by[x.m.uid] || (by[x.m.uid] = { uid: x.m.uid, n: 0, gap: 0, wk: 0 }); b.n++; b.gap += x.L.sum.gap; b.wk += x.L.sum.n; });
    const top = rows.slice().sort((a, b) => b.L.sum.gap - a.L.sum.gap).slice(0, 5);
    h += `<div class="list">${top.map(x => `<div class="row"><div><b>${pn(x.m.pid, x.m.name)}</b> <span class="muted">${esc(x.m.pos)}, ${esc(ownerName(x.m.uid))}, week ${x.m.week}</span></div><div class="r ${x.L.sum.gap > 0 ? "w" : "l"}">${sign(x.L.sum.gap)}<small>beat it ${x.L.sum.beat} of ${x.L.sum.n} weeks</small></div></div>`).join("")}</div>`;
    const bl = Object.values(by).sort((a, b) => b.gap - a.gap);
    h += `<details class="explain"><summary>Every member's pickups</summary>${bl.map(b => `<p>${esc(ownerName(b.uid))}: ${b.n} ${b.n === 1 ? "pickup" : "pickups"}, ${b.wk} roster ${b.wk === 1 ? "week" : "weeks"}, <span class="${b.gap > 0 ? "w" : b.gap < 0 ? "l" : ""}">${sign(b.gap)}</span> against projection.</p>`).join("")}</details>`;
    return h;
  }

  function prodigalBlock(s) {
    const list = prodigalSons(st.model, s.year).filter(x => !["K", "DEF"].includes(String(x.pos).toUpperCase())).slice(0, 6);
    let h = sec("The Prodigal Son", `Players dropped in ${esc(s.year)} who came back to score for someone else. Kickers and defenses are left out, since everyone streams them.`);
    if (!list.length) return h + `<p class="empty">No dropped player has started for another team yet.</p>`;
    h += `<div class="list">${list.map(x => `<div class="row"><div><b>${pn(x.pid, x.name)}</b> <span class="muted">${esc(x.pos)}. Dropped by ${esc(ownerName(x.dropper))} in week ${x.week}, mostly started by ${esc(ownerName(x.to))} since.</span></div><div class="r">${f1(x.pts)}<small>best ${f1(x.best.pts)}, week ${x.best.week}</small></div></div>`).join("")}</div>`;
    h += `<p class="fine">Counts points only while the player sat in another team's starting lineup. A player who goes off while unclaimed on waivers does not show up, so this list undercounts.</p>`;
    return h;
  }

  /* ---------- When the Flock Moves ---------- */
  const HOURS = [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3];
  const hrLabel = h => h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h - 12) + "p";
  const hrLong = h => h === 0 ? "midnight" : h === 12 ? "noon" : (h < 12 ? h + " a.m." : (h - 12) + " p.m.");
  const clock = m => { const t = (Math.round(m) + 240) % 1440, h = Math.floor(t / 60), mi = t % 60; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}:${String(mi).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`; };
  const span = m => m >= 60 ? `${(Math.round(m / 6) / 10).toFixed(1)} hrs` : `${Math.round(m)} min`;
  const KIND_WORD = { pickups: ["pickup", "pickups"], add: ["add", "adds"], adddrop: ["add/drop", "add/drops"], drop: ["drop", "drops"], claim: ["claim", "claims"] };
  const kw = (n, k) => KIND_WORD[k || st.wireKind][n === 1 ? 0 : 1];
  const minFor = k => k === "claim" ? 10 : 15;
  const heatLvl = (v, max) => v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(v / max) * 5));

  function wireBlock(s) {
    const year = st.wireScope === "season" ? s.year : null;
    const W = wireStats(st.model, st.wireKind, year);
    const min = minFor(st.wireKind);
    const rows = W.rows.slice().sort((a, b) => ((a.n < min) - (b.n < min)) || a.med - b.med);
    const elig = rows.filter(r => r.n >= min);
    let h = sec("When the Flock Moves", "What time of day each member works the waiver wire, in Central time.");
    h += `<div class="wire-filters"><div class="seg" role="group" aria-label="Move type">${[["pickups", "Pickups"], ["add", "Adds"], ["adddrop", "Add/drops"], ["drop", "Drops"], ["claim", "Claims"]].map(([k, l]) => `<button data-wk="${k}" aria-pressed="${st.wireKind === k}">${l}</button>`).join("")}</div></div>`;
    h += `<div class="chips" role="group" aria-label="Seasons"><button data-ws="all" aria-pressed="${!year}">All seasons</button><button data-ws="season" aria-pressed="${!!year}">${esc(s.year)} only</button></div>`;
    const defs = { pickups: "Free agent pickups: adds plus add/drops.", add: "Free agent adds into an open roster spot.", adddrop: "Free agent pickups that also dropped a player.", drop: "Releases with no pickup.", claim: "Waiver claims. The time shown is when the claim was entered." };
    h += `<p class="fine top">${defs[st.wireKind]} ${W.total.toLocaleString()} ${kw(W.total)} in this range.</p>`;
    if (!W.total) return `<section class="wire-sec">${h}<p class="empty">No ${kw(2)} in this range.</p></section>`;

    // Awards
    const aw = [];
    const pick = (f, dir) => elig.slice().sort((a, b) => dir * (f(b) - f(a)))[0];
    if (elig.length >= 2) {
      const rooster = pick(r => r.med, -1); if (rooster.med < 360) aw.push(["Up Before the Rooster", ownerName(rooster.uid), clock(rooster.med), `Earliest median ${kw(1)}`]);
      const owls = elig.filter(r => (r.blocks.night || 0) >= 5).sort((a, b) => b.share("night") - a.share("night")); const night = owls[0]; if (night) aw.push(["Night Watchman", ownerName(night.uid), Math.round(night.share("night") * 100) + "%", `of his ${kw(2)} after 11 p.m. (${night.blocks.night} total)`]);
      const clockw = pick(r => r.p75 - r.p25, -1); aw.push(["Clockwork", ownerName(clockw.uid), span(clockw.p75 - clockw.p25), `Most predictable: half his ${kw(2)} fall in this window`]);
      const spirit = pick(r => r.p75 - r.p25, 1); aw.push(["Whenever the Spirit Moves", ownerName(spirit.uid), span(spirit.p75 - spirit.p25), "Least predictable: the widest window"]);
      if (st.wireKind === "claim") { const late = pick(r => r.med, 1); aw.push(["The Night Before", ownerName(late.uid), clock(late.med), "Latest median claim time"]); }
    }
    const busy = rows.slice().sort((a, b) => b.perSeason - a.perSeason)[0];
    if (busy) aw.push([st.wireKind === "drop" ? "Cut Ties" : st.wireKind === "claim" ? "Claims Department" : "Busiest Hands", ownerName(busy.uid), f1(busy.perSeason), `${kw(2)} per season`]);
    if (st.wireKind === "drop") { const cr = Object.entries(W.quickDrops).sort((a, b) => b[1] - a[1])[0]; if (cr) aw.push(["Catch and Release", ownerName(cr[0]), String(cr[1]), "Players dropped within a day of adding them"]); }
    h += `<div class="awards">${aw.map(([t, n, v, d]) => `<div class="award"><span class="t">${esc(t)}</span><span class="v sm">${esc(v)}</span><span class="n">${esc(n)}</span><span class="d">${esc(d)}</span></div>`).join("")}</div>`;
    if (elig.length < 2) h += `<p class="fine">Time-of-day awards need at least two members with ${min} or more ${kw(2)} in this range.</p>`;
    else h += `<p class="fine">Time-of-day awards need at least ${min} ${kw(2)} in this range.</p>`;

    h += personHeat(rows, min);
    h += rangePlot(rows, min);
    h += countBars(rows);
    h += weekHeat(W.grid);
    h += blockTable(rows, min);
    return `<section class="wire-sec">${h}</section>`;
  }

  function heatAxis(x0, cw, y) { return [4, 8, 12, 16, 20, 0].map(hh => `<text class="tick" x="${x0 + HOURS.indexOf(hh) * cw}" y="${y}">${hrLabel(hh)}</text>`).join(""); }

  function personHeat(rows, min) {
    const share = st.wireMode === "share";
    const W = 340, L = 62, cw = (W - L - 2) / 24, rh = 18, top = 18;
    const H = top + rows.length * rh + 4;
    const gmax = Math.max(1, ...rows.flatMap(r => r.hours));
    let g = heatAxis(L, cw, 11);
    rows.forEach((r, i) => {
      const y = top + i * rh, rmax = Math.max(1, ...r.hours);
      const small = r.n < min;
      g += `<text class="rowname${small ? " dim" : ""}" x="${L - 6}" y="${y + 12}" text-anchor="end">${esc(ownerName(r.uid))}${small ? "*" : ""}</text>`;
      HOURS.forEach((hh, j) => {
        const v = r.hours[hh], lvl = heatLvl(v, share ? rmax : gmax);
        const tip = `${ownerName(r.uid)}, ${hrLong(hh)} hour: ${v} ${kw(v)}, ${Math.round((v / r.n) * 100)}% of his total`;
        g += `<rect class="hc h${lvl}" x="${L + j * cw + 0.5}" y="${y + 1}" width="${cw - 1.5}" height="${rh - 3}" rx="2" data-tip="${esc(tip)}"/>`;
      });
      if (r.uid === st.me) g += `<rect class="merow" x="${L - 1}" y="${y}" width="${24 * cw + 1}" height="${rh - 1}" rx="3"/>`;
    });
    const legend = `<div class="hlegend"><span>Fewer</span>${[1, 2, 3, 4, 5].map(l => `<i class="h${l}"></i>`).join("")}<span>More</span></div>`;
    const elig = rows.filter(r => r.n >= min);
    let peakTxt = "";
    if (elig.length) { const byH = Array(24).fill(0); elig.forEach(r => r.hours.forEach((v, i) => { byH[i] += v; })); const ph = byH.indexOf(Math.max(...byH)); const owl = elig.slice().sort((a, b) => b.med - a.med)[0], lark = elig.slice().sort((a, b) => a.med - b.med)[0]; peakTxt = `<p class="takeaway">The ${hrLong(ph)} hour is the busiest. ${esc(ownerName(lark.uid))} gets going first, and ${esc(ownerName(owl.uid))} runs latest.</p>`; }
    return `<h3>Hour by hour</h3>${peakTxt}<div class="chips" role="group" aria-label="Heatmap scale"><button data-wm="share" aria-pressed="${share}">Each member's pattern</button><button data-wm="count" aria-pressed="${!share}">Raw counts</button></div>
      <figure class="chart"><figcaption><span class="muted sm">${share ? "Each row is shaded against that member's own busiest hour, so light users show a pattern too." : "Every row uses one scale, so heavy users stand out."} Sorted from earliest median time to latest. Tap a square for the count.${rows.some(r => r.n < min) ? ` * Fewer than ${min} ${kw(2)}.` : ""}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heatmap of ${kw(2)} by member and hour">${g}</svg>${legend}</figure>`;
  }

  function rangePlot(rows, min) {
    const list = rows.filter(r => r.n >= 5);
    const left = rows.filter(r => r.n < 5);
    if (!list.length) return "";
    const W = 340, L = 62, R = 8, rh = 22, top = 18, H = top + list.length * rh + 6;
    const x = m => L + (m / 1440) * (W - L - R);
    let g = [0, 240, 480, 720, 960, 1200, 1440].map(m => `<line class="grid" x1="${x(m)}" x2="${x(m)}" y1="${top - 4}" y2="${H - 4}"/>`).join("");
    g += [0, 240, 480, 720, 960, 1200].map(m => `<text class="tick" x="${x(m)}" y="11" text-anchor="${m === 0 ? "start" : "middle"}">${hrLabel((m / 60 + 4) % 24)}</text>`).join("");
    list.forEach((r, i) => {
      const y = top + i * rh + rh / 2, me = r.uid === st.me, small = r.n < min;
      const tip = `${ownerName(r.uid)}: median ${clock(r.med)}, middle half from ${clock(r.p25)} to ${clock(r.p75)}, ${r.n} ${kw(r.n)}`;
      g += `<text class="rowname${small ? " dim" : ""}" x="${L - 6}" y="${y + 4}" text-anchor="end">${esc(ownerName(r.uid))}${small ? "*" : ""}</text>`;
      g += `<g class="pt${me ? " me" : ""}" data-tip="${esc(tip)}"><rect class="hit" x="${L}" y="${y - 10}" width="${W - L - R}" height="20"/><line class="iqr${small ? " dim" : ""}" x1="${x(r.p25)}" x2="${x(r.p75)}" y1="${y}" y2="${y}"/><circle class="dot" cx="${x(r.med)}" cy="${y}" r="${me ? 6 : 5}"/></g>`;
    });
    return `<h3>Your fantasy hour</h3><figure class="chart"><figcaption><span class="muted sm">The dot is each member's median ${kw(1)} time. The bar covers the middle half of his ${kw(2)}: short bars are creatures of habit. The day runs 4 a.m. to 4 a.m.${left.length ? ` Not charted, under 5 ${kw(2)}: ${left.map(r => esc(ownerName(r.uid)) + " (" + r.n + ")").join(", ")}.` : ""}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Median ${kw(1)} time and middle-half range by member">${g}</svg></figure>`;
  }

  function countBars(rows) {
    const avg = st.wireBar === "avg";
    const val = r => avg ? r.perSeason : r.n;
    const list = rows.slice().sort((a, b) => val(b) - val(a));
    const max = Math.max(1, ...list.map(val));
    let h = `<h3>Who works the wire</h3><div class="chips" role="group" aria-label="Bar measure"><button data-wb="avg" aria-pressed="${avg}">Per season</button><button data-wb="total" aria-pressed="${!avg}">Total</button></div>`;
    h += `<div class="bars">${list.map(r => `<div class="bar-row${r.uid === st.me ? " me" : ""}"><span class="bn">${esc(ownerName(r.uid))}</span><span class="bt"><span class="bf" style="width:${Math.max(1.5, (val(r) / max) * 100)}%"></span></span><span class="bv num">${avg ? f1(val(r)) : val(r)}</span></div>`).join("")}</div>`;
    h += `<p class="fine">${avg ? `Per season divides by the seasons each member played${st.wireScope === "season" ? "" : ", so a one-season member is not penalized"}.` : "Total counts every move in the range."}</p>`;
    return h;
  }

  function weekHeat(grid) {
    const W = 340, L = 34, cw = (W - L - 2) / 24, rh = 20, top = 18, H = top + 7 * rh + 4;
    const max = Math.max(1, ...grid.flat());
    let g = heatAxis(L, cw, 11);
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((d, i) => {
      const y = top + i * rh;
      g += `<text class="rowname" x="${L - 6}" y="${y + 13}" text-anchor="end">${d}</text>`;
      HOURS.forEach((hh, j) => { const v = grid[i][hh]; g += `<rect class="hc h${heatLvl(v, max)}" x="${L + j * cw + 0.5}" y="${y + 1}" width="${cw - 1.5}" height="${rh - 3}" rx="2" data-tip="${esc(`${d}, ${hrLong(hh)} hour: ${v} ${kw(v)}`)}"/>`; });
    });
    const legend = `<div class="hlegend"><span>Fewer</span>${[1, 2, 3, 4, 5].map(l => `<i class="h${l}"></i>`).join("")}<span>More</span></div>`;
    let pk = [0, 0, 0]; grid.forEach((row, i) => row.forEach((v, j) => { if (v > pk[0]) pk = [v, i, j]; }));
    const dayTot = grid.map(r => r.reduce((a, b) => a + b, 0)); const quiet = dayTot.indexOf(Math.min(...dayTot));
    const DN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const take = pk[0] ? `<p class="takeaway">Busiest hour of the week: ${DN[pk[1]]}, ${hrLong(pk[2])}, with ${pk[0]} ${kw(pk[0])}. Quietest day: ${DN[quiet]}.</p>` : "";
    return `<h3>The league's week</h3>${take}<figure class="chart"><figcaption><span class="muted sm">All members together. Each day runs 4 a.m. to 4 a.m., so the 12a to 3a columns are the night after.</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heatmap of league ${kw(2)} by weekday and hour">${g}</svg>${legend}</figure>`;
  }

  function blockTable(rows, min) {
    const list = rows.filter(r => r.n >= 5);
    if (!list.length) return "";
    const ok = (r, k) => r.n >= min && (r.blocks[k] || 0) >= 5;
    const pct = v => Math.round(v * 100);
    const best = {}; BLOCKS.forEach(b => { best[b.key] = Math.max(...list.filter(r => ok(r, b.key)).map(r => pct(r.share(b.key))), 0); });
    const short = { early: "Early", office: "Office", supper: "Supper", evening: "Evening", night: "Night" };
    let h = `<h3>Time blocks</h3><p class="fine top">Early Service 4 to 8 a.m. Office Hours 8 a.m. to 5 p.m. Supper 5 to 8 p.m. Evening Worship 8 to 11 p.m. Night Watch 11 p.m. to 4 a.m. Bold marks the leader in each block, among members with ${min} or more ${kw(2)} and at least 5 in that block.</p>`;
    h += `<div class="scroll"><table class="data blocks"><thead><tr><th>Member</th>${BLOCKS.map(b => `<th>${short[b.key]}</th>`).join("")}</tr></thead><tbody>`;
    list.forEach(r => { h += `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><b>${esc(ownerName(r.uid))}</b></td>${BLOCKS.map(b => { const v = r.share(b.key); return `<td${ok(r, b.key) && pct(v) === best[b.key] && best[b.key] > 0 ? ' class="lead"' : ""}>${pct(v)}%</td>`; }).join("")}</tr>`; });
    return h + `</tbody></table></div>`;
  }

  function ledgerBlock(s) {
    const scope = st.tradeScope === "all" ? null : s.year;
    const rows = tradeLedger(st.model, scope);
    let h = sec("The Business Meeting", "The trade ledger. Every trade scored by what the players did after they changed hands.");
    h += `<div class="chips" role="group" aria-label="Trade range"><button data-trade="all" aria-pressed="${!scope}">All seasons</button><button data-trade="season" aria-pressed="${!!scope}">${esc(s.year)} only</button></div>`;
    if (!rows.length) return h + `<p class="empty">No trades in this range.</p>`;
    const busiest = rows.slice().sort((a, b) => b.trades - a.trades)[0];
    h += `<div class="champ plain"><div class="glyph" aria-hidden="true"></div><div><div class="lbl">Most active trader</div><b>${esc(ownerName(busiest.uid))}</b><div class="muted">${busiest.trades} trades, ${signInt(busiest.net)} point balance</div></div></div>`;
    h += `<div class="scroll"><table class="data" data-hide="2,3,6"><thead><tr><th>Member</th><th>Trades</th><th>Pts in</th><th>Pts out</th><th>Balance</th><th>Playoff pts in</th><th class="l-al">Best trade</th></tr></thead><tbody>`;
    rows.forEach(r => {
      const o = st.model.owners[r.uid];
      const best = r.best ? `${esc(r.best.got.join(", ") || "picks")} <span class="muted">${esc(r.best.year)} wk ${r.best.week}, ${sign(r.best.net)}</span>` : "";
      h += `<tr><td class="team"><b>${esc(o.name)}</b>${o.active ? "" : '<span class="tag">Retired</span>'}</td><td>${r.trades}</td><td>${f1(r.pin)}</td><td>${f1(r.pout)}</td><td class="${r.net > 0 ? "w" : r.net < 0 ? "l" : ""}">${sign(r.net)}</td><td>${f1(r.poIn)}${r.rings ? `<span class="tag gold">${r.rings} title ${r.rings === 1 ? "trade" : "trades"}</span>` : ""}</td><td class="team sm">${best}</td></tr>`;
    });
    h += `</tbody></table></div><details class="explain"><summary>How the balance works</summary><p>Pts in is what the players you received scored in your starting lineup after the trade. Pts out is what the players you sent away scored in their new team's starting lineup. Balance is in minus out, so positive means you won your trades on the field.</p><p>Points count through the end of the season of the trade. Bench points and draft picks do not count.</p><p>Raw points miss the trades that win titles, so two more numbers sit beside the balance. Playoff pts in is what your traded-for players scored in your starting lineup in playoff games. A title trade is a trade whose players started for the eventual champion in the playoffs.</p></details>`;
    return h;
  }

  /* ---------- Trade values: shared setup ---------- */
  const POS_CLASS = { QB: "qb", RB: "rb", WR: "wr", TE: "te" };
  const fmtDate = (d, withTime) => { const x = new Date(d); return isNaN(x) ? "" : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) + (withTime ? " at " + x.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : ""); };
  function tvInit(raw) {
    st.tv = null; st.ideaCache = {}; st.shopCache = {};
    if (!st.values || !st.values.weeks || !st.values.weeks.length) return;
    const weeksV = st.values.weeks.slice().sort((a, b) => (a.season + String(a.week).padStart(2, "0")).localeCompare(b.season + String(b.week).padStart(2, "0")));
    const cur = weeksV[weeksV.length - 1];
    const cons = tvConsensus(cur, raw.players || {});
    const hist = weeksV.map(wk => ({ season: wk.season, week: wk.week, cons: wk === cur ? cons : tvConsensus(wk, raw.players || {}) }));
    const prev = hist.length > 1 ? hist[hist.length - 2].cons : null;
    cons.list.forEach(e => { const p = prev && (e.pid ? prev.byPid[e.pid] : prev.list.find(x => x.key === e.key)); e.delta = p ? e.value - p.value : null; });
    const s = st.model.latest; const owner = {};
    Object.entries(s.currentRosters || {}).forEach(([uid, r]) => r.forEach(pid => { owner[pid] = uid; }));
    st.tv = { week: cur, cons, hist, owner, exported: st.model.exported };
    if (!st.trade.a && st.me) st.trade.a = st.me;
  }
  function tvIdeas(uid) {
    if (!st.tv || !uid) return [];
    if (!st.ideaCache[uid]) st.ideaCache[uid] = tvSuggest(st.tv.cons, st.model.latest, uid);
    return st.ideaCache[uid];
  }
  const tvName = pid => { const e = st.tv && st.tv.cons.byPid[pid]; const p = st.model.players && st.model.players[pid]; return e ? e.name : p ? p[0] : pid; };
  const tvPos = pid => { const e = st.tv && st.tv.cons.byPid[pid]; return e ? e.pos : st.model.latest.posOf(pid); };
  const tvV = pid => { const e = st.tv && st.tv.cons.byPid[pid]; return e ? e.value : 0; };
  const posTag = pos => `<span class="pos ${POS_CLASS[pos] || "ot"}">${esc(pos || "")}</span>`;
  const srcBlurb = () => {
    const S = Object.values(st.tv.week.sources), tot = S.reduce((a, x) => a + (x.w != null ? x.w : 1), 0);
    const pct = x => Math.round((x.w != null ? x.w : 1) / tot * 100);
    const eq = S.every(x => pct(x) === pct(S[0]));
    const parts = S.slice().sort((a, b) => pct(b) - pct(a)).map(x => eq ? x.name : `${x.name} (${pct(x)}%)`);
    return parts.length <= 2 ? parts.join(" and ") : parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  };
  const stars = n => n == null ? "" : `<span class="sos" aria-label="Playoff schedule ${n} of 5 stars" title="Playoff schedule, FantasyPros">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
  const injTag = e => { if (!e) return ""; const o = e.pid && st.model.injuries && st.model.injuries[e.pid]; if (o && o.s) return `<span class="inj" title="Sleeper injury status">${esc(o.s)}</span>`; return e.inj ? '<span class="inj" title="Listed as injured by at least one chart">Injured</span>' : ""; };

  function asOfBanner(big) {
    const T = st.tv; if (!T) return "";
    const days = Math.round((new Date(T.exported) - new Date(T.week.loaded + "T12:00:00-05:00")) / 864e5);
    const stale = days > 7;
    const names = Object.values(T.week.sources).map(x => x.name);
    const srcs = names.length <= 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
    return `<div class="asof${stale ? " stale" : ""}${big ? " big" : ""}" role="note"><b>${stale ? "Heads up: these values are " + days + " days older than the rosters" : `Trade values as of Week ${T.week.week}, ${esc(T.week.season)}`}</b><span>Rankings from ${esc(srcs)}, loaded ${esc(fmtDate(T.week.loaded + "T12:00:00-05:00"))}. Rosters from Sleeper as of ${esc(fmtDate(T.exported, true))}.</span></div>`;
  }

  function tvAddToTrade(pid) {
    const own = st.tv.owner[pid];
    if (own && own !== st.me) st.trade = { a: st.me && st.me !== own ? st.me : null, b: own, aGets: [pid], bGets: [] };
    else if (own) st.trade = { a: own, b: null, aGets: [], bGets: [pid] };
    st.goto = "Build a Trade";
    location.hash = "advisor";
  }


  /* ---------- Spiritual Gifts: position-group power rankings ---------- */
  const G_COLOR = { QB: "qb", RB: "rb", WR: "wr", TE: "te", FLEX: "fx", K: "kd", DEF: "kd" };
  function giftsData(s) {
    const played = s.regWeeks.filter(w => s.teamWeeks.some(t => t.week === w && !t.playoff && t.result));
    const curWeek = played.length ? Math.max(...played) + 1 : 1;
    const canCur = !!(st.tv && s === st.model.latest && String(st.tv.week.season) === String(s.year) && !s.complete && s.currentRosters);
    const pj = st.model.projections, projOk = !!(canCur && pj && String(pj.season) === String(s.year) && Number(pj.week) === curWeek && pj.pts && Object.keys(pj.pts).length);
    const opts = (canCur ? [["cur", projOk ? `Week ${curWeek} · projected` : `Week ${curWeek} · this week`], ["ros", "Rest of season · trade value"]] : []).concat(played.length ? [["season", "Season so far"]] : []).concat(played.slice().reverse().map(w => [String(w), `Week ${w} · actual`]));
    if (!opts.length) return { opts, data: null };
    if (!opts.some(o => o[0] === st.gWeek)) st.gWeek = opts[0][0];
    const key = s.year + ":" + st.gWeek;
    const cur = mode => giftsCurrent(st.tv.cons, s, st.model.players || {}, curWeek, { mode, proj: projOk ? pj.pts : null, injuries: st.model.injuries || {} });
    if (!st.gCache[key]) st.gCache[key] = st.gWeek === "cur" ? cur("week") : st.gWeek === "ros" ? cur("ros") : st.gWeek === "season" ? giftsSeason(s) : giftsActual(s, Number(st.gWeek));
    const rk = s.year + ":ros";
    if (canCur && !st.gCache[rk]) st.gCache[rk] = cur("ros");
    const ck = s.year + ":cur"; if (canCur && !st.gCache[ck]) st.gCache[ck] = cur("week");
    return { opts, data: st.gCache[key], curWeek, ros: canCur ? st.gCache[rk] : null };
  }
  const gNum = (data, v) => (data.mode === "current" ? f1(v) : f1(v));
  const gUnit = data => (data.scoring === "proj" ? "proj pts" : data.mode === "current" || data.mode === "ros" ? "value" : data.mode === "season" ? "pts per week" : "pts");
  const G_INJ_SHORT = { Questionable: "Q", Doubtful: "D", Out: "Out", IR: "IR", PUP: "PUP", Sus: "Susp", NA: "NA", DNR: "DNR", COV: "COV" };
  const offInj = pid => { const x = st.model.injuries && st.model.injuries[pid]; return x && x.s ? x.s : null; };
  const gPlayer = pid => { const p = st.model.players && st.model.players[pid]; const e = st.tv && st.tv.cons.byPid[pid]; return p ? p[0] : e ? e.name : "Empty slot"; };
  const gTeamAbbr = pid => { const p = st.model.players && st.model.players[pid]; return p ? (p[1] === "DEF" ? "" : p[2] || "") : ""; };

  /* ---------- Player card: one sheet for any player, opened from any tappable name ---------- */
  function playerCard(pid) {
    const L0 = st.model.latest, info = (st.model.players && st.model.players[pid]) || L0.pinfo(pid) || [pid, "", ""];
    const name = info[0] || pid, pos = info[1] || "", team = info[2] || "";
    const own = Object.entries(L0.currentRosters || {}).find(([, r]) => r.includes(pid));
    const inj = st.model.injuries && st.model.injuries[pid];
    let h = `<div class="pc-h"><div><h2 id="pcTitle">${esc(name)}</h2><p class="muted">${[pos, team].filter(Boolean).map(esc).join(" · ")}${pos || team ? " · " : ""}${own ? `${esc(ownerName(own[0]))}'s roster` : "Free agent"}${inj && inj.s ? ` <span class="inj" title="Sleeper injury status">${esc(inj.s)}</span>` : ""}</p></div><button type="button" class="pc-x" data-pcclose="1" aria-label="Close player card">×</button></div>`;
    { const ns = noteList().filter(n => n.pid === pid); if (ns.length) h += `<div class="pc-sec"><h3>Testimony</h3>${ns.map(n => `<p class="pc-line">${noteTag(n)} ${esc(n.text)}</p>`).join("")}<p class="fine">${noteSource()}</p></div>`; }
    // Trade value
    const e = st.tv && st.tv.cons.byPid[pid];
    if (e) { const tr = tvTier(e.value); h += `<div class="pc-sec"><h3>Trade value</h3><div class="row"><div>${tr ? `Tier ${tr.n} · ${esc(tr.name)}` : ""}<small class="muted pc-sub">Week ${st.tv.week.week} blend</small></div><div class="r">${f1(e.value)}${e.delta != null && Math.abs(e.delta) >= 0.5 ? `<small class="${e.delta > 0 ? "w" : "l"}">${e.delta > 0 ? "▲" : "▼"}${f1(Math.abs(e.delta))} since last week</small>` : ""}</div></div><button type="button" class="linkish" data-pcchart="${esc(e.key)}" data-pcpos="${esc(e.pos)}">Open on the Trade Chart</button>${own && !["K", "DEF"].includes(pos) ? ` <button type="button" class="linkish" data-pcshop="${esc(pid)}" data-pcowner="${esc(own[0])}">Shop this player</button>` : ""}</div>`; }
    // Against projection
    const ix = pIdx(), L = ix ? playerLine(ix, pid) : null;
    if (L) {
      const S = L.sum, byes = w => gByes(L0.year, w).has(team);
      h += `<div class="pc-sec"><h3>${esc(L0.year)} against projection</h3>`;
      h += S.n ? `<p class="pc-line">Projected ${f1(S.proj)}, scored ${f1(S.act)}: <b class="${S.gap > 0 ? "w" : S.gap < 0 ? "l" : ""}">${sign(S.gap)}</b>. Beat it ${S.beat} of ${S.n} ${S.n === 1 ? "week" : "weeks"}.</p><p class="fine top">Within 5 points ${S.within5} of ${S.n}. ${S.over10} ${S.over10 === 1 ? "week" : "weeks"} 10 or more over, ${S.under10} 10 or more under.</p>` : `<p class="fine top">No projected weeks yet.</p>`;
      h += `<div class="wstrip" role="list">${L.weeks.map(x => {
        const bye = byes(x.week) && !x.started && !x.act, d = !bye && x.proj != null && x.act != null ? x.act - x.proj : null;
        const cls = bye ? "bye" : d == null ? "none" : d > 0 ? "up" : d < 0 ? "down" : "even";
        const lab = bye ? "Bye" : d == null ? "–" : sign(d);
        const tip = bye ? `Week ${x.week}: bye` : d == null ? `Week ${x.week}: no projection` : `Week ${x.week}: projected ${f1(x.proj)}, scored ${f1(x.act)}${x.started ? `, started by ${ownerName(x.started)}` : x.uid ? `, on ${ownerName(x.uid)}'s bench` : ", free agent"}`;
        return `<div class="wcell ${cls}${x.started ? " st" : ""}" role="listitem" title="${esc(tip)}" aria-label="${esc(tip)}"><span class="wk">${x.week}</span><span class="wv">${lab}</span></div>`; }).join("")}</div>`;
      h += `<p class="fine">Each box is a week: points over or under Sleeper's projection, scored the league's way. A dot marks weeks he started for someone.${ix.hasAct ? "" : " Weeks off a roster stay blank until the next export."}</p></div>`;
    }
    // Workload (usage)
    const Wk = wkOf(), U = Wk && Wk.players[pid];
    if (U) {
      h += `<div class="pc-sec"><h3>${esc(L0.year)} workload ${roleTag(U.role)}</h3>`;
      h += `<p class="pc-line">Workload points ${f1(U.wpg)} a game, scored ${f1(U.ppg)}: <b class="${U.gap > 0 ? "w" : U.gap < 0 ? "l" : ""}">${sign(U.gap)}</b> over ${U.g} ${U.g === 1 ? "game" : "games"}, ${U.td} ${U.td === 1 ? "touchdown" : "touchdowns"}.</p>`;
      const rows = [];
      if (U.tgt) rows.push(["Target share", shPct(U.tgtSh), U.tgtSh3, U.tgtSh, 0.05], ["Red zone targets", `${U.rzt} (${shPct(U.rztSh)} of the team's)`], ["Catch rate", shPct(U.catchRate)]);
      if (U.pos === "RB") rows.push(["Backfield share", shPct(U.bfSh), U.bfSh3, U.bfSh, 0.10], ["Red zone carries", `${U.rz} (${shPct(U.rbRzSh)} of the backs')`]);
      rows.push(["Snap share", shPct(U.snapSh), U.snapSh3, U.snapSh, 0.10]);
      h += trendCard(U);
      h += `<div class="list">${rows.map(([k, v, n3, base, bar]) => `<div class="row"><div>${k}</div><div class="r">${v}${n3 !== undefined ? `<small class="${moveCls(n3, base, bar)}">last 3 games ${shPct(n3)}</small>` : ""}</div></div>`).join("")}</div>`;
      h += `<div class="wstrip">${U.weeks.map(x => { const d = x.wp != null ? x.act - x.wp : null; const c = d == null ? "none" : d > 0 ? "up" : d < 0 ? "down" : "even"; const t = `Week ${x.w}: ${x.tgt} targets, ${x.att} carries, ${x.tsnp ? Math.round(x.snp / x.tsnp * 100) + "% of snaps" : x.snp + " snaps"}. Workload ${f1(x.wp)}, scored ${f1(x.act)}.`; return `<div class="wcell ${c}" title="${esc(t)}" aria-label="${esc(t)}"><span class="wk">${x.w}</span><span class="wv">${d == null ? "–" : sign(d)}</span></div>`; }).join("")}</div>`;
      h += `<p class="fine">Each box: points scored against Workload points, the points his usage that week is usually worth in this league. Missing weeks are games he did not play.</p></div>`;
    }
    // League story
    const story = [];
    st.model.seasons.slice().reverse().forEach(s => {
      const ev = [];
      const d = (s.drafted || []).find(x => x.player_id === pid);
      if (d) ev.push(`Drafted by ${esc(ownerName(d.uid))}, round ${d.round}, pick ${d.pick_no} overall.`);
      (s.txs || []).filter(tx => (tx.adds && pid in tx.adds) || (tx.drops && pid in tx.drops)).forEach(tx => {
        const to = tx.adds && tx.adds[pid] != null ? s.rosterOwner[tx.adds[pid]] : null, from = tx.drops && tx.drops[pid] != null ? s.rosterOwner[tx.drops[pid]] : null;
        if (tx.type === "trade") ev.push(`Week ${tx.leg}: traded from ${esc(ownerName(from))} to ${esc(ownerName(to))}.`);
        else { if (from) ev.push(`Week ${tx.leg}: dropped by ${esc(ownerName(from))}.`); if (to) ev.push(`Week ${tx.leg}: picked up by ${esc(ownerName(to))}${tx.type === "waiver" ? " on waivers" : ""}.`); }
      });
      const per = {};
      s.teamWeeks.filter(t => (t.roster || []).includes(pid)).forEach(t => { const x = per[t.uid] || (per[t.uid] = { w: 0, st: 0, pts: 0 }); x.w++; const sp = t.starters.find(y => y.pid === pid); if (sp) { x.st++; x.pts += sp.pts || 0; } });
      Object.entries(per).forEach(([u, x]) => ev.push(`With ${esc(ownerName(u))}: ${x.w} ${x.w === 1 ? "week" : "weeks"}, ${x.st} ${x.st === 1 ? "start" : "starts"}, ${f1(x.pts)} points as a starter.`));
      if (ev.length) story.push(`<div class="pc-yr"><b>${esc(s.year)}</b><ul>${ev.map(x => `<li>${x}</li>`).join("")}</ul></div>`);
    });
    h += `<div class="pc-sec"><h3>In this league</h3>${story.length ? story.join("") : `<p class="fine top">Never on a roster in this league.</p>`}</div>`;
    return h;
  }
  let pcOpener = null;
  function openCard(pid, opener) {
    const c = $("pcard"); c.innerHTML = playerCard(pid); c.hidden = false; $("pscrim").hidden = false; c.scrollTop = 0;
    pcOpener = opener || null; document.body.classList.add("pc-open");
    const x = c.querySelector(".pc-x"); if (x) x.focus();
  }
  function closeCard() {
    if ($("pcard").hidden) return;
    $("pcard").hidden = true; $("pscrim").hidden = true; document.body.classList.remove("pc-open");
    if (pcOpener && document.contains(pcOpener)) pcOpener.focus(); pcOpener = null;
  }

  // Player card: this week, last 3, and earlier, over a weekly chart
  function trendCard(U) {
    const T = U.trend; if (!T || T.series.length < 2) return "";
    const lab = TR_NAME[T.key], m = T.move, S = T.series, W = 320, H = 96, L = 26, R = 8, top = 8, bot = 18;
    const maxY = Math.max(0.2, ...S.map(x => x.sh), T.overall || 0) * 1.08;
    const first = S[0].w, last = S[S.length - 1].w, x = w => L + (W - L - R) * (last === first ? 0.5 : (w - first) / (last - first)), y = v => top + (H - top - bot) * (1 - v / maxY);
    const seg = []; S.forEach((p, i) => { if (i && S[i - 1].w === p.w - 1) seg.push(`<line class="line" x1="${x(S[i - 1].w).toFixed(1)}" y1="${y(S[i - 1].sh).toFixed(1)}" x2="${x(p.w).toFixed(1)}" y2="${y(p.sh).toFixed(1)}"/>`); });
    const dots = S.map(p => `<circle class="dot${p.exit ? " lost" : ""}" cx="${x(p.w).toFixed(1)}" cy="${y(p.sh).toFixed(1)}" r="3.5"><title>Week ${p.w}: ${shPct(p.sh)}${p.exit ? ", early exit" : ""}</title></circle>`).join("");
    const avg = T.overall != null ? `<line class="refline" x1="${L}" x2="${W - R}" y1="${y(T.overall).toFixed(1)}" y2="${y(T.overall).toFixed(1)}"/>` : "";
    const ticks = S.map(p => `<text class="tick" x="${x(p.w).toFixed(1)}" y="${H - 5}" text-anchor="middle">${p.w}</text>`).join("");
    const yt = [0, Math.round(maxY * 10) / 20].map(v => `<text class="tick" x="${L - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}</text>`).join("");
    const cell = (k, v) => `<div><span class="mk">${k}</span><span class="tv">${shPct(v)}</span></div>`;
    const line = m ? `<p class="pc-line">${trArrow(U)} ${esc(TR_NAME[m.f])} ${m.up ? "up" : "down"} <b>${f1(Math.abs(m.d) * 100)} points</b>, ${shPct(m.a)} to ${shPct(m.b)}.${m.gone ? ` <span class="tag t-fill">Filling In</span> ${trGone(m.gone)}.` : ""}</p>` : "";
    return `<h3>${esc(lab)} trend</h3><div class="trgrid">${cell("This week", T.now)}${cell("Last 3 games", T.late)}${cell("Earlier", T.early)}</div>${line}<svg class="chart trchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lab)} by week">${avg}${seg.join("")}${dots}${ticks}${yt}</svg><p class="fine">Each dot is a week. The dashed line is his season share.${T.exits.length ? ` An open dot is an early exit (Week ${T.exits.join(", ")}), left out of Last 3 and Earlier.` : ""}</p>`;
  }

  // Movers: risers, fill-ins, and fallers across the league
  function moversBlock(W, nm) {
    const all = Object.values(W.players).filter(p => p.trend && p.trend.move).sort((a, b) => b.trend.move.score - a.trend.move.score);
    if (!all.length) return "";
    const lw = W.weeks[W.weeks.length - 1], groups = [["New Calling", "t-up", all.filter(p => p.trend.move.up && !p.trend.move.gone)], ["Filling In", "t-fill", all.filter(p => p.trend.move.gone)], ["Back Pew", "t-down", all.filter(p => !p.trend.move.up)]];
    const room = st.wMove || "New Calling", cur = groups.find(g => g[0] === room) || groups[0];
    const list = st.wMoveAll ? cur[2] : cur[2].slice(0, 6);
    const row = p => { const m = p.trend.move; return `<div class="row"><div><b>${pn(p.pid, nm(p.pid))}</b> ${trArrow(p)}<div class="muted sm">${esc(p.pos)} · ${esc(p.team)} · ${esc(ownTag(p.pid))}${m.gone ? ` · for ${trGone(m.gone)}` : ""}${p.trend.exits.length ? ` · Week ${p.trend.exits.join(", ")} left out` : ""}</div></div><div class="r ${m.gone ? "" : m.up ? "w" : "l"}">${m.up ? "+" : "−"}${f1(Math.abs(m.d) * 100)}<small>${esc(TR_NAME[m.f])} ${shPct(m.a)} to ${shPct(m.b)}</small></div></div>`; };
    let h = `<h3>Movers</h3><p class="fine top">Last 3 team games against the earlier ones, through Week ${lw}.</p><div class="chips wrap" role="group" aria-label="Movers">${groups.map(g => `<button type="button" data-wmove="${esc(g[0])}" aria-pressed="${g[0] === cur[0]}">${esc(g[0])} ${g[2].length}</button>`).join("")}</div>`;
    h += list.length ? `<div class="list">${list.map(row).join("")}</div>` : `<p class="empty">No one here this week.</p>`;
    if (cur[2].length > 6) h += `<button type="button" class="more-cols" data-wmoveall="1">${st.wMoveAll ? "Show fewer" : `Show ${cur[2].length - 6} more`}</button>`;
    h += `<details class="explain"><summary>How the Movers work</summary><p>Each man's last 3 team games are compared with his earlier games on the same team. A move counts at 5 points of target share or 10 points of rush share, with at least 2 games on each side and 4 touches a game in the window that carries the move.</p><p>One game far under his normal snaps counts as an early exit and is left out of his numbers. Back-to-back low games stay in, because that is a role change.</p><p>A riser becomes Filling In when a teammate with at least 12% of that work missed 2 of the last 3 team games. The status beside the name is today's from Sleeper. "Out of the lineup" means Sleeper lists no injury. Sleeper keeps no injury history by week, so absences are read from usage. A quarterback change is not detected.</p></details>`;
    return h;
  }

  /* ---------- The Laborers: 2026 usage ---------- */
  function work() {
    const s = season();
    let h = sec("The Laborers", "The harvest is plentiful, but the laborers are few. Matthew 9:37. Who gets the work in 2026, and who turns it into points.");
    if (s !== st.model.latest) return h + `<p class="empty">Usage numbers start in 2026.</p>`;
    const W = wkOf();
    if (!W) return h + `<p class="empty">This needs a league export with usage data. Run the export page again and upload the new file.</p>`;
    const nm = pid => s.pinfo(pid)[0] || (st.model.players[pid] || [pid])[0];
    const q = W.quality, wk = W.weeks;
    h += `<p class="fine top">${esc(s.year)}, weeks ${wk[0]} to ${wk[wk.length - 1]}. Shares count only the games a player played.</p>`;
    if (!W.ok) h += `<div class="warn"><b>Rough Workload points.</b> Tested on weeks ${(Object.values(q)[0] || {}).testWeeks ? Object.values(q)[0].testWeeks.join(", ") : ""}, usage explains only ${W.r2Test != null ? Math.round(W.r2Test * 100) : 0}% of weekly scoring so far. Treat them as a loose guide. Shares are exact.</div>`;

    h += moversBlock(W, nm);

    // Leaders
    const pos = st.wPos || "all";
    const pool = Object.values(W.players).filter(p => p.g >= 3 && p.wp != null && (pos === "all" || p.pos === pos)).sort((a, b) => b.wpg - a.wpg);
    h += `<h3>Most work</h3><div class="chips" role="group" aria-label="Position">${[["all", "All"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"]].map(([k, l]) => `<button type="button" data-wpos="${k}" aria-pressed="${pos === k}">${l}</button>`).join("")}</div>`;
    const show = st.wAll ? pool.slice(0, 60) : pool.slice(0, 12);
    h += `<div class="list">${show.map((p, i) => `<div class="row"><div><span class="rank">${i + 1}</span><b>${pn(p.pid, nm(p.pid))}</b> ${trArrow(p)} ${roleTag(p.role)}<div class="muted sm">${esc(p.pos)} · ${esc(p.team)} · ${esc(ownTag(p.pid))} · ${p.g} games, ${p.td} TD</div></div><div class="r">${f1(p.wpg)}<small>scored ${f1(p.ppg)}, <span class="${p.gap > 0 ? "w" : p.gap < 0 ? "l" : ""}">${sign(p.gap / p.g)}</span> a game</small></div></div>`).join("")}</div>`;
    if (pool.length > 12) h += `<button type="button" class="more-cols" data-wall="1">${st.wAll ? "Show fewer" : `Show ${Math.min(60, pool.length) - 12} more`}</button>`;
    h += `<p class="fine">Workload points a game, players with 3 or more games. Green means he scored more than his usage is usually worth; red, less. The gap is mostly touchdowns. An arrow marks a Mover; a tan arrow means he is filling in.</p>`;

    // Team by team
    const teams = [...new Set(Object.values(W.players).map(p => p.team))].filter(t => t && t !== "?").sort();
    if (!st.wTeam || !teams.includes(st.wTeam)) { const mine = st.me ? Object.values(W.players).filter(p => (st.model.latest.currentRosters[st.me] || []).includes(p.pid) && p.pos !== "QB").sort((a, b) => b.wp - a.wp)[0] : null; st.wTeam = mine ? mine.team : teams[0]; }
    const T = wTeam(W, st.wTeam);
    h += `<h3>Team by team</h3><div class="pick"><select id="wTeam" aria-label="NFL team">${teams.map(t => `<option value="${esc(t)}"${t === st.wTeam ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
    { const wo = wWithout(W, st.wTeam, st.model.injuries || {}); if (wo.length) h += `<div class="insight"><span class="dk">With and without</span>${wo.map(x => { const lb = x.f === "att" ? "rush share" : "target share", B = x.best, game = n => `${n} ${n === 1 ? "game" : "games"}`; return `<p>Without <b>${pn(x.star, nm(x.star))}</b> (${trMoved(x)}): <b>${pn(B.pid, nm(B.pid))}</b> ${shPct(B.x)} ${lb} in ${game(B.nx)}. With him: ${shPct(B.y)} in ${game(B.ny)}.</p>`; }).join("")}</div>`; }
    const bar = (segs, label) => `<div class="wbar" role="img" aria-label="${esc(label)}">${segs.map(x => `<span class="${x.cls}" style="width:${Math.max(0, x.sh * 100).toFixed(1)}%" title="${esc(x.t)}"></span>`).join("")}</div>`;
    const top = T.tree.slice(0, 5), restSh = Math.max(0, 1 - top.reduce((a, x) => a + x.sh, 0));
    const lead = T.tree[0];
    if (lead) {
      const second = T.tree[1];
      const tk = lead.p.tgtSh >= 0.25 ? `${nm(lead.p.pid)} is the alpha: ${shPct(lead.p.tgtSh)} of the targets in his games, ${shPct(lead.p.rztSh)} of the red zone targets.` : second && lead.sh - second.sh < 0.04 ? `No clear top target: ${nm(lead.p.pid)} and ${nm(second.p.pid)} split the looks.` : `${nm(lead.p.pid)} leads with ${shPct(lead.p.tgtSh)} of the targets in his games.`;
      h += `<p class="takeaway">${esc(tk)}</p>${bar(top.map(x => ({ cls: POS_CLASS[x.p.pos] ? "s-" + POS_CLASS[x.p.pos] : "s-ot", sh: x.sh, t: `${nm(x.p.pid)} ${shPct(x.sh)}` })).concat([{ cls: "s-rest", sh: restSh, t: `Everyone else ${shPct(restSh)}` }]), `Target share for ${st.wTeam}`)}`;
      h += `<div class="list">${T.tree.slice(0, 6).map(x => `<div class="row"><div><b>${pn(x.p.pid, nm(x.p.pid))}</b> ${trArrow(x.p)} ${roleTag(x.p.role)}<div class="muted sm">${esc(x.p.pos)} · ${esc(ownTag(x.p.pid))} · red zone ${shPct(x.p.rztSh)} · catch rate ${shPct(x.p.catchRate)}</div></div><div class="r">${shPct(x.p.tgtSh)}<small class="${moveCls(x.sh3, x.sh, 0.05)}">last 3 games ${shPct(x.sh3)}</small></div></div>`).join("")}</div>`;
      h += `<p class="fine">The bar splits all ${T.tgt} ${st.wTeam} targets over ${T.games} games. The number is his share in the games he played. Last 3 is green when up 5 points or more, red when down 5 or more.</p>`;
    }
    { const Q = wQbSplits(W, st.wTeam); if (Q) { const last = pid => { const a = String(nm(pid)).replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/, "").split(" "); return a[a.length - 1]; };
      h += `<h3>QB splits</h3><div class="scroll"><table class="data"><thead><tr><th>Target share</th>${Q.qbs.map(q => `<th>${esc(last(q.pid))} (${q.ws.length})</th>`).join("")}</tr></thead><tbody>${Q.rows.map(r => `<tr><td class="team">${pn(r.pid, nm(r.pid))}</td>${r.cells.map(c => `<td>${shPct(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="fine">Target share in the games he played with each starter. The number in each heading is that starter's games, so one game is a small sample. The starter has the most pass attempts, and a game where a second QB threw 10 or more is left out.</p>`; } }
    if (T.field.length) {
      const f0 = T.field[0], f1b = T.field[1];
      const tk = f0.p.role === "Workhorse" || f0.sh >= 0.7 ? `${nm(f0.p.pid)} is a workhorse: ${shPct(f0.sh)} of the backfield's Workload points.` : f1b && f0.sh < 0.55 ? `A committee: ${nm(f0.p.pid)} ${shPct(f0.sh)}, ${nm(f1b.p.pid)} ${shPct(f1b.sh)}.` : `${nm(f0.p.pid)} leads the backfield with ${shPct(f0.sh)} of its Workload points.`;
      const vul = T.field.find(x => x.p.role === "Vulture");
      h += `<h3>Backfield</h3><p class="takeaway">${esc(tk)}${vul ? ` ${esc(nm(vul.p.pid))} vultures the red zone.` : ""}</p>${bar(T.field.slice(0, 4).map((x, i) => ({ cls: "s-b" + i, sh: x.sh, t: `${nm(x.p.pid)} ${shPct(x.sh)}` })), `Backfield split for ${st.wTeam}`)}`;
      h += `<div class="list">${T.field.slice(0, 4).map(x => `<div class="row"><div><b>${pn(x.p.pid, nm(x.p.pid))}</b> ${trArrow(x.p)} ${roleTag(x.p.role)}<div class="muted sm">${esc(ownTag(x.p.pid))} · carries ${shPct(x.p.rbAttSh)} · targets ${shPct(x.p.rbTgtSh)} · red zone ${shPct(x.p.rbRzSh)}</div></div><div class="r">${shPct(x.sh)}<small class="${moveCls(x.sh3, x.sh, 0.10)}">last 3 games ${shPct(x.sh3)}</small></div></div>`).join("")}</div>`;
      h += `<p class="fine">Backfield share is each back's part of the running backs' Workload points, so a target counts for more than a carry. Carries, targets, and red zone are shares among the backs.</p>`;
    }

    // Luck of the draw: members' starters, points against Workload points
    const by = {};
    W.lines.forEach(l => { const ix = pIdx(); const u = ix && ix.startOf[l.w] && ix.startOf[l.w][l.pid]; if (!u || l.wp == null) return; const b = by[u] || (by[u] = { uid: u, wp: 0, act: 0, td: 0, n: 0 }); b.wp += l.wp; b.act += l.y; b.td += l.td; b.n++; });
    const lu = Object.values(by).map(b => ({ ...b, gap: b.act - b.wp })).sort((a, b) => b.gap - a.gap);
    if (lu.length) {
      h += `<h3>Luck of the draw</h3><p class="takeaway">${esc(ownerName(lu[0].uid))}'s starters outscored their workload by ${f1(lu[0].gap)} points. ${esc(ownerName(lu[lu.length - 1].uid))}'s came up ${f1(Math.abs(lu[lu.length - 1].gap))} short.</p>`;
      h += `<div class="list">${lu.map(b => `<div class="row${b.uid === st.me ? " me-row" : ""}"><div>${whoInline(b.uid, s)}<div class="muted sm">${f1(b.wp)} Workload points, ${b.td} touchdowns</div></div><div class="r ${b.gap > 0 ? "w" : b.gap < 0 ? "l" : ""}">${sign(b.gap)}<small>${f1(b.act)} scored</small></div></div>`).join("")}</div>`;
      h += `<p class="fine">Starters only. Quarterbacks, kickers, and defenses are left out. Points above the workload mostly come from touchdowns and long plays, which rarely repeat at the same rate.</p>`;
    }

    // Method
    const val = (pos, f, mult) => W.models[pos] && W.models[pos].w[f] != null ? f2(W.models[pos].w[f] * (mult || 1)) : "–";
    const qs = Object.entries(q).map(([k, x]) => `${k} ${x.r2Test != null ? Math.round(x.r2Test * 100) + "%" : "not tested"}`).join(", ");
    h += `<details class="explain"><summary>How Workload points work</summary><p>Workload points are the points a player's usage is usually worth in this league, scored the league's way, first downs included. They are fitted each week from every 2026 game: league points against targets, red zone targets, carries, and red zone carries, by position. Quarterbacks are left out, because nearly every dropback is theirs and their points come mostly from efficiency.</p><p>What usage is worth right now: for wide receivers a target is ${val("WR", "tgt")} points and a red zone target adds ${val("WR", "rzt")}; for running backs a carry is ${val("RB", "att")}, a red zone carry adds ${val("RB", "rz")}, and a target is ${val("RB", "tgt")}; for tight ends a target is ${val("TE", "tgt")}.</p><p>The test: fitted on the earlier weeks and checked on the later ones, usage explains this share of weekly scoring: ${esc(qs)}. Touchdowns and big plays make up most of the rest.</p><p>Limits: Sleeper sends weekly totals, not each play, so field position comes only from red zone carries and targets. Sleeper's air yards count only caught passes, so they measure results, not opportunity, and are left out: no aDOT, air yards share, or WOPR. There is no route data, so no targets per route run. This is not the play-by-play expected points the paid sites sell.</p></details>`;
    return h;
  }

  /* ---------- Prophecy Check: projections vs. what happened ---------- */
  function prophets() {
    const s = season();
    let h = sec("Prophecy Check", "Prove all things; hold fast that which is good. 1 Thessalonians 5:21. Sleeper's weekly projections, scored the league's way, against what actually happened.");
    if (!prophOk(s, st.model.projections)) return h + `<p class="empty">${Number(s.year) < 2026 ? "Projection checks start in 2026." : "This needs a league export with projections scored the league's way. Run the export page again and upload the new file."}</p>`;
    const pr = prOf(s);
    if (!pr || !pr.weeks.length) return h + `<p class="empty">No weeks with projections have been played in ${esc(s.year)} yet.</p>`;
    const T = Object.values(pr.teams).filter(t => t.n);
    const nm = pid => s.pinfo(pid)[0] || pid, ps = pid => s.pinfo(pid)[1] || "";
    const cls = x => x > 0 ? "w" : x < 0 ? "l" : "";
    const inj = pid => { const o = st.model.injuries && st.model.injuries[pid]; return o && o.s ? ` <span class="inj" title="Sleeper injury status">${esc(o.s)}</span>` : ""; };
    const wk = pr.weeks.length === 1 ? `week ${pr.weeks[0]}` : `weeks ${pr.weeks[0]} to ${pr.weeks[pr.weeks.length - 1]}`;
    h += `<p class="fine top">${esc(s.year)}, ${wk}. ${(pr.coverage * 100).toFixed(1)}% of starts had a projection.</p>`;

    h += `<h3>Beat the prophecy</h3><p class="fine top">Each lineup's starters, projected against actual.</p><div class="scroll"><table class="data" data-hide="1,2"><thead><tr><th>Team</th><th>Projected</th><th>Actual</th><th>+/−</th><th>Per week</th><th>Weeks over</th></tr></thead><tbody>`;
    T.slice().sort((a, b) => b.gap - a.gap).forEach((t, i) => { h += `<tr${t.uid === st.me ? ' class="me"' : ""}><td class="team"><span class="rank">${i + 1}</span>${whoInline(t.uid, s)}</td><td>${f1(t.proj)}</td><td>${f1(t.act)}</td><td class="${cls(t.gap)}">${sign(t.gap)}</td><td class="${cls(t.perWeek)}">${sign(t.perWeek)}</td><td>${t.over} of ${t.n}</td></tr>`; });
    const lg = T.reduce((x, t) => x + t.gap, 0) / Math.max(1, T.reduce((x, t) => x + t.n, 0));
    h += `</tbody></table></div><p class="fine">League-wide, starters run ${sign(lg)} a week against projection${lg < 0 ? ". Most lineups land under, because managers start the players projected highest, and the highest projections tend to run hot" : ""}. Projected is Sleeper's final number for each player that week, the one Sleeper keeps after Monday night, scored with league settings.</p>`;

    h += `<h3>Walking by faith</h3><p class="fine top">Lineup calls against the projections: a starter chosen over a bench player Sleeper projected at least ${P_CALL_GAP} point${P_CALL_GAP === 1 ? "" : "s"} higher who could have filled the same slot.</p><div class="scroll"><table class="data"><thead><tr><th>Team</th><th>Calls</th><th>Paid off</th><th>Net points</th></tr></thead><tbody>`;
    T.slice().sort((a, b) => b.calls.net - a.calls.net || b.calls.n - a.calls.n).forEach(t => { const c = t.calls; h += `<tr${t.uid === st.me ? ' class="me"' : ""}><td class="team">${whoInline(t.uid, s)}</td><td>${c.n}</td><td>${c.n ? `${c.right} of ${c.n}` : "None"}</td><td class="${cls(c.net)}">${c.n ? sign(c.net) : "0.0"}</td></tr>`; });
    h += `</tbody></table></div>`;
    const calls = T.flatMap(t => t.calls.list.map(c => ({ ...c, uid: t.uid })));
    if (calls.length) {
      calls.sort((a, b) => b.diff - a.diff);
      const line = (c, title) => `<div class="row"><div><b>${title}</b><div class="muted sm">${esc(ownerName(c.uid))} started ${pn(c.start, nm(c.start))} (projected ${f1(c.sProj)}, scored ${f1(c.sAct)}) over ${pn(c.bench, nm(c.bench))} (projected ${f1(c.bProj)}, scored ${f1(c.bAct)}), week ${c.week}.</div></div><div class="r ${cls(c.diff)}">${sign(c.diff)}</div></div>`;
      h += `<div class="list gap">${line(calls[0], "Faith rewarded")}${calls.length > 1 && calls[calls.length - 1].diff < 0 ? line(calls[calls.length - 1], "Should have trusted the prophet") : ""}</div>`;
    }
    h += `<p class="fine">Net points is what the starter scored minus what the bench player scored, added up over every call. Each bench player and each slot count once a week, biggest projection gap first.</p>`;

    const pl = pr.players.filter(p => p.n >= 3);
    const prow = p => `<div class="row"><div><b>${pn(p.pid, nm(p.pid))}</b> <span class="muted">${esc(ps(p.pid))}, ${esc(ownerName(p.owner))}</span>${inj(p.pid)}</div><div class="r ${cls(p.gap)}">${sign(p.gap)}<small>beat it ${p.beat} of ${p.n} weeks</small></div></div>`;
    if (pl.length) {
      const up = pl.slice().sort((a, b) => b.gap - a.gap).slice(0, 6), dn = pl.slice().sort((a, b) => a.gap - b.gap).slice(0, 6);
      h += `<div class="cols"><div><h3>Exceeded the prophecy</h3><div class="list">${up.map(prow).join("")}</div></div><div><h3>Fell short</h3><div class="list">${dn.map(prow).join("")}</div></div></div>`;
      h += `<p class="fine">Every week a player sat on a roster, started or not, with at least 3 such weeks. The name shown is the member who rostered him most of those weeks.</p>`;
    }

    h += `<h3>By position</h3><p class="fine top">Starters' points over or under projection, season total, by position.</p><div class="scroll"><table class="data"><thead><tr><th>Team</th>${P_GROUPS.map(g => `<th>${g}</th>`).join("")}</tr></thead><tbody>`;
    T.slice().sort((a, b) => b.gap - a.gap).forEach(t => { h += `<tr${t.uid === st.me ? ' class="me"' : ""}><td class="team">${esc(ownerName(t.uid))}</td>${P_GROUPS.map(g => { const b = t.byPos[g]; return b ? `<td class="${cls(b.gap)}">${sign(b.gap)}</td>` : `<td class="muted">0.0</td>`; }).join("")}</tr>`; });
    h += `</tbody></table></div><p class="fine">FLEX starters count at their own position.</p>`;
    return h;
  }

  function gifts() {
    const s = season();
    let h = sec("Spiritual Gifts", "There are different kinds of gifts, but the same Spirit. 1 Corinthians 12:4. Where every roster is strong and where it is thin, position by position.");
    const { opts, data, curWeek, ros } = giftsData(s);
    if (prophOk(s, st.model.projections)) h += `<p class="fine top">Projected against actual, by position: <button type="button" class="linkish" data-go="prophets" data-sec="By position">Prophecy Check</button></p>`;
    if (!data || !Object.keys(data.teams).length) return h + `<p class="empty">No weeks have been played in ${esc(s.year)} yet.</p>`;
    const uids = Object.keys(data.teams);
    if (!st.gTeam || !uids.includes(st.gTeam)) st.gTeam = st.me && uids.includes(st.me) ? st.me : uids.slice().sort((a, b) => data.rank[a].total - data.rank[b].total)[0];
    if (data.mode === "season" && st.gView === "starters") st.gView = "position";
    h += `<div class="gctl"><label class="sel"><span>Week</span><select id="gWeek">${opts.map(([k, l]) => `<option value="${k}"${k === st.gWeek ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label></div>`;
    const views = [["overall", "Overall"], ["position", "By Position"]].concat(data.mode === "season" ? [] : [["starters", "By Starters"]]).concat([["grid", "League Grid"]]);
    h += `<div class="chips wrap" role="group" aria-label="Spiritual Gifts view">${views.map(([k, l]) => `<button data-gview="${k}" aria-pressed="${st.gView === k}">${l}</button>`).join("")}</div>`;
    const src = data.mode === "current" ? (data.scoring === "proj" ? `Week ${curWeek}, projected: the best lineup from each current roster by Sleeper's projected points. Players on bye or ruled out sit.${data.missing.length ? ` Sleeper had no ${data.missing.join(" or ")} projections, so ${data.missing.length > 1 ? "those use trade value and stay" : "that uses trade value and stays"} out of the total.` : ""}` : `Week ${curWeek}, looking ahead: the best lineup from each current roster by trade value. Players on bye or ruled out sit.`) : data.mode === "ros" ? `Rest of season: each current roster's best full-strength lineup by trade value. Byes and injuries are not removed.` : data.mode === "season" ? `Weeks ${data.weeks[0]} to ${data.weeks[data.weeks.length - 1]}: average points per week from the players each team started.` : `Week ${data.week}, final: points from the players each team actually started.`;
    h += `<p class="asof-line">${src}</p>`;
    if (data.mode === "current" || data.mode === "ros") h += asOfBanner();
    if (st.gView !== "overall" && st.gView !== "grid") h += `<div class="gctl"><label class="sel"><span>Team</span><select id="gTeam">${uids.slice().sort((a, b) => ownerName(a).localeCompare(ownerName(b))).map(u => `<option value="${esc(u)}"${u === st.gTeam ? " selected" : ""}>${esc(ownerName(u))}${u === st.me ? " (you)" : ""} · ${esc(teamIn(u, s))}</option>`).join("")}</select></label></div>`;
    if (st.gView === "overall") h += gOverall(s, data);
    else if (st.gView === "starters") h += gStarters(s, data);
    else if (st.gView === "grid") h += gGrid(s, data);
    else h += gPosition(s, data, ros);
    h += `<details class="explain"><summary>How Spiritual Gifts works</summary><p>Each lineup slot belongs to a group: QB, RB, WR, TE, FLEX, K, and DEF. A group's number is the total of the players in those slots. The bars compare each team to the league's best at that group, and the rank is out of ${data.n}. Green is the top ${Math.round(data.n / 4)}, red is the bottom ${Math.round(data.n / 4)}.</p><p>Played weeks use the points from the players each team actually started. Season so far averages those weeks.</p><p>This week builds each team's best legal lineup from its current roster. It uses Sleeper's projected points when the export includes them, and trade values when it does not. Players whose team is on bye sit, and so do players Sleeper lists as Out, Doubtful, or on IR. Questionable players still count, since most of them play.</p><p>Rest of season uses trade values for a full-strength lineup, with no byes or injuries removed. Kickers and defenses use the FantasyPros ranking, since the trade charts skip them.</p>${ros ? "<p>Good trade partners come from the rest-of-season view: teams in the top third of the league where you are in the bottom third, and the other way around, on QB, RB, WR, and TE.</p>" : ""}</details>`;
    return h;
  }

  function gOverall(s, data) {
    const uids = Object.keys(data.teams).sort((a, b) => data.rank[a].total - data.rank[b].total);
    let h = `<div class="glegend" aria-hidden="true">${G_KEYS.filter(k => k !== "DEF").map(k => `<span><i class="${G_COLOR[k]}"></i>${k === "K" ? "K/DEF" : k}</span>`).join("")}</div><div class="list">`;
    uids.forEach(u => {
      const t = data.teams[u];
      const segs = G_KEYS.map(k => `<i class="${G_COLOR[k]}" style="width:${(t.groups[k] / data.max.total * 100).toFixed(2)}%" title="${k} ${f1(t.groups[k])}"></i>`).join("");
      h += `<div class="grow-o${u === st.me ? " me" : ""}"><div class="row"><div><span class="rank">${data.rank[u].total}</span>${whoInline(u, s)}</div><div class="r">${f1(t.total)}<small>${gUnit(data)}</small></div></div><div class="gstack" role="img" aria-label="${esc(ownerName(u))}: ${G_KEYS.map(k => k + " " + f1(t.groups[k])).join(", ")}">${segs}</div></div>`;
    });
    return h + `</div>`;
  }

  function gPosition(s, data, ros) {
    const u = st.gTeam, t = data.teams[u], r = data.rank[u];
    let h = `<h3>${esc(teamIn(u, s))} <span class="muted">${esc(ownerName(u))}, ${ordinal(r.total)} overall</span></h3><button type="button" class="linkish" data-go="members" data-sec="Member Directory" data-member="${esc(u)}">${esc(ownerName(u))}'s member page</button><div class="gbars">`;
    const keys = G_KEYS.slice().sort((a, b) => r[a] - r[b]);
    keys.forEach(k => {
      const band = gBand(r[k], data.n);
      h += `<div class="grow"><span class="gl">${k}</span><span class="gbar" role="img" aria-label="${k}: ${ordinal(r[k])} of ${data.n}"><i class="${band}" style="width:${Math.max(3, t.groups[k] / data.max[k] * 100).toFixed(1)}%"></i></span><span class="gr ${band}">#${r[k]}</span></div>`;
    });
    h += `</div>`;
    if (data.mode === "current" && t.out && t.out.length) h += `<p class="fine">Sitting this week: ${t.out.map(o => `${esc(gPlayer(o.pid))} (${o.why === "bye" ? "bye" : esc(o.why)})`).join(", ")}.</p>`;
    if ((data.mode === "current" || data.mode === "ros") && ros && ros.teams[u]) {
      const ps = gPartners(ros, u);
      if (ps.length) {
        h += `<h3>Good trade partners</h3><div class="list">`;
        ps.forEach(p => { h += `<div class="row"><div>${whoInline(p.uid, s)}<small class="muted gsub">Strong at ${p.gets.join(", ")}, where ${esc(ownerName(u))} is thin. Thin at ${p.gives.join(", ")}, where ${esc(ownerName(u))} is strong.</small></div><div class="r"><button type="button" class="go-btn" data-gpartner="${esc(p.uid)}">Build a trade</button></div></div>`; });
        h += `</div>`;
      } else h += `<p class="fine">No clear trade partner this week: no team is strong where ${esc(ownerName(u))} is thin and thin where he is strong.</p>`;
    }
    return h;
  }

  function gStarters(s, data) {
    const u = st.gTeam, t = data.teams[u];
    let h = `<h3>${esc(teamIn(u, s))} <span class="muted">${esc(ownerName(u))}</span></h3><div class="gbars">`;
    t.starters.forEach(x => {
      const band = x.rank ? gBand(x.rank, data.n) : "low";
      const nm = x.pid ? gPlayer(x.pid) : "Empty slot", tm = x.pid ? gTeamAbbr(x.pid) : "", oi = x.pid ? offInj(x.pid) : null;
      h += `<div class="grow st"><span class="gl">${esc(x.label)}</span><span class="gmid"><span class="gname">${x.pid ? pn(x.pid, nm) : esc(nm)}${tm ? ` <span class="muted">${esc(tm)}</span>` : ""}${oi ? ` <span class="inj">${esc(G_INJ_SHORT[oi] || oi)}</span>` : ""}</span><span class="gbar"><i class="${band}" style="width:${Math.max(3, (x.score > 0 ? x.score : 0) / data.slotMax[x.label] * 100).toFixed(1)}%"></i></span></span><span class="gr ${band}">#${x.rank || data.n}<small>${f1(x.score)}</small></span></div>`;
    });
    h += `</div><p class="fine">Each player is ranked against the player in the same slot on every other team${data.scoring === "proj" ? ", by projected points" : data.mode === "current" || data.mode === "ros" ? ", by trade value" : ", by points that week"}. RB1 is the higher of a team's two RBs.</p>`;
    return h;
  }

  function gGrid(s, data) {
    const uids = Object.keys(data.teams).sort((a, b) => data.rank[a].total - data.rank[b].total);
    let h = `<div class="scroll"><table class="data ggrid"><thead><tr><th>Team</th>${G_KEYS.map(k => `<th>${k}</th>`).join("")}<th>All</th></tr></thead><tbody>`;
    uids.forEach(u => {
      const r = data.rank[u];
      h += `<tr${u === st.me ? ' class="me"' : ""}><td class="team"><b>${esc(ownerName(u))}</b></td>${G_KEYS.map(k => `<td class="rk ${gBand(r[k], data.n)}" title="${k} ${f1(data.teams[u].groups[k])}">${r[k]}</td>`).join("")}<td><b>${r.total}</b></td></tr>`;
    });
    return h + `</tbody></table></div><p class="fine">Each cell is the team's rank at that position, 1 to ${data.n}. Sorted by overall rank.</p>`;
  }

  /* ---------- Trade Chart ---------- */
  function chart() {
    if (!st.tv) return deskBar("chart") + sec("Trade Chart", "") + `<p class="empty">Trade values have not been loaded yet. They arrive with the weekly charts.</p>`;
    const T = st.tv;
    let h = deskBar("chart") + sec("Trade Chart", `${esc(srcBlurb())} blended into one value per player, on a 100-point scale.`) + asOfBanner();
    const ups = T.cons.list.filter(e => e.delta != null && e.delta >= 2).sort((a, b) => b.delta - a.delta).slice(0, 4);
    const downs = T.cons.list.filter(e => e.delta != null && e.delta <= -2).sort((a, b) => a.delta - b.delta).slice(0, 4);
    if (ups.length || downs.length) h += `<div class="movers"><div><b class="w">Risers</b> ${ups.map(e => `${esc(e.name)} <span class="w">▲${f1(e.delta)}</span>`).join(", ") || "none"}</div><div><b class="l">Fallers</b> ${downs.map(e => `${esc(e.name)} <span class="l">▼${f1(Math.abs(e.delta))}</span>`).join(", ") || "none"}</div></div>`;
    else h += `<p class="fine">Risers and fallers start once a second week of charts is loaded.</p>`;
    const opts = [["all", "All"], ["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["K", "K"], ["DEF", "DEF"]].concat(st.me ? [["mine", "My team"]] : []).concat([["fa", "Free agents"]]);
    h += `<div class="chips wrap" role="group" aria-label="Filter players">${opts.map(([k, l]) => `<button data-tvpos="${k}" aria-pressed="${st.chartPos === k}">${l}</button>`).join("")}</div>`;
    const keep = e => st.chartPos === "all" ? true : st.chartPos === "mine" ? e.pid && T.owner[e.pid] === st.me : st.chartPos === "fa" ? !(e.pid && T.owner[e.pid]) : e.pos === st.chartPos;
    const list = T.cons.list.filter(keep);
    if (!list.length) return h + `<p class="empty">No players match this filter.</p>`;
    const present = TV_TIERS.filter(t => list.some(e => tvTier(e.value) === t));
    if (present.length > 1) h += `<div class="tierjump" role="navigation" aria-label="Jump to tier">${present.map(t => `<button type="button" data-tierjump="${t.n}">${t.n} · ${esc(t.name)}</button>`).join("")}</div>`;
    TV_TIERS.forEach(t => {
      const rows = list.filter(e => tvTier(e.value) === t);
      if (!rows.length) return;
      const cap = t.min === 0 && !st.chartAll && rows.length > 30 ? 30 : rows.length;
      const next = TV_TIERS[TV_TIERS.indexOf(t) - 1];
      h += `<section class="tier" id="tier-${t.n}"><div class="tier-h"><b>Tier ${t.n} · ${esc(t.name)}</b><span>${next ? `${t.min} to ${next.min - 1}` : `${t.min}+`}</span></div>`;
      rows.slice(0, cap).forEach(e => {
        const own = e.pid && T.owner[e.pid];
        const open = st.chartOpen === e.key;
        const mine = own && own === st.me;
        h += `<button type="button" class="prow${mine ? " mine" : ""}" data-tvrow="${esc(e.key)}" aria-expanded="${open}"><span class="pbar ${POS_CLASS[e.pos] || "ot"}" aria-hidden="true"></span><span class="pmain"><span class="pname">${esc(e.name)} ${injTag(e)}</span><span class="psub">${esc(e.pos)}${e.team ? " · " + esc(e.team) : ""} · ${own ? esc(ownerName(own)) : "Free agent"}${e.sosPO != null ? " · Playoffs " + stars(e.sosPO) : ""}</span></span><span class="pval num">${f1(e.value)}${e.delta != null && Math.abs(e.delta) >= 0.5 ? `<small class="${e.delta > 0 ? "w" : "l"}">${e.delta > 0 ? "▲" : "▼"}${f1(Math.abs(e.delta))}</small>` : ""}</span></button>`;
        if (open) {
          const src = Object.entries(T.week.sources).map(([k, sObj]) => { const x = e.src[k]; const w = Math.round((sObj.w != null ? sObj.w : 1) / Object.values(T.week.sources).reduce((a, y) => a + (y.w != null ? y.w : 1), 0) * 100); return `<div class="row"><div>${esc(sObj.name)}<small>${w}% of the blend</small></div><div class="r">${x ? (sObj.kind === "rank" ? `#${x.rk} overall` : `${x.v}`) : "not listed"}<small>${x ? (sObj.kind === "rank" ? "rest of season" : "rank " + (x.rank % 1 ? x.rank.toFixed(1) : x.rank)) : `counted as rank ${sObj.rows.length + 1}`}</small></div></div>`; }).join("");
          const histVals = T.hist.map(hh => { const x = e.pid ? hh.cons.byPid[e.pid] : hh.cons.list.find(y => y.key === e.key); return x ? `Wk ${hh.week}: ${f1(x.value)}` : null; }).filter(Boolean);
          h += `<div class="pdetail">${e.pid ? `<button type="button" class="go-btn" data-pid="${esc(e.pid)}">Player card</button>` : ""}<div class="list">${src}</div>${e.ppgAvg != null ? `<p class="fine">Points per game on the charts: ${f1(e.ppgAvg)}.</p>` : ""}${e.nSrc === 1 ? `<p class="fine">Only ${esc(T.week.sources[Object.keys(e.src)[0]].name)} lists him, so his value leans on a single opinion.</p>` : ""}${e.spread >= 25 && e.nSrc > 1 ? `<p class="fine">The sources disagree on him: their ranks are ${Math.round(e.spread)} spots apart.</p>` : ""}${e.sosPO != null ? `<p class="fine">Playoff schedule from FantasyPros: ${e.sosPO} of 5 stars. More stars means easier opponents.</p>` : ""}${histVals.length > 1 ? `<p class="fine">History: ${histVals.join(", ")}</p>` : ""}${own ? `<button type="button" class="go-btn" data-tvadd="${esc(e.pid)}">Put him in a trade</button>` : ""}</div>`;
        }
      });
      if (cap < rows.length) h += `<button type="button" class="go-btn ghost" data-tvmore="1">Show ${rows.length - cap} more</button>`;
      h += `</section>`;
    });
    h += `<details class="explain"><summary>How the trade chart works</summary><p>Each source ranks players its own way. We rank every player inside each source, take a weighted average of the ranks (${esc(srcBlurb())}), and turn that average into one value on a 100-point curve. A player a source leaves out counts as one spot below that source's last player.</p><p>FantasyPros ECR is the expert consensus ranking for the rest of the season. It also ranks kickers and defenses, which the trade charts skip, so those players sit low on this chart. The stars show FantasyPros' playoff schedule rating: more stars means easier opponents.</p><p>The injury tag means at least one trade chart lists him as injured. Owners come from the Sleeper rosters, including this week's moves.</p></details>`;
    return h;
  }

  /* ---------- Trade Advisor ---------- */
  // Uneven trades: the team getting more players has to cut someone, so suggest throwing in the player he would drop anyway
  function unevenNote(uid, extra, exclude) {
    if (extra <= 0) return "";
    const cut = mtDropCandidate(st.tv.cons, st.model.latest, uid, exclude);
    return `<div class="warn"><b>Uneven trade.</b> ${esc(ownerName(uid))} gets ${extra} more ${extra === 1 ? "player" : "players"} than he sends and would have to drop ${extra === 1 ? "someone" : extra}. Throw in the player he would cut anyway${cut ? `: <b>${esc(tvName(cut))}</b> <span class="muted">${esc(tvPos(cut) || "")} ${f1(tvV(cut))}</span>` : ""}.</div>`;
  }
  const pLabel = p => `${tvName(p)} · ${tvPos(p) || "?"} · ${f1(tvV(p))}`;
  const pInline = p => `<b>${esc(tvName(p))}</b> <span class="muted">${esc(tvPos(p) || "")} ${f1(tvV(p))}</span>`;

  /* ---------- Covered Dish Deals: search loops among chosen teams ---------- */
  function coveredDishBlock(s) {
    const pool = s.uids.slice().sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
    if (!st.mtSel) st.mtSel = new Set(st.me && pool.includes(st.me) ? [st.me] : []);
    const sel = [...st.mtSel], k = sel.length, pairOk = k <= 4;
    let h = sec("Covered Dish Deals", "Three to six teams in one loop: each team sends to the next and gets from the one before. Everybody brings a dish, everybody leaves fed.");
    h += `<p class="fine top">Pick the teams${st.me ? ", starting with yours" : ""}.</p><div class="chips wrap" role="group" aria-label="Teams in the deal">${pool.map(u => `<button data-mtsel="${esc(u)}" aria-pressed="${st.mtSel.has(u)}">${esc(ownerName(u))}${u === st.me ? " (you)" : ""}</button>`).join("")}</div>`;
    if (st.me && st.mtSel.has(st.me)) {
      giftsData(s); const ros = st.gCache[s.year + ":ros"];
      const ps = ros ? gPartners(ros, st.me) : [];
      if (ps.length) h += `<p class="fine">Good partners for you, from Spiritual Gifts: ${ps.map(p => `${esc(ownerName(p.uid))} (strong at ${p.gets.join(", ")})`).join("; ")}.</p>`;
    }
    h += `<div class="mt-opts"><button type="button" class="toggle" data-mtpair="1" aria-pressed="${st.mtPair && pairOk}"${pairOk ? "" : " disabled"}>Allow two-for-one${pairOk ? "" : " (up to 4 teams)"}</button>`;
    if (st.me && st.mtSel.has(st.me)) {
      const mine = (s.currentRosters[st.me] || []).filter(p => !["K", "DEF"].includes(tvPos(p))).sort((a, b) => tvV(b) - tvV(a));
      h += `<details class="mt-lock"><summary>Players I won't trade${st.mtLock.size ? ` (${st.mtLock.size})` : ""}</summary><div class="chips wrap">${mine.map(p => `<button data-mtlock="${esc(p)}" aria-pressed="${st.mtLock.has(p)}">${esc(pLabel(p))}</button>`).join("")}</div></details>`;
    }
    h += `</div>`;
    const ready = k >= 3 && k <= 6;
    h += `<button type="button" class="go-btn" data-mtfind="1"${ready ? "" : " disabled"}>${ready ? `Find deals among ${k} teams` : k < 3 ? `Pick ${3 - k} more ${3 - k === 1 ? "team" : "teams"}` : "Six teams at most"}</button>`;
    const key = mtKey();
    if (st.mtRes && st.mtRes.key === key) {
      const R = st.mtRes.r;
      if (R.deals.length) h += `<div class="ideas">${R.deals.map((d, i) => dishCard(d, i)).join("")}</div>`;
      else {
        const why = R.stats.fair === 0 ? `None of the ${R.stats.tried.toLocaleString()} combinations is fair on value for all ${k} teams.` : `${R.stats.fair.toLocaleString()} combinations are fair on value, but none improves every lineup by half a point.`;
        h += `<p class="empty">No deal passes both tests. ${why}</p>`;
        if (R.nearest) h += `<p class="fine">Closest fair deal, though it does not help every lineup:</p><div class="ideas">${dishCard(R.nearest, "n")}</div>`;
        else if (R.closest) h += `<p class="fine">Closest to fair on value. It is not fair: the widest gap is ${Math.round(R.closest.worst * 100)}%, where 10% is the limit. Use it as a starting point in the builder.</p><div class="ideas">${dishCard(R.closest, "c")}</div>`;
      }
    }
    return h;
  }
  const mtKey = () => [...st.mtSel].sort().join(",") + "|" + (st.mtPair && st.mtSel.size <= 4) + "|" + [...st.mtLock].sort().join(",");
  function dishCard(d, i) {
    const nxt = u => d.loop[(d.loop.indexOf(u) + 1) % d.loop.length], prv = u => d.loop[(d.loop.indexOf(u) - 1 + d.loop.length) % d.loop.length];
    const rows = d.per.map(r => `<div class="dish-row"><b>${esc(ownerName(r.u))}</b> gets ${r.gets.map(pInline).join(" + ")} <span class="muted">from ${esc(ownerName(prv(r.u)))}</span>, sends ${r.sends.map(pInline).join(" + ")} <span class="muted">to ${esc(ownerName(nxt(r.u)))}</span><span class="dish-num"><span class="${r.gain >= 0.5 ? "w" : r.gain < 0 ? "l" : ""}">${r.gain >= 0 ? "+" : "−"}${f1(Math.abs(r.gain))} pts/wk</span> · ${Math.round(Math.abs(r.diff) * 100)}% on value</span></div>`).join("");
    return `<div class="idea dish"><div class="idea-h">${d.loop.concat([d.loop[0]]).map(u => esc(ownerName(u))).join(" → ")}</div>${rows}<button type="button" class="go-btn" data-mtload="${i}">Load in builder</button></div>`;
  }

  /* ---------- Multi-team builder ---------- */
  function multiBuilder(s) {
    const M = st.multi, T = st.tv;
    const pool = s.uids.slice().sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
    let h = `<div class="mt-teams">${M.teams.map(u => `<span class="chip-p">${esc(ownerName(u))}<button type="button" data-mtdrop="${esc(u)}" aria-label="Remove ${esc(ownerName(u))}">×</button></span>`).join("")}${M.teams.length < 12 ? `<select id="mtAddTeam" aria-label="Add a team"><option value="">+ Add a team</option>${pool.filter(u => !M.teams.includes(u)).map(u => `<option value="${esc(u)}">${esc(ownerName(u))}</option>`).join("")}</select>` : ""}</div>`;
    h += `<div class="list mt-moves">${M.moves.length ? M.moves.map((m, i) => `<div class="row"><div>${pInline(m.pid)}${injTag(T.cons.byPid[m.pid])}<div class="muted sm">${esc(ownerName(m.from))} → ${esc(ownerName(m.to))}</div></div><div class="r"><button type="button" class="linkish" data-mtrm="${i}" aria-label="Remove ${esc(tvName(m.pid))}">Remove</button></div></div>`).join("") : `<p class="empty">No players yet. Pick a player, then the team he goes to.</p>`}</div>`;
    const taken = new Set(M.moves.map(m => m.pid));
    h += `<div class="mt-add"><select id="mtP" aria-label="Player to move"><option value="">Player</option>${M.teams.map(u => `<optgroup label="${esc(ownerName(u))}">${(s.currentRosters[u] || []).filter(p => !taken.has(p)).sort((a, b) => tvV(b) - tvV(a)).map(p => `<option value="${esc(p)}"${p === st.mtPick ? " selected" : ""}>${esc(pLabel(p))}</option>`).join("")}</optgroup>`).join("")}</select>`;
    const fromU = st.mtPick ? M.teams.find(u => (s.currentRosters[u] || []).includes(st.mtPick)) : null;
    h += `<select id="mtTo" aria-label="Goes to"><option value="">Goes to</option>${M.teams.filter(u => u !== fromU).map(u => `<option value="${esc(u)}"${u === st.mtTo ? " selected" : ""}>${esc(ownerName(u))}</option>`).join("")}</select><button type="button" class="go-btn" data-mtadd="1"${st.mtPick && st.mtTo && st.mtTo !== fromU ? "" : " disabled"}>Add</button></div>`;
    h += `<div class="builder-tools"><button type="button" class="linkish" data-mtclear="1">Clear players</button>${M.teams.length === 2 ? `<button type="button" class="linkish" data-mtback="1">Back to two teams</button>` : ""}</div>`;
    if (M.teams.length < 2) return h + `<p class="empty">Add at least two teams.</p>`;
    if (!M.moves.length) return h;
    const E = mtEvaluate(T.cons, s, M.moves, M.teams);
    const idle = E.rows.filter(r => !r.gets.length || !r.sends.length);
    if (idle.length) h += `<div class="warn"><b>Not a full deal yet.</b> ${idle.map(r => esc(ownerName(r.uid))).join(", ")} ${idle.length === 1 ? "has" : "have"} to both send and receive at least one player.</div>`;
    const head = E.level === "fair" ? (E.winWin ? "Fair for every team, and every lineup gets better. A covered dish for all." : "Fair for every team on value, but not every lineup gets better.") : E.level === "leans" ? `Close. ${esc(ownerName(E.worst.uid))} is ${Math.round(Math.abs(E.worst.diff) * 100)}% ${E.worst.diff > 0 ? "ahead" : "behind"} on value.` : `Lopsided. ${esc(ownerName(E.worst.uid))} is ${Math.round(Math.abs(E.worst.diff) * 100)}% ${E.worst.diff > 0 ? "ahead" : "behind"} on value.`;
    h += `<div class="verdict ${E.level}"><b>${head}</b>`;
    if (M.teams.length <= 4) h += mtDiagram(M);
    h += `<div class="scroll"><table class="data"><thead><tr><th>Team</th><th>In/out</th><th>Value</th><th>Lineup</th></tr></thead><tbody>${E.rows.map(r => `<tr${r.uid === st.me ? ' class="me"' : ""}><td class="team"><b>${esc(ownerName(r.uid))}</b></td><td>${r.gets.length}/${r.sends.length}</td><td class="${r.level === "fair" ? "" : r.diff > 0 ? "w" : "l"}">${r.diff >= 0 ? "+" : "−"}${Math.round(Math.abs(r.diff) * 100)}%</td><td class="${r.gain >= 0.5 ? "w" : r.gain < 0 ? "l" : ""}">${r.gain >= 0 ? "+" : "−"}${f1(Math.abs(r.gain))}</td></tr>`).join("")}</tbody></table></div><p class="fine">In/out is players received and sent. Value is what each team gets against what it sends, with the star premium and roster-spot credit. Within 10% is fair. Lineup is the change in points per week for its best lineup.</p></div>`;
    E.rows.forEach(r => { h += unevenNote(r.uid, r.extra, M.moves.map(m => m.pid)); });
    return h;
  }
  // Arrow diagram for 3 or 4 teams
  function mtDiagram(M) {
    const W = 320, H = 210, cx = W / 2, cy = H / 2, R = 72, n = M.teams.length;
    const pos = M.teams.map((u, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return { u, x: cx + R * 1.5 * Math.cos(a), y: cy + R * Math.sin(a) }; });
    const at = u => pos.find(p => p.u === u);
    const pairs = {}; M.moves.forEach(m => { const k = m.from + ">" + m.to; (pairs[k] = pairs[k] || []).push(m.pid); });
    let g = `<defs><marker id="mtArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mt-head"/></marker></defs>`;
    Object.entries(pairs).forEach(([k, pids]) => {
      const [f, t] = k.split(">"), A = at(f), B = at(t); if (!A || !B) return;
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, off = 6;
      const x1 = A.x + ux * 30 - uy * off, y1 = A.y + uy * 18 + ux * off, x2 = B.x - ux * 30 - uy * off, y2 = B.y - uy * 18 + ux * off;
      const label = tvName(pids[0]).split(" ").slice(-1)[0] + (pids.length > 1 ? " +" + (pids.length - 1) : "");
      g += `<line class="mt-edge" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" marker-end="url(#mtArrow)"/><text class="mt-lbl" x="${((x1 + x2) / 2 - uy * 10).toFixed(1)}" y="${((y1 + y2) / 2 + ux * 10 + 4).toFixed(1)}" text-anchor="middle">${esc(label)}</text>`;
    });
    pos.forEach(p => { g += `<g class="mt-node${p.u === st.me ? " me" : ""}"><rect x="${(p.x - 34).toFixed(1)}" y="${(p.y - 14).toFixed(1)}" width="68" height="28" rx="14"/><text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle">${esc(ownerName(p.u))}</text></g>`; });
    return `<figure class="chart mt-fig"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Who sends players to whom">${g}</svg></figure>`;
  }

  /* ---------- The Offering: shop one player across the league ---------- */
  function shopData(who, pid) {
    const key = `${who}|${pid}|${st.shopWant || "any"}`;
    st.shopCache = st.shopCache || {};
    return st.shopCache[key] || (st.shopCache[key] = tvShop(st.tv.cons, st.model.latest, who, pid, { want: st.shopWant || "any" }));
  }
  function offeringBlock(who, s) {
    const T = st.tv, you = who === st.me, nmw = esc(ownerName(who));
    let h = sec("The Offering", `Lay one player on the offering plate, and every other team is searched for the best return. "Bring the whole tithe into the storehouse." Malachi 3:10.`);
    const ros = (s.currentRosters[who] || []).filter(p => !["K", "DEF"].includes(tvPos(p))).sort((a, b) => tvV(b) - tvV(a));
    const pid = st.shopPid && ros.includes(st.shopPid) ? st.shopPid : null;
    h += `<div class="pick"><select id="shopPid" aria-label="Player to shop"><option value="">${you ? "Choose one of your players" : `Choose one of ${nmw}'s players`}</option>${ros.map(p => { const e = T.cons.byPid[p]; return `<option value="${esc(p)}"${p === pid ? " selected" : ""}>${esc(tvName(p))} · ${esc(tvPos(p) || "")} · ${f1(tvV(p))}${e && e.inj ? " · injured" : ""}</option>`; }).join("")}</select></div>`;
    h += `<div class="chips" role="group" aria-label="What you want back">${[["any", "Any position"], ["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"]].map(([k, l]) => `<button type="button" data-shopwant="${k}" aria-pressed="${(st.shopWant || "any") === k}">${l}</button>`).join("")}</div>`;
    if (!pid) return h + `<p class="fine top">Pick a player. The position chips steer the search toward what you want back without ruling anything out.</p>`;
    const R = shopData(who, pid), D = R.diag, nm0 = esc(tvName(pid));
    if (!R.rows.length) return h + `<p class="empty">No team has players that could come back for ${nm0}.</p>`;
    const head = D.best === 1 ? `Fair deals that help both lineups, best first.` : D.best === 2 ? `No deal is both fair and good for both lineups. These are fair on value and come closest to helping both.` : `No fair deal exists. These come closest on value, each with the one change that brings it nearest to even.`;
    const inj = T.cons.byPid[pid] && T.cons.byPid[pid].inj ? ` He is flagged as injured, which other members will see too.` : "";
    h += `<p class="takeaway">${head}</p><p class="fine top">${nm0} would improve ${D.startsFor} of ${D.teams} other lineups.${D.startsFor === 0 ? " Nobody's lineup gets better with him, so returns lean on value alone." : ""}${D.wantMiss ? ` None of these returns a ${esc(st.shopWant)}.` : ""}${inj}</p>`;
    h += `<div class="ideas">${R.rows.map((t, i) => shopCard(who, t, i)).join("")}</div>`;
    h += `<details class="explain"><summary>How The Offering works</summary><p>Your side is the chosen player alone, or him plus one of your other top players. The other side is one or two of that team's top eight healthy players. Kickers and defenses are left out. Every pairing is scored with the Trade Advisor's math: value within 10% is fair, and a lineup gains when its best weekly lineup scores at least 0.5 more.</p><p>Each team shows its single best deal. Fair deals that help both lineups come first, then fair deals closest to helping both, then the closest on value. A position chip moves deals that return that position up the list.</p></details>`;
    return h;
  }
  function shopCard(who, t, i) {
    const you = who === st.me, me = you ? "You" : esc(ownerName(who)), them = esc(ownerName(t.partner));
    const pl = arr => arr.map(p => `<b>${pn(p, tvName(p))}</b> <span class="muted">${esc(tvPos(p))} ${f1(tvV(p))}</span>`).join(" + ");
    const gap = Math.max(1, Math.round(Math.abs(t.ev.diff) * 100));
    const label = t.level === 1 ? `<span class="tag gold flush">Fair, both lineups improve</span>` : t.level === 2 ? `<span class="tag flush">Fair, but ${t.gainMe < 0.5 && t.gainThem < 0.5 ? "neither lineup gains" : t.gainMe < 0.5 ? `${you ? "your" : me + "'s"} lineup does not gain` : `${them}'s lineup does not gain`}</span>` : `<span class="tag flush">${gap}% apart on value</span>`;
    const gl = (who2, g) => `<span class="${g >= 0.5 ? "w" : g <= -0.5 ? "l" : "muted"}">${who2} ${sign(g)} pts/wk</span>`;
    const fix = t.fix ? `<p class="fine">Closest fix: ${t.fix.side === "send" ? `${you ? "add" : me + " adds"} <b>${pn(t.fix.pid, tvName(t.fix.pid))}</b>` : `ask ${them} for <b>${pn(t.fix.pid, tvName(t.fix.pid))}</b> too`}, which leaves it ${Math.max(1, Math.round(Math.abs(t.fix.diff) * 100))}% apart${Math.abs(t.fix.diff) <= 0.10 ? ", fair" : ""}.</p>` : "";
    const uneven = t.get.length !== t.send.length ? unevenNote(t.get.length > t.send.length ? who : t.partner, Math.abs(t.get.length - t.send.length), [...t.get, ...t.send]) : "";
    return `<div class="idea"><div class="idea-h">Trade with <b>${them}</b> ${label}</div><div class="idea-b"><div><span class="muted sm">${you ? "You send" : me + " sends"}</span><div>${pl(t.send)}</div></div><div><span class="muted sm">${you ? "You get" : me + " gets"}</span><div>${pl(t.get)}</div></div></div><div class="idea-f">${gl(me, t.gainMe)}${gl(them, t.gainThem)}<span class="muted">${gap}% apart on value</span></div>${fix}${uneven}<button type="button" class="go-btn" data-shop="${esc(who)}|${i}">Open in Trade Advisor</button></div>`;
  }

  function ideaCard(who, t, i, showWho) {
    const pl = arr => arr.map(p => `<b>${pn(p, tvName(p))}</b> <span class="muted">${esc(tvPos(p))} ${f1(tvV(p))}</span>`).join(" + ");
    const uneven = t.get.length !== t.send.length ? unevenNote(t.get.length > t.send.length ? who : t.partner, Math.abs(t.get.length - t.send.length), [...t.get, ...t.send]) : "";
    return `<div class="idea"><div class="idea-h">${showWho ? `<b>${esc(ownerName(who))}</b> and ` : "Trade with "}<b>${esc(ownerName(t.partner))}</b></div><div class="idea-b"><div><span class="muted sm">${showWho ? esc(ownerName(who)) + " sends" : "You send"}</span><div>${pl(t.send)}</div></div><div><span class="muted sm">${showWho ? esc(ownerName(who)) + " gets" : "You get"}</span><div>${pl(t.get)}</div></div></div><div class="idea-f"><span class="w">${showWho ? esc(ownerName(who)) : "You"} +${f1(t.gainMe)} pts/wk</span><span class="w">${esc(ownerName(t.partner))} +${f1(t.gainThem)} pts/wk</span><span class="muted">Fair: ${Math.max(1, Math.round(Math.abs(t.ev.diff) * 100))}% apart on value</span></div>${uneven}<button type="button" class="go-btn" data-idea="${esc(who)}|${i}">Open in Trade Advisor</button></div>`;
  }

  function advisor() {
    if (!st.tv) return deskBar("advisor") + sec("Trade Advisor", "") + `<p class="empty">Trade values have not been loaded yet. They arrive with the weekly charts.</p>`;
    const T = st.tv, s = st.model.latest, tr = st.trade;
    let h = deskBar("advisor") + sec("Trade Advisor", "Build a trade and see who wins it, on value and on the weekly lineup.") + asOfBanner(true);
    // Ideas
    const pool = s.uids.slice().sort((a, b) => ownerName(a).localeCompare(ownerName(b)));
    const who = st.ideasFor || st.me || pool[0];
    const ideas = tvIdeas(who);
    h += sec("Trade Ideas", "Up to three trades per member each week. Each one is fair on value and helps both starting lineups.");
    h += `<div class="pick"><select id="ideasFor" aria-label="Trade ideas for">${pool.map(u => `<option value="${esc(u)}"${u === who ? " selected" : ""}>${esc(ownerName(u))}${u === st.me ? " (you)" : ""}</option>`).join("")}</select></div>`;
    h += ideas.length ? `<div class="ideas">${ideas.map((t, i) => ideaCard(who, t, i, who !== st.me)).join("")}</div>` : `<p class="empty">No trade passes both tests for ${esc(ownerName(who))} this week. Usually that means a strong lineup with a thin bench.</p>`;
    h += offeringBlock(who, s);
    // Builder
    h += sec("Build a Trade", st.multi ? "Two to twelve teams. Add each player and the team he goes to." : "Pick two teams, then add the players each side gets.");
    if (st.multi) return h + multiBuilder(s) + dishAndExplain(s);
    const teamSel = (id, val, other, label) => `<select id="${id}" aria-label="${label}"><option value="">${label}</option>${pool.filter(u => u !== other).map(u => `<option value="${esc(u)}"${u === val ? " selected" : ""}>${esc(ownerName(u))}${u === st.me ? " (you)" : ""}</option>`).join("")}</select>`;
    const chips = (side, list) => list.length ? list.map(p => { const e = T.cons.byPid[p]; return `<span class="chip-p">${posTag(tvPos(p))} ${esc(tvName(p))} <span class="num">${f1(tvV(p))}</span>${injTag(e)}<button type="button" data-rm="${side}|${esc(p)}" aria-label="Remove ${esc(tvName(p))}">×</button></span>`; }).join("") : `<span class="muted sm">No players yet</span>`;
    const addSel = (id, fromUid, taken) => { if (!fromUid) return ""; const r = (s.currentRosters[fromUid] || []).filter(p => !taken.includes(p)).sort((x, y) => tvV(y) - tvV(x)); return `<select id="${id}" aria-label="Add a player"><option value="">+ Add a player from ${esc(ownerName(fromUid))}</option>${r.map(p => `<option value="${esc(p)}">${esc(tvName(p))} · ${esc(tvPos(p) || "")} · ${f1(tvV(p))}</option>`).join("")}</select>`; };
    h += `<div class="builder"><div class="side"><div class="side-h">${teamSel("tvA", tr.a, tr.b, "Choose Team A")}</div><div class="muted sm">${tr.a ? esc(ownerName(tr.a)) + " gets" : "Team A gets"}</div><div class="chips-p">${chips("aGets", tr.aGets)}</div>${addSel("tvAddA", tr.b, tr.aGets)}</div>`;
    h += `<div class="side"><div class="side-h">${teamSel("tvB", tr.b, tr.a, "Choose Team B")}</div><div class="muted sm">${tr.b ? esc(ownerName(tr.b)) + " gets" : "Team B gets"}</div><div class="chips-p">${chips("bGets", tr.bGets)}</div>${addSel("tvAddB", tr.a, tr.bGets)}</div></div>`;
    h += `<div class="builder-tools"><button type="button" class="linkish" data-swap="1">Swap sides</button><button type="button" class="linkish" data-clear="1">Clear players</button><button type="button" class="linkish" data-mtstart="1">Add a third team</button></div>`;
    if (!tr.a || !tr.b) return h + `<p class="empty">Choose both teams to start.</p>` + dishAndExplain(s);
    if (!tr.aGets.length && !tr.bGets.length) return h + `<p class="empty">Add at least one player to either side.</p>` + dishAndExplain(s);
    const ev = tvEvaluate(T.cons, tr.aGets, tr.bGets);
    const nA = ownerName(tr.a), nB = ownerName(tr.b);
    const winner = ev.favors === "a" ? nA : nB;
    const headline = ev.level === "fair" ? "Fair trade. Shake hands in the fellowship hall." : ev.level === "leans" ? `Leans ${winner}. Close, but ${winner} gets the better end.` : `Highway robbery. ${winner} should be ashamed, and somebody call the deacons.`;
    const pctA = Math.max(4, Math.min(96, (ev.A / Math.max(0.01, ev.A + ev.B)) * 100));
    h += `<div class="verdict ${ev.level}"><b>${headline}</b><div class="vbar" role="img" aria-label="${esc(nA)} ${f1(ev.A)}, ${esc(nB)} ${f1(ev.B)}"><span style="width:${pctA}%"></span></div><div class="vnums"><span>${esc(nA)}: trade score <b class="num">${f1(ev.A)}</b></span><span>${esc(nB)}: trade score <b class="num">${f1(ev.B)}</b></span></div><p class="fine">Trade score is value with the star premium and roster-spot credit applied. ${Math.round(Math.abs(ev.diff) * 100)}% apart.</p><p class="asof-line">Values as of Week ${T.week.week} charts, loaded ${esc(fmtDate(T.week.loaded + "T12:00:00-05:00"))}. Rosters as of ${esc(fmtDate(T.exported, true))}.</p></div>`;
    if (ev.level !== "fair") {
      const shortSide = ev.favors === "a" ? "b" : "a", giver = shortSide === "a" ? tr.b : tr.a;
      const taken = shortSide === "a" ? tr.aGets : tr.bGets;
      const target = ev.gapRaw;
      const near = (s.currentRosters[giver] || []).filter(p => !taken.includes(p) && !(shortSide === "a" ? tr.bGets : tr.aGets).includes(p) && tvV(p) > 0).sort((x, y) => Math.abs(tvV(x) - target) - Math.abs(tvV(y) - target)).slice(0, 3);
      h += `<p class="kick">To even it, ${esc(ownerName(giver))} would add about a <b>${f1(target)}</b> to ${esc(ownerName(shortSide === "a" ? tr.a : tr.b))}'s side.${near.length ? ` Closest on his roster: ${near.map(p => `${esc(tvName(p))} (${f1(tvV(p))})`).join(", ")}.` : ""}</p>`;
    }
    const im = tvImpact(T.cons, s, tr.a, tr.b, tr.aGets, tr.bGets);
    const imp = (n, d) => `<div class="award"><span class="t">${esc(n)}'s lineup</span><span class="v sm ${d > 0.05 ? "w" : d < -0.05 ? "l" : ""}">${d > 0 ? "+" : d < 0 ? "−" : ""}${f1(Math.abs(d))}</span><span class="d">points per week, best lineup</span></div>`;
    h += `<h3>Lineup impact</h3><div class="awards">${imp(nA, im.a)}${imp(nB, im.b)}</div>`;
    const extra = Math.abs(tr.aGets.length - tr.bGets.length);
    if (extra) h += unevenNote(tr.aGets.length > tr.bGets.length ? tr.a : tr.b, extra, [...tr.aGets, ...tr.bGets]);
    const injIn = [...tr.aGets, ...tr.bGets].filter(p => T.cons.byPid[p] && T.cons.byPid[p].inj);
    if (injIn.length) h += `<p class="fine">Injury flag on ${injIn.map(p => esc(tvName(p))).join(", ")}. The value and points per game do not account for missed time.</p>`;
    h += `<details class="explain"><summary>Show the math</summary><p>Plain values: ${esc(nA)} gets ${f1(ev.rawA)}, ${esc(nB)} gets ${f1(ev.rawB)}.</p><p>Adjusted values raise each player's value to the 1.5 power, so one star counts for more than two lesser players. ${ev.spotsA || ev.spotsB ? `${esc(ev.spotsA ? nA : nB)} gets ${f1(ev.credit * (ev.spotsA || ev.spotsB))} of roster-spot credit for receiving fewer players, the worth of a free waiver pickup per spot.` : "Both sides receive the same number of players, so there is no roster-spot credit."} Final: ${f1(ev.A)} to ${f1(ev.B)}, a ${Math.round(Math.abs(ev.diff) * 100)}% gap. Within 10% is fair, within 30% leans, beyond that is robbery.</p><p>Lineup impact rebuilds each team's best starting lineup with the players swapped, using points per game from the charts or, when the charts have none, from this season in our league.</p></details>`;
    return h + dishAndExplain(s);
  }
  // Covered Dish Deals sits below Build a Trade
  const dishAndExplain = s => coveredDishBlock(s) + advisorExplain();
  function advisorExplain() {
    return `<details class="explain"><summary>How trade ideas are picked</summary><p>For every pair of teams we try one-for-one, two-for-one, and two-for-two swaps among each team's top eight healthy players worth 8 or more, this week's pickups included. Injured players, kickers, and defenses are left out.</p><p>A trade makes the list only if the adjusted values land within 10% of each other and both teams' best weekly lineup goes up by at least half a point. The best ones help both sides about equally. Each member gets up to three, with different partners and no player used twice. Fair on the charts cannot account for someone who loves his own players.</p></details>`;
  }

  /* ---------- Shell ---------- */
  function setSheet(open) {
    $("sheet").hidden = !open; $("scrim").hidden = !open;
    $("moreBtn").setAttribute("aria-expanded", open ? "true" : "false");
  }
  let lastView = null;
  function render() {
    const v = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
    document.querySelectorAll("nav.tabs a, nav.bottom a, .sheet a").forEach(a => { const hv = a.getAttribute("href").slice(1); if (hv === v || (a.dataset.desk && deskViews.includes(v))) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (moreViews.includes(v)) $("moreBtn").setAttribute("aria-current", "page"); else $("moreBtn").removeAttribute("aria-current");
    setSheet(false);
    $("seasonWrap").hidden = v === "home" || v === "chart" || v === "advisor";
    const y = window.scrollY;
    const fn = { home, standings, week, rivals, members, history, draft, moves, trades, chart, advisor, gifts, prophets, work }[v];
    const view = $("view");
    try { view.innerHTML = fn(); }
    catch (e) { view.innerHTML = `<p class="empty">This page did not load: ${esc(e.message)}. Pick another season or refresh.</p>`; return; }
    view.querySelectorAll("table[data-hide]").forEach(t => {
      const idx = t.dataset.hide.split(",").map(Number);
      t.querySelectorAll("tr").forEach(tr => { if (tr.classList.contains("altar")) return; idx.forEach(i => { if (tr.children[i]) tr.children[i].classList.add("opt"); }); });
      const box = t.closest(".scroll"); if (!box) return;
      box.classList.add("hide-opt");
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "more-cols"; btn.textContent = "Show all stats";
      btn.addEventListener("click", () => { const on = box.classList.toggle("hide-opt"); btn.textContent = on ? "Show all stats" : "Show fewer stats"; });
      box.after(btn);
    });
    const heads = [...view.querySelectorAll("h2:not(.hero-h)")];
    const jumpHeads = heads.slice(1);
    if (v !== "home" && jumpHeads.length >= 2) {
      const j = document.createElement("div"); j.className = "jump"; j.setAttribute("role", "navigation"); j.setAttribute("aria-label", "Jump to section");
      jumpHeads.forEach(hd => { const b = document.createElement("button"); b.type = "button"; b.textContent = hd.textContent; b.addEventListener("click", () => hd.scrollIntoView({ block: "start" })); j.appendChild(b); });
      const dk = view.querySelector(".desk"); if (dk) dk.after(j); else view.prepend(j);
    }
    const pressed = view.querySelector('.chips button[data-week][aria-pressed="true"]');
    if (pressed) pressed.parentElement.scrollLeft = pressed.offsetLeft - pressed.parentElement.clientWidth / 2 + pressed.offsetWidth / 2;
    if (st.goto) {
      const target = heads.find(hd => hd.textContent === st.goto);
      st.goto = null;
      if (target) { target.scrollIntoView({ block: "start" }); lastView = v; return; }
    }
    if (lastView !== v) window.scrollTo(0, 0); else window.scrollTo(0, y);
    lastView = v;
  }
  $("moreBtn").addEventListener("click", () => setSheet($("sheet").hidden));
  $("scrim").addEventListener("click", () => setSheet(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape") { setSheet(false); closeCard(); } });
  $("pscrim").addEventListener("click", closeCard);
  $("pcard").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pcclose) { closeCard(); return; }
    if (b.dataset.pcshop) { st.shopPid = b.dataset.pcshop; st.ideasFor = b.dataset.pcowner; st.multi = null; closeCard(); st.goto = "The Offering"; if (location.hash === "#advisor") render(); else location.hash = "advisor"; return; }
    if (b.dataset.pcchart) { const key = b.dataset.pcchart, pos = b.dataset.pcpos; closeCard(); st.chartOpen = key; if (st.chartPos !== "all" && st.chartPos !== pos) st.chartPos = "all"; st.goto = null; if (location.hash === "#chart") render(); else location.hash = "chart"; setTimeout(() => { const r = document.querySelector(`[data-tvrow="${CSS.escape(key)}"]`); if (r) r.scrollIntoView({ block: "center" }); }, 60); }
  });

  const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
  const showTip = el => { const r = el.getBoundingClientRect(); tip.textContent = el.dataset.tip; tip.hidden = false; const tw = tip.offsetWidth; tip.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + "px"; tip.style.top = (r.top + window.scrollY - tip.offsetHeight - 8) + "px"; };
  $("view").addEventListener("pointerover", e => { const p = e.target.closest("[data-tip]"); if (p && e.pointerType === "mouse") showTip(p); });
  $("view").addEventListener("pointerout", e => { if (e.target.closest("[data-tip]") && e.pointerType === "mouse") tip.hidden = true; });
  $("view").addEventListener("focusin", e => { const p = e.target.closest("[data-tip]"); if (p) showTip(p); });
  window.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
  $("view").addEventListener("click", e => {
    const p = e.target.closest("[data-tip]"); if (p) { showTip(p); return; } else tip.hidden = true;
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pid) { openCard(b.dataset.pid, b); return; }
    if (b.dataset.go) {
      if (b.dataset.who) { st.rival = b.dataset.who; st.rivalB = null; }
      if (b.dataset.member) st.member = b.dataset.member;
      if (b.dataset.gteam) { st.gTeam = b.dataset.gteam; st.gView = "position"; }
      if (b.dataset.go !== "home") { st.year = st.model.latest.year; $("season").value = st.year; }
      if (b.dataset.go === "trades") st.tradeScope = "all";
      st.goto = b.dataset.sec;
      if (location.hash === "#" + b.dataset.go) render(); else location.hash = b.dataset.go;
      return;
    }
    if (b.dataset.tvpos) { st.chartPos = b.dataset.tvpos; render(); return; }
    if (b.dataset.mtsel) { const u0 = b.dataset.mtsel; if (st.mtSel.has(u0)) st.mtSel.delete(u0); else if (st.mtSel.size < 6) st.mtSel.add(u0); render(); return; }
    if (b.dataset.mtpair) { st.mtPair = !st.mtPair; render(); return; }
    if (b.dataset.mtlock) { const p0 = b.dataset.mtlock; if (st.mtLock.has(p0)) st.mtLock.delete(p0); else st.mtLock.add(p0); const dl = b.closest("details"); render(); const nd = document.querySelector("details.mt-lock"); if (dl && nd) nd.open = true; return; }
    if (b.dataset.mtfind) { const teams = [...st.mtSel]; if (st.me && teams.includes(st.me)) teams.splice(teams.indexOf(st.me), 1), teams.unshift(st.me); b.disabled = true; b.textContent = "Searching…"; setTimeout(() => { st.mtRes = { key: mtKey(), r: mtSearch(st.tv.cons, st.model.latest, teams, { twoForOne: st.mtPair && teams.length <= 4, locked: st.mtLock }) }; render(); }, 30); return; }
    if (b.dataset.mtload) { const R = st.mtRes && st.mtRes.r; const d0 = b.dataset.mtload === "n" ? R && R.nearest : b.dataset.mtload === "c" ? R && R.closest : R && R.deals[+b.dataset.mtload]; if (d0) { st.multi = { teams: d0.loop.slice(), moves: d0.moves.map(m => ({ ...m })) }; st.goto = "Build a Trade"; render(); } return; }
    if (b.dataset.mtstart) { const T0 = st.trade; st.multi = { teams: [T0.a, T0.b].filter(Boolean), moves: [...T0.aGets.map(p => ({ pid: p, from: T0.b, to: T0.a })), ...T0.bGets.map(p => ({ pid: p, from: T0.a, to: T0.b }))] }; render(); return; }
    if (b.dataset.mtdrop) { const u0 = b.dataset.mtdrop; st.multi.teams = st.multi.teams.filter(x => x !== u0); st.multi.moves = st.multi.moves.filter(m => m.from !== u0 && m.to !== u0); render(); return; }
    if (b.dataset.mtrm) { st.multi.moves.splice(+b.dataset.mtrm, 1); render(); return; }
    if (b.dataset.mtclear) { st.multi.moves = []; render(); return; }
    if (b.dataset.mtback) { const M0 = st.multi, [a0, b0] = M0.teams; st.trade = { a: a0, b: b0, aGets: M0.moves.filter(m => m.to === a0).map(m => m.pid), bGets: M0.moves.filter(m => m.to === b0).map(m => m.pid) }; st.multi = null; render(); return; }
    if (b.dataset.mtadd) { if (st.mtPick && st.mtTo) { const from = st.multi.teams.find(x => (st.model.latest.currentRosters[x] || []).includes(st.mtPick)); if (from && from !== st.mtTo) st.multi.moves.push({ pid: st.mtPick, from, to: st.mtTo }); st.mtPick = ""; st.mtTo = ""; } render(); return; }
    if (b.dataset.gbpub) { publishPending(); return; }
    if (b.dataset.gbcancel) { st.pending = null; st.pubMsg = null; render(); return; }
    if (b.dataset.prayall) { st.prayAll = true; render(); return; }
    if (b.dataset.tierjump) { const el = document.getElementById("tier-" + b.dataset.tierjump); if (el) el.scrollIntoView({ block: "start" }); return; }
    if (b.dataset.prview) { st.prView = b.dataset.prview; store.set("gb-prview", st.prView); render(); return; }
    if (b.dataset.gview) { st.gView = b.dataset.gview; render(); return; }
    if (b.dataset.gpartner) { st.trade = { a: st.gTeam, b: b.dataset.gpartner, aGets: [], bGets: [] }; st.goto = "Build a Trade"; location.hash = "advisor"; return; }
    if (b.dataset.tvmore) { st.chartAll = true; render(); return; }
    if (b.dataset.tvrow) { st.chartOpen = st.chartOpen === b.dataset.tvrow ? null : b.dataset.tvrow; render(); return; }
    if (b.dataset.tvadd) { tvAddToTrade(b.dataset.tvadd); return; }
    if (b.dataset.wpos) { st.wPos = b.dataset.wpos; st.wAll = false; render(); return; }
    if (b.dataset.wall) { st.wAll = !st.wAll; render(); return; }
    if (b.dataset.wmove) { st.wMove = b.dataset.wmove; st.wMoveAll = false; render(); return; }
    if (b.dataset.wmoveall) { st.wMoveAll = !st.wMoveAll; render(); return; }
    if (b.dataset.shopwant) { st.shopWant = b.dataset.shopwant; render(); return; }
    if (b.dataset.shop) { const [who, i] = b.dataset.shop.split("|"); const t = st.shopPid && shopData(who, st.shopPid).rows[+i]; if (t) { st.multi = null; st.trade = { a: who, b: t.partner, aGets: t.get.slice(), bGets: t.send.slice() }; st.goto = "Build a Trade"; render(); } return; }
    if (b.dataset.idea) { const [who, i] = b.dataset.idea.split("|"); const t = tvIdeas(who)[+i]; if (t) { st.trade = { a: who, b: t.partner, aGets: t.get.slice(), bGets: t.send.slice() }; st.goto = "Build a Trade"; if (location.hash === "#advisor") render(); else location.hash = "advisor"; } return; }
    if (b.dataset.rm) { const [side, pid] = b.dataset.rm.split("|"); const T = st.trade; T[side] = T[side].filter(p => p !== pid); render(); return; }
    if (b.dataset.swap) { const T = st.trade; st.trade = { a: T.b, b: T.a, aGets: T.bGets, bGets: T.aGets }; render(); return; }
    if (b.dataset.clear) { st.trade = { a: st.trade.a, b: st.trade.b, aGets: [], bGets: [] }; render(); return; }
    if (b.dataset.me !== undefined) { st.me = b.dataset.me || null; store.set("gb-me", st.me); if (st.me) { st.member = st.me; st.rival = st.me; st.rivalB = null; } render(); return; }
    if (b.dataset.pa) { st.rival = b.dataset.pa; st.rivalB = b.dataset.pb; st.goto = "Head to Head"; render(); return; }
    if (b.dataset.week) { st.week = +b.dataset.week; render(); }
    if (b.dataset.scope) { st.rivalScope = b.dataset.scope; render(); }
    if (b.dataset.po) { st.withPO = b.dataset.po === "1"; render(); }
    if (b.dataset.view) { st.standView = b.dataset.view; render(); }
    if (b.dataset.ap) { st.apScope = b.dataset.ap; render(); }
    if (b.dataset.trade) { st.tradeScope = b.dataset.trade; render(); }
    if (b.dataset.wk) { st.wireKind = b.dataset.wk; render(); }
    if (b.dataset.ws) { st.wireScope = b.dataset.ws; render(); }
    if (b.dataset.wm) { st.wireMode = b.dataset.wm; render(); }
    if (b.dataset.wb) { st.wireBar = b.dataset.wb; render(); }
  });
  $("view").addEventListener("change", e => {
    const id = e.target.id;
    if (id === "rival") { st.rival = e.target.value; if (st.rivalB === st.rival) st.rivalB = null; render(); }
    if (id === "rivalB") { st.rivalB = e.target.value; render(); }
    if (id === "member") { st.member = e.target.value; render(); }
    if (id === "eloWho") { st.eloWho = e.target.value; render(); }
    if (id === "tvA") { st.trade = { a: e.target.value || null, b: st.trade.b === e.target.value ? null : st.trade.b, aGets: [], bGets: [] }; render(); }
    if (id === "tvB") { st.trade = { a: st.trade.a, b: e.target.value || null, aGets: [], bGets: [] }; render(); }
    if (id === "tvAddA" && e.target.value) { if (!st.trade.aGets.includes(e.target.value)) st.trade.aGets.push(e.target.value); render(); }
    if (id === "tvAddB" && e.target.value) { if (!st.trade.bGets.includes(e.target.value)) st.trade.bGets.push(e.target.value); render(); }
    if (id === "mtAddTeam" && e.target.value) { st.multi.teams.push(e.target.value); render(); }
    if (id === "mtP") { st.mtPick = e.target.value; render(); }
    if (id === "mtTo") { st.mtTo = e.target.value; render(); }
    if (id === "gWeek") { st.gWeek = e.target.value; render(); }
    if (id === "gTeam") { st.gTeam = e.target.value; render(); }
    if (id === "ideasFor") { st.ideasFor = e.target.value; render(); }
    if (id === "wTeam") { st.wTeam = e.target.value; render(); }
    if (id === "shopPid") { st.shopPid = e.target.value || null; render(); }
  });
  $("season").addEventListener("change", e => { st.year = e.target.value; st.week = null; render(); });
  window.addEventListener("hashchange", render);

  const COMMISH = "BentonPerret";
  const NICK = { DictatorWest: "Connor", couldatoldya: "Jeremy", bamahof: "Matt O", Lingo450: "Shane", BentonPerret: "Benton", nathanalemons: "Nathan", KevinDrex: "Kevin", EnuffHuff: "Garrett", JakeTheSnake08: "Jake", MattHuck21: "Huckaby", TFesmire: "Tristan", Maustin99: "Michael", JukingGentile: "Ryan", KurtzCousins: "Brian", NateAWalker: "Nate", "Open roster 2025": "Basil" };

  /* ---------- Data refresh: drop a new league-export.json and publish it for everyone (editors only) ---------- */
  st.canEdit = false; st.pending = null; st.pubMsg = null;
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("user").then(u0 => (u0 ? u0.canEdit() : false)).then(v => { st.canEdit = !!v; if (v && st.model) render(); }).catch(() => {});
  }
  function refreshPanel() {
    if (!st.canEdit) return "";
    let h = `<section class="refresh" id="refresh"><h3>Update the league data</h3><p class="fine top">Commissioner only. Drop the new league-export.json here, or choose it from your files. Nothing changes until you publish.</p><p class="fine"><b>Step 1:</b> <a href="https://bperret.github.io/Gambling-Baptist-/" target="_blank" rel="noopener">open the Sleeper export page</a>, tap Export league, and save the file. <b>Step 2:</b> drop it below.</p>`;
    h += `<label class="dropzone" id="dropzone"><input type="file" id="gbFile" accept=".json,application/json"><span><b>Drop league-export.json</b> or tap to choose it</span></label>`;
    const P = st.pending;
    if (P && P.error) h += `<div class="warn"><b>That file will not work.</b> ${esc(P.error)}</div>`;
    else if (P) {
      h += `<div class="pend"><b>Ready to publish</b><ul>${P.lines.map(l => `<li>${l}</li>`).join("")}</ul>${P.warns.map(w => `<div class="warn">${w}</div>`).join("")}<div class="pend-btns"><button type="button" class="go-btn" data-gbpub="1">Publish for everyone</button><button type="button" class="linkish" data-gbcancel="1">Cancel</button></div></div>`;
    }
    if (st.pubMsg) h += `<p class="fine ${st.pubMsg.ok ? "ok-msg" : "bad-msg"}">${esc(st.pubMsg.text)}</p>`;
    return h + `</section>`;
  }
  function readExport(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return { error: "It is not valid JSON. Run the export again and use the file it saves." }; }
    if (!raw || !/^ffbc-sleeper-v\d+$/.test(raw.format || "") || !Array.isArray(raw.seasons) || !raw.seasons.length || !raw.players) return { error: "It is not a league export from the Gambling Baptist export page." };
    let model;
    try { model = buildLeague(raw); } catch (e) { return { error: "The app could not read it (" + e.message + ")." }; }
    const cur = st.raw, warns = [], s = model.latest;
    const lid = x => x && x.seasons && x.seasons[0] && x.seasons[0].league && x.seasons[0].league.league_id;
    if (cur && lid(cur) && lid(raw) !== lid(cur)) warns.push(`<b>Different league.</b> This file is for league ${esc(lid(raw))}, not ${esc(lid(cur))}.`);
    if (cur && cur.exported && raw.exported && new Date(raw.exported) < new Date(cur.exported)) warns.push(`<b>Older than what is live.</b> This export is from ${esc(fmtDate(raw.exported, true))}; the app has ${esc(fmtDate(cur.exported, true))}.`);
    const lines = [`Exported ${esc(fmtDate(raw.exported, true))}`, `${model.seasons.length} seasons, ${s.year} through week ${s.regWeeks.length ? Math.max(...s.regWeeks) : 0}`, raw.projections && raw.projections.pts ? `Week ${raw.projections.week} projections for ${Object.keys(raw.projections.pts).length} players${raw.projections.scoring === "league" && raw.projections.check && raw.projections.check.n ? `, scored the league's way (scoring check: ${(100 * raw.projections.check.exact / raw.projections.check.n).toFixed(1)}% exact)` : ""}` : "No projections in this file", `${Object.keys(raw.injuries || {}).length} injury tags`];
    return { raw, lines, warns };
  }
  // Rebuild the whole page with the data inline, for hosts that only take a full-page publish
  function rebuildPage(dataText) {
    const srcEl = document.getElementById("gb-src"); if (!srcEl) return null;
    const src = JSON.parse(srcEl.textContent);
    const safe = t => t.replace(/</g, "\\u003c");
    const vals = st.values ? JSON.stringify(st.values) : null;
    return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${src.reset}</style></head><body>${src.shell}<script type="application/json" id="gb-data">${safe(dataText)}<\/script>${vals ? `<script type="application/json" id="gb-values">${safe(vals)}<\/script>` : ""}<script type="application/json" id="gb-src">${safe(JSON.stringify(src))}<\/script><script>${src.app}<\/script></body></html>`;
  }
  async function publishPending() {
    const P = st.pending; if (!P || !P.raw) return;
    const art = await window.claude.use("artifact");
    if (!art) { st.pubMsg = { ok: false, text: "Publishing is not available in this view. Open the app in Claude to publish." }; render(); return; }
    const raw = P.raw; raw.dykBump = ((st.raw && st.raw.dykBump) || 0) + 1;
    const text = JSON.stringify(raw);
    const fail = e => {
      const c = e && e.code;
      st.pubMsg = { ok: false, text: c === "not_writer" || c === "not_granted" || c === "consent_required" ? "This view can look but not publish." : c === "conflict" ? "Someone published a newer version first. The page is reloading to it; drop the file again after." : c === "too_large" ? "The file is too large to publish." : c === "rate_limited" ? "Too many publishes in a row. Wait a minute and try again." : "Publishing did not go through (" + ((e && e.message) || "unknown error") + "). Try again." };
      render();
    };
    const html = () => { const doc = rebuildPage(text); if (!doc) return fail({ message: "this page cannot rebuild itself" }); st.pubMsg = { ok: true, text: "Publishing…" }; render(); return art.publish(doc).then(() => { st.pending = null; st.pubMsg = { ok: true, text: "Published. The app is reloading with the new data." }; render(); }).catch(fail); };
    if (document.getElementById("gb-data")) return html();
    try {
      st.pubMsg = { ok: true, text: "Publishing…" }; render();
      await art.publish({ "data.json": { content: text, contentType: "application/json" } });
      st.pending = null; st.pubMsg = { ok: true, text: "Published. Everyone sees the new data the next time they open the app." };
      start(raw);
    } catch (e) {
      if (e && e.code === "capability_disabled") return html();
      fail(e);
    }
  }
  function takeFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { st.pending = readExport(String(r.result)); st.pubMsg = null; render(); const el = document.getElementById("refresh"); if (el) el.scrollIntoView({ block: "start" }); };
    r.readAsText(file);
  }
  document.addEventListener("change", e => { if (e.target && e.target.id === "gbFile") takeFile(e.target.files && e.target.files[0]); });
  document.addEventListener("dragover", e => { const z = e.target.closest && e.target.closest("#dropzone"); if (z) { e.preventDefault(); z.classList.add("over"); } });
  document.addEventListener("dragleave", e => { const z = e.target.closest && e.target.closest("#dropzone"); if (z) z.classList.remove("over"); });
  document.addEventListener("drop", e => { const z = e.target.closest && e.target.closest("#dropzone"); if (!z) return; e.preventDefault(); z.classList.remove("over"); takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });

  function start(raw) {
    st.raw = raw;
    Object.assign(st, { gCache: {}, ppCache: {}, stakeCache: {}, dCache: {}, scaleCache: {}, ideaCache: {}, mtRes: null, multi: null });
    st.model = buildLeague(raw); st.pIdx = undefined; st.prCache = null; st.wk = undefined;
    Object.values(st.model.owners).forEach(o => { if (NICK[o.name]) { o.handle = o.name; o.name = NICK[o.name]; } });
    st.model.seasons.forEach(x => Object.keys(x.teamName).forEach(uid => { const o = st.model.owners[uid]; if (o && o.handle && x.teamName[uid] === o.handle) x.teamName[uid] = "Team " + o.name; }));
    const s = st.model.latest;
    st.year = s.year;
    const saved = store.get("gb-me"); if (saved && st.model.owners[saved]) st.me = saved;
    if (store.get("gb-prview") === "rev") st.prView = "rev";
    if (st.me) { st.member = st.me; st.rival = st.me; }
    tvInit(raw);
    $("lsub").textContent = `${s.uids.length} teams, full PPR, season ${st.model.seasons.length}`;
    $("season").innerHTML = st.model.seasons.slice().reverse().map(x => `<option value="${esc(x.year)}">${esc(x.year)}</option>`).join("");
    $("banner").hidden = !st.model.example;
    if (st.model.exported) $("foot").textContent = `A private league among friends. Not a church ministry or event, and not endorsed by any church. Data from Sleeper, updated ${new Date(st.model.exported).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`;
    render();
  }

  const getJSON = f => fetch(f).then(r => { if (!r.ok) throw new Error(f + " status " + r.status); return r.json(); });
  // A page republished from the drop zone carries its data inline; otherwise read the published files
  const inlineJSON = id => { const el = document.getElementById(id); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } };
  const dIn = inlineJSON("gb-data"), vIn = inlineJSON("gb-values");
  Promise.all([dIn ? Promise.resolve(dIn) : getJSON("data.json"), vIn ? Promise.resolve(vIn) : getJSON("values.json").catch(() => null), getJSON("notes.json").catch(() => null)])
    .then(([raw, vals, notes]) => { st.values = vals; st.notes = notes; start(raw); })
    .catch(e => { $("view").innerHTML = `<p class="empty">The league data did not load (${esc(e.message)}). Refresh the page to try again.</p>`; });
})();
