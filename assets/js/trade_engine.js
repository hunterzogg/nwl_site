// Trade valuation engine shared by the Trade Calculator (pages/trade-tools.html) and the Trade
// Finder (pages/trade-finder.html), so both grade a trade identically. Plain globals, like shared.js:
// a page loads this after shared.js, then sets D = trade_values.json before calling anything.
let D = null;
const EXP = 1.5;        // consolidation exponent: a side is worth (sum of value^1.5)^(1/1.5)
const FAIR = 0.08;      // within 8% of each other = fair
const SOURCES = { fantasycalc: 'FantasyCalc', ktc: 'KeepTradeCut', fantasypros: 'FantasyPros ECR', espn: 'ESPN ROS', fanduel: 'FanDuel ROS', fantasyguys: 'FantasyGuys ROS' };
const RANKED = { fantasypros: 1, espn: 1, fanduel: 1, fantasyguys: 1 };
const SLOT = { QB: 1, RB: 2, WR: 2, TE: 1, HC: 1 };
const FLEX = [['W/T', ['WR', 'TE']], ['FLEX', ['RB', 'WR', 'TE']]];

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Math.round(n).toLocaleString();
const sgn = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function Phi(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

const P = id => D.players[id];
const mv = id => D.market[id] || 0;
const team = mgr => D.teams.find(t => t.manager === mgr);
const ownerOf = id => (D.teams.find(t => t.players.includes(id) || t.ir.includes(id)) || {}).manager || null;
const adj = vals => Math.pow(vals.reduce((s, v) => s + Math.pow(Math.max(0, v), EXP), 0), 1 / EXP);
// Rest-of-season positional rank: median of the rank sources (FantasyPros ECR, ESPN, FanDuel, FantasyGuys).
const RANK_LABEL = { fantasypros: 'FantasyPros', espn: 'ESPN', fanduel: 'FanDuel', fantasyguys: 'FantasyGuys' };
function wMedian(pairs) { // [(value, weight)] -> weighted median, same rule as build_trade_values.py
  pairs = [...pairs].sort((a, b) => a[0] - b[0]); const total = pairs.reduce((t, x) => t + x[1], 0); let acc = 0;
  for (let i = 0; i < pairs.length; i++) { acc += pairs[i][1]; if (acc * 2 > total) return pairs[i][0]; if (acc * 2 === total) return (pairs[i][0] + pairs[i + 1][0]) / 2; }
  return pairs[pairs.length - 1][0];
}
function rosRank(id) {
  const r = (D.ranks || {})[id]; if (!r || !Object.keys(r).length) return null;
  const W = D.source_weights || {}, miss = (D.unranked || {})[id] || [];
  const m = wMedian(Object.entries(r).map(([k, x]) => [x, W[k] || 1]));
  return { rank: Math.round(m), detail: Object.entries(r).map(([k, x]) => `${RANK_LABEL[k] || k} ${miss.includes(k) ? 'unranked (counted as ' + P(id).pos + x + ')' : P(id).pos + x}${W[k] > 1 ? ' ×' + W[k] : ''}`).join(' · ') };
}
const rankCell = id => { const r = rosRank(id); return r ? `<div class="tc-prank" title="ROS rank: ${esc(r.detail)}">${esc(P(id).pos)}${r.rank}<small>ROS</small></div>` : `<div class="tc-prank" title="Not ranked by the ROS sources">—<small>ROS</small></div>`; };
// Waiver-level: a traded player whose production is freely available. Measured against a sturdy
// replacement bar, not the single best free agent (one outlier projection used to flag starters):
//   - healthy free agents only (no OUT / IR / DOUBTFUL / suspended)
//   - projection bar = the 3rd-best healthy free agent's proj pts/g (12 teams chase the same few)
//   - rank bar = the 3rd-best healthy free agent's consensus ROS rank
// A player is waiver-level only if BOTH agree: projected within 0.5 pts/g of the bar AND ranked no
// better than it. He then counts at half his market value (not zero: market value also prices
// contingent upside, e.g. a handcuff RB).
const WAIVER_MARGIN = 0.5, WAIVER_DISCOUNT = 0.5, REPL_DEPTH = 3;
const healthy = p => !['OUT', 'INJURY_RESERVE', 'DOUBTFUL', 'SUSPENSION'].includes(p.inj);
let _repl = null;
function replacement(pos) {
  if (!_repl) {
    _repl = {};
    for (const ps of ['QB', 'RB', 'WR', 'TE']) {
      const fas = D.free_agents.map(P).filter(p => p.pos === ps && healthy(p));
      const byPg = [...fas].sort((a, b) => b.ros_pg - a.ros_pg);
      const byRank = fas.map(p => ({ p, r: (rosRank(p.id) || {}).rank })).filter(x => x.r).sort((a, b) => a.r - b.r);
      const k = REPL_DEPTH - 1;
      _repl[ps] = byPg[k] ? { pg: byPg[k].ros_pg, pgPlayer: byPg[k], rank: byRank[k] ? byRank[k].r : Infinity } : null;
    }
  }
  return _repl[pos];
}
function waiverLevel(id) {
  const p = P(id); if (p.pos === 'HC') return null;
  const r = replacement(p.pos); if (!r) return null;
  const rk = (rosRank(id) || {}).rank;
  return p.ros_pg <= r.pg + WAIVER_MARGIN && (!rk || rk >= r.rank) ? r : null;
}
// Value trend arrow: only for significant ~2-week moves (see build_trade_values.py). Until two weeks of
// daily snapshots exist, FantasyCalc's 30-day trend stands in, and the tooltip says so.
function trendIcon(id) {
  const t = (D.trends || {})[id]; if (!t) return '';
  const up = t.delta > 0, pct = Math.round(Math.abs(t.pct) * 100);
  const basis = t.basis === 'fantasycalc30d' ? 'FantasyCalc, last 30 days' : `consensus value, last ${parseInt(t.basis)} days`;
  return `<span class="tc-trend ${up ? 'up' : 'down'}" title="${up ? 'Up' : 'Down'} ${fmt(Math.abs(t.delta))} (${up ? '+' : '−'}${pct}%) · ${basis}" aria-label="Trending ${up ? 'up' : 'down'} ${pct}%">${up ? '▲' : '▼'}</span>`;
}
const tv = (id, src) => (src ? (src[id] || 0) : mv(id)) * (waiverLevel(id) ? WAIVER_DISCOUNT : 1); // trade value used in all totals

/* ---------- player strength ---------- */
// A player's rest-of-season points per game = average of ESPN's projection and the pts/g his consensus ROS
// rank implies (positional rank N = the Nth-best ESPN projection at his position). ESPN's number alone can be
// an outlier (Oct 16: Dak Prescott projected lowest of the 12 starting QBs while every rank source had him QB6-7).
// Head Coaches have no ranks, so they keep ESPN's projection.
let _rankCurve = null; const _blend = new Map();
function rankPg(p) {
  if (!_rankCurve) { _rankCurve = {}; for (const pos of ['QB', 'RB', 'WR', 'TE']) _rankCurve[pos] = Object.values(D.players).filter(x => x.pos === pos).map(x => x.ros_pg || 0).sort((a, b) => b - a); }
  const r = (rosRank(p.id) || {}).rank, c = _rankCurve[p.pos];
  return r && c && c.length ? c[Math.min(r, c.length) - 1] : p.ros_pg || 0;
}
function blendPg(p) {
  if (_blend.has(p.id)) return _blend.get(p.id);
  const v = p.pos === 'HC' ? p.ros_pg || 0 : 0.5 * (p.ros_pg || 0) + 0.5 * rankPg(p);
  _blend.set(p.id, v); return v;
}
// Lineup value blends two horizons: the rest of the season (injuries ignored, so a hurt star still counts) and
// the next 4 weeks, rebuilt week by week with injured players' expected missed games taken out so whoever
// fills in counts (byes ignored: waivers cover a bye).
const NOW_WEEKS = 4, NEED_W = { ros: 0.6, short: 0.4 };
// share of a game expected for each upcoming week, starting now
const AVAIL = { OUT: [0], DOUBTFUL: [0.25], QUESTIONABLE: [0.8], INJURY_RESERVE: [0, 0, 0, 0], SUSPENSION: [0, 0] };
// A winning team can ride out an absence (half the discount, so it buys injured players low); a losing team
// can't wait (the absence counts twice as long, so injured players are worth less to it).
const tolOf = mgr => { const t = team(mgr); return !t ? 'even' : t.w > t.l ? 'patient' : t.w < t.l ? 'urgent' : 'even'; };
function avail(p, wk, tol) {
  const a = AVAIL[p.inj]; if (!a) return 1;
  const i = wk - D.week, len = tol === 'urgent' ? a.length * 2 : a.length;
  if (i < 0 || i >= len) return 1;
  const v = a[Math.min(i, a.length - 1)];
  return tol === 'patient' ? 1 - 0.5 * (1 - v) : v;
}
function nowWeeks() { const out = []; for (let w = D.week; w <= Math.max(D.week, Math.min(D.regular_season_weeks, D.week + NOW_WEEKS - 1)); w++) out.push(w); return out; }
const playsPg = (p, w, tol) => blendPg(p) * avail(p, w, tol);
function shortPts(ids, tol) { const wks = nowWeeks(); return wks.reduce((t, w) => t + lineup(ids, p => playsPg(p, w, tol)).pts, 0) / wks.length; }

/* ---------- lineups (rest-of-season points per game) ---------- */
function lineup(ids, ptsFn) { // ptsFn(player) -> points per game; default = blended rest-of-season pts/g
  const by = { QB: [], RB: [], WR: [], TE: [], HC: [] };
  for (const id of ids) { const p = P(id); if (p && by[p.pos]) by[p.pos].push([ptsFn ? ptsFn(p) : blendPg(p), id]); }
  let pts = 0; const st = []; const left = [];
  for (const pos in by) {
    by[pos].sort((a, b) => b[0] - a[0]);
    by[pos].forEach((x, k) => { if (k < SLOT[pos]) { pts += x[0]; st.push([pos, x[1], x[0]]); } else left.push([pos, x[1], x[0]]); });
  }
  left.sort((a, b) => b[2] - a[2]);
  for (const [slot, el] of FLEX) { const k = left.findIndex(x => el.includes(x[0])); if (k >= 0) { const x = left.splice(k, 1)[0]; pts += x[2]; st.push([slot, x[1], x[2]]); } }
  return { pts, st };
}
// A roster as it would actually be used: over the limit -> drop whoever costs the lineup least (never the
// only HC); under the limit -> claim the free agents that help most. Same treatment before and after a
// trade, so a trade only gets credit for the roster spots it opens or fills.
function settle(ids) {
  let roster = [...ids]; const drops = [], adds = [];
  const isOnlyHC = id => P(id).pos === 'HC' && roster.filter(x => P(x).pos === 'HC').length <= 1;
  while (roster.length > D.roster_size) {
    const base = lineup(roster).pts; let best = null;
    for (const id of roster) { if (isOnlyHC(id)) continue; const loss = base - lineup(roster.filter(x => x !== id)).pts; if (!best || loss < best.loss - 1e-9 || (Math.abs(loss - best.loss) < 1e-9 && mv(id) < mv(best.id))) best = { id, loss }; }
    roster = roster.filter(x => x !== best.id); drops.push(best);
  }
  const pool = D.free_agents.filter(id => !roster.includes(id));
  while (roster.length < D.roster_size) {
    const base = lineup(roster).pts; let best = null;
    for (const id of pool) { if (adds.some(a => a.id === id) || P(id).pos === 'HC') continue; const g = lineup([...roster, id]).pts - base; if (g > 0.05 && (!best || g > best.gain)) best = { id, gain: g }; }
    if (!best) break; roster.push(best.id); adds.push(best);
  }
  return { roster, drops, adds, ...lineup(roster) };
}
function byPos(st) { const s = { QB: 0, RB: 0, WR: 0, TE: 0 }; for (const [slot, id, pts] of st) { const pos = P(id).pos; if (s[pos] != null) s[pos] += pts; } return s; }
function posStrength(ids, tol = 'even') { // starters' points per game by position group, both horizons blended
  const ros = byPos(lineup(ids).st), wks = nowWeeks(), short = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const w of wks) { const s = byPos(lineup(ids, p => playsPg(p, w, tol)).st); for (const k in short) short[k] += s[k] / wks.length; }
  const out = {}; for (const k in ros) out[k] = NEED_W.ros * ros[k] + NEED_W.short * short[k];
  return out;
}
const _teamStrength = {};
const teamStrength = mgr => _teamStrength[mgr] || (_teamStrength[mgr] = posStrength(team(mgr).players, tolOf(mgr)));
function leagueRanks(mgr, ids) { // where this roster's position groups rank vs the other 11 (as they are now)
  const mine = posStrength(ids, tolOf(mgr)); const others = D.teams.filter(t => t.manager !== mgr).map(t => teamStrength(t.manager));
  const r = {}; for (const pos in mine) r[pos] = 1 + others.filter(o => o[pos] > mine[pos] + 1e-9).length;
  return r;
}

/* ---------- evaluation ---------- */
function evaluateTrade(aMgr, bMgr, aGet, bGet) { // A receives aGet from B; B receives bGet from A
  const A = team(aMgr), B = team(bMgr);
  const vA = adj(aGet.map(id => tv(id))), vB = adj(bGet.map(id => tv(id)));
  const rawA = aGet.reduce((s, id) => s + mv(id), 0), rawB = bGet.reduce((s, id) => s + mv(id), 0);
  const waived = [...aGet, ...bGet].filter(id => waiverLevel(id));
  const top = Math.max(vA, vB) || 1, diff = (vA - vB) / top; // >0: A receives more market value
  const need = Math.pow(Math.abs(Math.pow(vA, EXP) - Math.pow(vB, EXP)), 1 / EXP);
  const sources = Object.keys(D.sources).map(k => {
    const s = D.sources[k], ga = adj(aGet.map(id => tv(id, s))), gb = adj(bGet.map(id => tv(id, s)));
    const covered = [...aGet, ...bGet].filter(id => s[id]).length;
    const d = (ga - gb) / (Math.max(ga, gb) || 1);
    return { k, ga, gb, d, covered, total: aGet.length + bGet.length };
  });
  const impact = (T, gets, gives, mDiff) => {
    const before = settle(T.players), after = settle(T.players.filter(id => !gives.includes(id)).concat(gets));
    const tol = tolOf(T.manager);
    const dRos = after.pts - before.pts, dShort = shortPts(after.roster, tol) - shortPts(before.roster, tol);
    const dppg = NEED_W.ros * dRos + NEED_W.short * dShort;
    const sd = D.score_sd || 25, g = D.games_remaining;
    const xw = g * (Phi(dppg / (sd * Math.SQRT2)) - 0.5);
    const rb = leagueRanks(T.manager, T.players), ra = leagueRanks(T.manager, T.players.filter(id => !gives.includes(id)).concat(gets));
    const score = 0.5 * clamp(mDiff, -1, 1) + 0.5 * clamp(dppg / 4, -1, 1);
    return { T, before, after, dppg, dRos, dShort, ros: dppg * g, xw, rb, ra, score, grade: grade(score) };
  };
  return { A, B, vA, vB, rawA, rawB, diff, need, sources, waived, ia: impact(A, aGet, bGet, diff), ib: impact(B, bGet, aGet, -diff) };
}
function grade(s) {
  const t = [[0.4, 'A+'], [0.25, 'A'], [0.12, 'A−'], [0.05, 'B+'], [-0.05, 'B'], [-0.12, 'C'], [-0.25, 'D']];
  for (const [min, g] of t) if (s >= min) return g; return 'F';
}
const gradeColor = g => g[0] === 'A' ? '#4FA876' : g[0] === 'B' ? '#4F86D6' : g[0] === 'C' ? '#D9B23C' : '#E0524A';
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
