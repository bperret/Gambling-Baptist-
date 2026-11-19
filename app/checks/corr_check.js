// Realized correlations from the replay curves, against the CORR targets in src/app.js.
// Usage: node checks/corr_check.js [src/app.js]
// Pulls CORR, CORR_LIFT, and corrSampler out of the source, builds one NFL game (both teams' usual starters),
// draws 200,000 replays with the Vigil curve shapes (lognormal tail plus duds; K and DEF normal), and compares.
// Fails when any pair with |target| >= 0.05 lands more than 0.03 away, or a block had to be shrunk.
const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || "src/app.js", "utf8");
const grab = re => { const m = src.match(re); if (!m) throw new Error("missing " + re); return m[0]; };
const block = grab(/  const CORR = [\s\S]*?\n  const corrSampler = list => \{[\s\S]*?\n  \};\n/);
const fb = grab(/const VG_FALLBACK = \{.*\};/);
const lifted = { shrunk: 0 };
const mod = new Function("lifted", block.replace("if (!L) shrink *= 0.85;", "if (!L) { shrink *= 0.85; lifted.shrunk++; }") + fb + "\nreturn { CORR, CORR_LIFT, corrPair, corrSampler, VG_FALLBACK };")(lifted);
const { CORR, CORR_LIFT, corrPair, corrSampler, VG_FALLBACK } = mod;

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// Typical starters, widened 1.4x like the Vigil
const side = (team, opp) => ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "K", "DEF"].map(pos => ({ pos, team, opp }));
const list = side("AAA", "BBB").concat(side("BBB", "AAA"));
const curve = pos => { const f = VG_FALLBACK[pos], mu = f.avg, sd = f.cv * mu * 1.4, skew = pos !== "K" && pos !== "DEF", s2 = Math.log(1 + (sd / mu) ** 2); return { mu, sd, skew, lm: Math.log(mu) - s2 / 2, ls: Math.sqrt(s2), dud: skew ? f.dud : 0 }; };
const cv = list.map(x => curve(x.pos));
const samp = corrSampler(list);
const N = 200000, n = list.length, S = new Float64Array(n), SS = new Float64Array(n), SP = list.map(() => new Float64Array(n));
for (let i = 0; i < N; i++) {
  const z = samp(gauss), v = new Float64Array(n);
  for (let j = 0; j < n; j++) { const f = cv[j]; v[j] = f.dud && rnd() < f.dud ? rnd() * 0.25 * f.mu : f.skew ? Math.exp(f.lm + f.ls * z[j]) : f.mu + f.sd * z[j]; }
  for (let a = 0; a < n; a++) { S[a] += v[a]; SS[a] += v[a] * v[a]; for (let b = a + 1; b < n; b++) SP[a][b] += v[a] * v[b]; }
}
const r = (a, b) => { const ma = S[a] / N, mb = S[b] / N; return (SP[a][b] / N - ma * mb) / Math.sqrt((SS[a] / N - ma * ma) * (SS[b] / N - mb * mb)); };
const seen = {}; let bad = 0;
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
  const t = corrPair(list[a], list[b]);
  const rel = list[a].team === list[b].team ? "same" : "opp", key = rel + ":" + [list[a].pos, list[b].pos].sort().join("-");
  if (seen[key]) continue; seen[key] = 1;
  const got = r(a, b), off = got - t, flag = Math.abs(t) >= 0.05 && Math.abs(off) > 0.03;
  if (flag) bad++;
  console.log(`${key.padEnd(14)} target ${t.toFixed(2).padStart(5)}  realized ${got.toFixed(3).padStart(6)}  ${flag ? "OFF" : ""}`);
}
console.log(`CORR_LIFT ${JSON.stringify(CORR_LIFT)}, blocks shrunk ${lifted.shrunk}, pairs off ${bad}`);
process.exit(bad || lifted.shrunk ? 1 : 0);
