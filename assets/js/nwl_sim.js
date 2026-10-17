// Playoff Odds simulator, shared by the 2026 Hub's Playoff Odds tab and its matchup previews.
// Needs trade_engine.js loaded with D = trade_values.json (for each roster's projected lineup strength).
//
// Model: each team's weekly score ~ Normal(mu, sd). mu blends the team's actual 2026 PPG with its
// projected lineup (settle().pts, the Trade Calculator's blended rest-of-season pts/g), rescaled to the
// league's actual scoring level. The projection weighs more early in the season, less late. sd is the
// league's weekly score spread. Seeding (confirmed by Hunter): the 3 division winners take seeds 1-3 by
// record, then 3 wild cards by record; total points break ties. 6-team bracket over weeks 15-17:
// 3v6 and 4v5, then #1 vs the lowest remaining seed and #2 vs the other, then the final.
const NWL_SIM = (() => {
  let S = null; // { teams, div, played, remaining, mu, sd, regWeeks, week }

  function rng(seed) { // mulberry32: same numbers on every load, so odds don't jitter on refresh
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function normal(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  const key = g => g.week + '|' + g.home;
  const decided = g => g.winner === 'HOME' || g.winner === 'AWAY' || g.winner === 'TIE';

  // schedule: schedule.json; asOfWeek: treat games from this week on as unplayed (for "before week N" odds)
  function setup(schedule, asOfWeek) {
    const teams = Object.keys(schedule.divisions);
    const played = schedule.games.filter(g => decided(g) && (!asOfWeek || g.week < asOfWeek));
    const remaining = schedule.games.filter(g => !played.includes(g));
    const pts = {}, gp = {};
    teams.forEach(t => { pts[t] = 0; gp[t] = 0; });
    played.forEach(g => { pts[g.home] += g.home_score; pts[g.away] += g.away_score; gp[g.home]++; gp[g.away]++; });
    const ppg = t => gp[t] ? pts[t] / gp[t] : null;
    const proj = {}; teams.forEach(t => { proj[t] = team(t) ? settle(team(t).players).pts : 0; });
    const avg = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
    const actualMean = avg(teams.map(ppg).filter(x => x != null)) || avg(teams.map(t => proj[t]));
    const projMean = avg(teams.map(t => proj[t])) || 1;
    const gamesLeft = Math.max(0, schedule.regular_season_weeks - Math.max(0, ...played.map(g => g.week), 0));
    const wProj = clamp(gamesLeft / schedule.regular_season_weeks, 0.35, 0.75);
    const mu = {};
    teams.forEach(t => { const p = proj[t] * actualMean / projMean; mu[t] = ppg(t) == null ? p : wProj * p + (1 - wProj) * ppg(t); });
    S = { teams, div: schedule.divisions, played, remaining, mu, wProj, sd: (typeof D !== 'undefined' && D && D.score_sd) || 25, regWeeks: schedule.regular_season_weeks, playoffWeeks: schedule.playoff_weeks, byes: schedule.bye_seeds, poTeams: schedule.playoff_teams };
    return S;
  }

  function seedTeams(w, pf) {
    const better = (a, b) => (w[b] - w[a]) || (pf[b] - pf[a]);
    const divs = {}; S.teams.forEach(t => (divs[S.div[t]] = divs[S.div[t]] || []).push(t));
    const winners = Object.values(divs).map(list => [...list].sort(better)[0]).sort(better);
    const wild = S.teams.filter(t => !winners.includes(t)).sort(better).slice(0, S.poTeams - winners.length);
    return [...winners, ...wild]; // index 0 = #1 seed
  }

  // locks: { "week|home": "HOME" | "AWAY" } forced results for remaining games
  function run(n = 10000, locks = {}, seed = 2026) {
    const r = rng(seed), T = S.teams, out = {};
    T.forEach(t => { out[t] = { wins: 0, pf: 0, playoff: 0, bye: 0, divWin: 0, seed1: 0, final: 0, title: 0, seeds: new Array(T.length + 1).fill(0) }; });
    const baseW = {}, basePF = {};
    T.forEach(t => { baseW[t] = 0; basePF[t] = 0; });
    S.played.forEach(g => {
      basePF[g.home] += g.home_score; basePF[g.away] += g.away_score;
      if (g.winner === 'HOME') baseW[g.home]++; else if (g.winner === 'AWAY') baseW[g.away]++; else { baseW[g.home] += 0.5; baseW[g.away] += 0.5; }
    });
    const score = t => S.mu[t] + S.sd * normal(r);
    const play = (a, b) => (score(a) >= score(b) ? a : b);
    for (let i = 0; i < n; i++) {
      const w = { ...baseW }, pf = { ...basePF };
      for (const g of S.remaining) {
        let hs = score(g.home), as = score(g.away);
        const lock = locks[key(g)];
        if (lock === 'HOME' && hs < as) [hs, as] = [as, hs];
        if (lock === 'AWAY' && as < hs) [hs, as] = [as, hs];
        pf[g.home] += hs; pf[g.away] += as;
        if (hs >= as) w[g.home]++; else w[g.away]++;
      }
      const seeds = seedTeams(w, pf);
      T.forEach(t => { out[t].wins += w[t]; out[t].pf += pf[t]; });
      seeds.forEach((t, k) => { out[t].playoff++; out[t].seeds[k + 1]++; if (k < S.byes) out[t].bye++; if (k === 0) out[t].seed1++; if (k < 3) out[t].divWin++; });
      // non-playoff seeds by record, for the "most likely finish" column
      const rest = T.filter(t => !seeds.includes(t)).sort((a, b) => (w[b] - w[a]) || (pf[b] - pf[a]));
      rest.forEach((t, k) => out[t].seeds[seeds.length + k + 1]++);
      // bracket (6 teams, top 2 byes)
      const [s1, s2, s3, s4, s5, s6] = seeds;
      const wA = play(s3, s6), wB = play(s4, s5);
      const low = seeds.indexOf(wA) > seeds.indexOf(wB) ? wA : wB, high = low === wA ? wB : wA;
      const f1 = play(s1, low), f2 = play(s2, high);
      out[f1].final++; out[f2].final++;
      out[play(f1, f2)].title++;
    }
    T.forEach(t => { const o = out[t]; for (const k of ['wins', 'pf', 'playoff', 'bye', 'divWin', 'seed1', 'final', 'title']) o[k] /= n; o.seeds = o.seeds.map(x => x / n); });
    return out;
  }

  return { setup, run, key, state: () => S };
})();
