// League record helpers shared by the homepage and the 2026 Hub: the Record Watch banner (and, later,
// "This week in NWL history"). Record definitions match the Hall of Fame (pages/hall-of-fame.html):
// streaks run across every game and carry over between seasons; season records are regular season
// only; the lowest score counts regular-season games only (late consolation weeks have unset lineups).
// Needs shared.js (loadData, loadDataSafe, managerTag, managerColor).
const NWL_REC = (() => {
  const SEASON = 2026;
  const f1 = x => (+x).toFixed(1);
  const ordn = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const escH = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function load() {
    const [weekly, matchups, schedule, live] = await Promise.all([
      loadData('weekly_scores'), loadData('matchup_results'),
      loadDataSafe('season_2026/schedule', null), loadDataSafe('season_2026/matchups', [])]);
    return { weekly, matchups, schedule, live };
  }

  // Every completed game, history + 2026, oldest first: { season, week, winner, loser, ws, ls, tie }
  function allGames(d) {
    const g = d.matchups.map(m => ({ season: +m.season, week: +m.week, winner: m.winner, loser: m.loser, ws: +m.winning_score, ls: +m.losing_score, tie: +m.winning_score === +m.losing_score }));
    (d.schedule ? d.schedule.games : []).filter(x => ['HOME', 'AWAY', 'TIE'].includes(x.winner)).forEach(x => {
      const hw = x.winner !== 'AWAY';
      g.push({ season: SEASON, week: x.week, winner: hw ? x.home : x.away, loser: hw ? x.away : x.home, ws: hw ? x.home_score : x.away_score, ls: hw ? x.away_score : x.home_score, tie: x.winner === 'TIE' });
    });
    return g.sort((a, b) => a.season - b.season || a.week - b.week);
  }

  function streakRuns(games) { // same rules as the Hall of Fame: ties skipped, runs span seasons
    const by = {};
    games.forEach(m => { if (m.tie) return; (by[m.winner] ||= []).push({ m, r: 'W' }); (by[m.loser] ||= []).push({ m, r: 'L' }); });
    const runs = { W: [], L: [] }, current = {};
    for (const [name, gs] of Object.entries(by)) {
      let cur = null;
      for (const g of gs) { if (cur && cur.r === g.r) { cur.len++; cur.end = g.m; } else { if (cur) runs[cur.r].push(cur); cur = { name, r: g.r, len: 1, start: g.m, end: g.m }; } }
      if (cur) { runs[cur.r].push(cur); current[name] = cur; }
    }
    runs.W.sort((a, b) => b.len - a.len); runs.L.sort((a, b) => b.len - a.len);
    return { runs, current };
  }

  // Record Watch: the 1-3 most notable records in reach right now. Each item: { score, html }.
  function recordWatch(d) {
    const items = [], games = allGames(d);
    if (!d.schedule) return items;
    const reg = d.schedule.regular_season_weeks;
    const played26 = d.schedule.games.filter(x => ['HOME', 'AWAY', 'TIE'].includes(x.winner));
    const teams = Object.keys(d.schedule.divisions);
    const curWeek = d.live.length ? d.live[d.live.length - 1] : null;
    const upcoming = curWeek ? curWeek.games.filter(g => !['HOME', 'AWAY', 'TIE'].includes(g.winner)) : [];
    const who = m => typeof managerTag === 'function' && typeof managers !== 'undefined' && managers.length ? managerTag(managers, m) : `<b>${escH(m)}</b>`;

    // --- season pace (regular season) ---
    const regular = d.weekly.filter(r => r.game_type === 'regular');
    const seasons = {};
    regular.forEach(r => { const k = r.season + '|' + r.manager; (seasons[k] ||= { season: +r.season, manager: r.manager, pts: 0, g: 0 }); seasons[k].pts += +r.score; seasons[k].g++; });
    const hist = Object.values(seasons).filter(s => s.g >= 10).map(s => ({ ...s, ppg: s.pts / s.g }));
    const byPpg = [...hist].sort((a, b) => b.ppg - a.ppg), byPpgLow = [...hist].sort((a, b) => a.ppg - b.ppg);
    const regWins = {}; // regular season = before that season's first playoff week
    const poStart = {}; d.weekly.forEach(r => { if (r.game_type === 'playoff') poStart[r.season] = Math.min(poStart[r.season] || 99, +r.week); });
    games.filter(m => m.season < SEASON && m.week < (poStart[m.season] || 99) && !m.tie).forEach(m => { const k = m.season + '|' + m.winner; regWins[k] = (regWins[k] || 0) + 1; });
    const winsRows = Object.entries(regWins).map(([k, w]) => ({ season: +k.split('|')[0], manager: k.split('|')[1], w })).sort((a, b) => b.w - a.w);
    const lossRows = {}; games.filter(m => m.season < SEASON && m.week < (poStart[m.season] || 99) && !m.tie).forEach(m => { const k = m.season + '|' + m.loser; lossRows[k] = (lossRows[k] || 0) + 1; });
    const mostLosses = Object.entries(lossRows).map(([k, l]) => ({ season: +k.split('|')[0], manager: k.split('|')[1], l })).sort((a, b) => b.l - a.l);
    const holders = (rows, k) => { const top = rows.filter(r => r[k] === rows[0][k]); return `${escH(top[0].manager)} ${top[0].season}${top.length > 1 ? ` and ${top.length - 1} other${top.length > 2 ? 's' : ''}` : ''}`; };
    // All-play win rate so far: how often each team's weekly score beat every other team's that week.
    // Win/loss pace projects the rest of the season at that rate instead of stretching the current
    // record (a 0-5 team that scores like a 2-win team isn't really on pace for 14 losses).
    const weekScores = {}, ap = {};
    played26.forEach(x => { (weekScores[x.week] ||= []).push([x.home, x.home_score], [x.away, x.away_score]); });
    Object.values(weekScores).forEach(rows => rows.forEach(([t, sc]) => { const a = (ap[t] ||= { w: 0, n: 0 }); rows.forEach(([o, os]) => { if (o !== t) { a.n++; a.w += sc > os ? 1 : sc === os ? 0.5 : 0; } }); }));
    const names = list => list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    teams.forEach(t => {
      const mine = played26.filter(x => x.home === t || x.away === t); if (mine.length < 4) return;
      const pts = mine.reduce((s, x) => s + (x.home === t ? x.home_score : x.away_score), 0), ppg = pts / mine.length;
      const w = mine.filter(x => (x.winner === 'HOME' && x.home === t) || (x.winner === 'AWAY' && x.away === t)).length, l = mine.length - w;
      const rank = 1 + byPpg.filter(s => s.ppg > ppg).length;
      if (rank <= 3) items.push({ m: t, score: 60 - rank, html: `${who(t)} is scoring <b>${f1(ppg)}</b> a game, on pace for the <b>${rank === 1 ? 'best' : ordn(rank) + '-best'}</b> regular season ever (record: ${f1(byPpg[0].ppg)}, ${escH(byPpg[0].manager)} ${byPpg[0].season}).` });
      const rankLow = 1 + byPpgLow.filter(s => s.ppg < ppg).length;
      if (rankLow <= 3) items.push({ m: t, score: 55 - rankLow, html: `${who(t)} is averaging just <b>${f1(ppg)}</b>, on pace for the <b>${rankLow === 1 ? 'lowest' : ordn(rankLow) + '-lowest'}</b> scoring season ever (${f1(byPpgLow[0].ppg)}, ${escH(byPpgLow[0].manager)} ${byPpgLow[0].season}).` });
      const left = reg - mine.length, apPct = ap[t] && ap[t].n ? ap[t].w / ap[t].n : w / mine.length;
      const projW = Math.round(w + left * apPct), projL = Math.round(l + left * (1 - apPct));
      // grp + tpl let teams in the same spot share one sentence ("Ainsworth and Glaser are both 4-1...")
      if (winsRows[0] && projW >= winsRows[0].w - 1) items.push({ m: t, score: 50 + w, grp: `w|${w}-${l}|${projW}`,
        tpl: (ws, many) => `${ws} ${many ? 'are both' : 'is'} ${w}-${l} and ${many ? 'project' : 'projects'} to <b>${projW} wins</b> on ${many ? 'their' : 'his'} scoring so far (regular-season record: ${winsRows[0].w}, ${holders(winsRows, 'w')}).` });
      if (mostLosses[0] && projL >= mostLosses[0].l - 1) items.push({ m: t, score: 50 + l, grp: `l|${w}-${l}|${projL}`,
        tpl: (ws, many) => `${ws} ${many ? 'are both' : 'is'} ${w}-${l} and ${many ? 'project' : 'projects'} to <b>${projL} losses</b> on ${many ? 'their' : 'his'} scoring so far (most ever in a regular season: ${mostLosses[0].l}, ${holders(mostLosses, 'l')}).` });
    });

    // --- streaks (all games, carry over between seasons) ---
    const { runs, current } = streakRuns(games);
    for (const r of ['W', 'L']) {
      const rec = runs[r].find(x => !(x.end.season === SEASON && current[x.name] === x)) || runs[r][0]; // the record, not counting a run still going
      teams.forEach(t => {
        const c = current[t]; if (!c || c.r !== r || c.end.season !== SEASON || c.len < 3) return;
        if (c.len >= rec.len - 2) items.push({ m: t, score: 70 + c.len, html: `${who(t)} has ${r === 'W' ? 'won' : 'lost'} <b>${c.len} straight</b>${c.start.season < SEASON ? ' (dating back to ' + c.start.season + ')' : ''}. The record is ${rec.len}, ${escH(rec.name)} ${rec.start.season}${rec.end.season !== rec.start.season ? '–' + rec.end.season : ''}.${c.len >= rec.len ? ' <b>New record!</b>' : c.len === rec.len - 1 ? ' One more ties it.' : ''}` });
      });
    }

    // --- single game: this week's projections vs the highest / lowest score ever ---
    const hi = [...d.weekly].sort((a, b) => b.score - a.score)[0], lo = [...regular].sort((a, b) => a.score - b.score)[0];
    upcoming.forEach(g => [[g.home_manager, g.home_projected], [g.away_manager, g.away_projected]].forEach(([m, p]) => {
      if (!m || p == null) return;
      if (p >= +hi.score - 15) items.push({ m, score: 80, html: `${who(m)} projects <b>${f1(p)}</b> this week; the highest score ever is ${f1(hi.score)} (${escH(hi.manager)}, week ${hi.week} ${hi.season}).` });
      if (p <= +lo.score + 15) items.push({ m, score: 75, html: `${who(m)} projects only <b>${f1(p)}</b>; the lowest regular-season score ever is ${f1(lo.score)} (${escH(lo.manager)}, week ${lo.week} ${lo.season}).` });
    }));

    // --- career milestones reachable this week (wins every 25, points every 1,000) ---
    const wins = {}, points = {};
    games.forEach(m => { if (!m.tie) wins[m.winner] = (wins[m.winner] || 0) + 1; });
    d.weekly.forEach(r => { points[r.manager] = (points[r.manager] || 0) + +r.score; });
    played26.forEach(x => { points[x.home] = (points[x.home] || 0) + x.home_score; points[x.away] = (points[x.away] || 0) + x.away_score; });
    upcoming.forEach(g => [[g.home_manager, g.home_projected], [g.away_manager, g.away_projected]].forEach(([m, p]) => {
      if (!m) return;
      const w = wins[m] || 0; if ((w + 1) % 25 === 0) items.push({ m, score: 40 + (w + 1) / 25, html: `${who(m)} is <b>one win from ${w + 1} career wins</b>.` });
      const pt = points[m] || 0, next = Math.ceil((pt + 0.01) / 1000) * 1000;
      if (p != null && next - pt <= p * 0.9) items.push({ m, score: 30 + next / 1000, html: `${who(m)} needs ${f1(next - pt)} points (projects ${f1(p)}) to pass <b>${next.toLocaleString()} career points</b>.` });
    }));

    // most notable first; one item per manager, at most 3
    const seen = new Set(), out = [];
    items.sort((a, b) => b.score - a.score);
    // merge items that say the same thing about several teams into one sentence
    const merged = [], byGrp = {};
    items.forEach(it => {
      if (it.grp && byGrp[it.grp]) { byGrp[it.grp].ms.push(it.m); return; }
      const x = { ...it, ms: [it.m] }; if (it.grp) byGrp[it.grp] = x; merged.push(x);
    });
    merged.forEach(it => { if (it.tpl) it.html = it.tpl(names(it.ms.map(who)), it.ms.length > 1); });
    merged.forEach(it => { if (out.length < 3 && !it.ms.some(m => seen.has(m))) { it.ms.forEach(m => seen.add(m)); out.push(it); } });
    return out;
  }

  function renderRecordWatch(el, items) {
    if (!el) return;
    if (!items.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="rw-label"><span class="nav-live-dot"></span>Record watch</div><ul>${items.map(i => `<li>${i.html}</li>`).join('')}</ul>`;
  }

  // "This week in NWL history": up to 2 team moments and 2 player games from the same week number in
  // past seasons, plus 1 trade or big FAAB buy from within 3 days of today's date in a past season.
  // Picks are deterministic (the same all week, different each week).
  // h: { weekly, matchups, seasons (team_seasons_regular), highlights, trades, tx, week, today: Date, prefix }
  function historyThisWeek(h) {
    const wk = h.week, out = { team: [], player: [], move: null };
    const link = (href, txt) => `<a href="${h.prefix}${href}">${txt}</a>`;
    const ppg = {}; h.seasons.forEach(s => { ppg[s.season + '|' + s.manager] = +s.ppg; });
    const games = h.matchups.filter(m => +m.week === wk && +m.season < SEASON).map(m => ({ ...m, ws: +m.winning_score, ls: +m.losing_score, margin: +m.winning_score - +m.losing_score }));
    const blow = [...games].sort((a, b) => b.margin - a.margin)[0];
    const high = h.weekly.filter(r => +r.week === wk && +r.season < SEASON).sort((a, b) => b.score - a.score)[0];
    const upsets = games.filter(m => m.margin > 0).map(m => ({ ...m, gap: (ppg[m.season + '|' + m.loser] || 0) - (ppg[m.season + '|' + m.winner] || 0) })).filter(m => m.gap > 8).sort((a, b) => b.gap - a.gap);
    const cands = [];
    if (blow) cands.push({ k: 'blow', html: `<b>${blow.season}:</b> ${escH(blow.winner)} crushed ${escH(blow.loser)} ${f1(blow.ws)}–${f1(blow.ls)}, a ${f1(blow.margin)}-point margin, the biggest of any week ${wk}.` });
    if (high && (!blow || !(high.season === blow.season && high.manager === blow.winner))) cands.push({ k: 'high', html: `<b>${high.season}:</b> ${escH(high.manager)} put up ${f1(high.score)}, the most ever in a week ${wk}.` });
    upsets.slice(0, 3).forEach(u => cands.push({ k: 'upset', html: `<b>${u.season}:</b> ${escH(u.winner)} (${f1(ppg[u.season + '|' + u.winner])} PPG that year) upset ${escH(u.loser)} (${f1(ppg[u.season + '|' + u.loser])} PPG), ${f1(u.ws)}–${f1(u.ls)}.` }));
    // the best team moment is always shown; the second rotates through the rest by week
    if (cands.length) out.team.push(cands[0]);
    if (cands.length > 1) out.team.push(cands[1 + (wk % (cands.length - 1))]);

    // player games: points, with bonuses for all-time top-10 games and for 2022+ benched or clutch games
    const pg = (h.highlights || []).filter(r => r.week === wk && r.season < SEASON).map(r => {
      const n = r.nwl || {}; let s = r.pts + (r.pos_alltime_top10 ? 8 : 0) + (n.manager && !n.started ? 5 : 0) + (n.manager ? 2 : 0);
      return { r, s };
    }).sort((a, b) => b.s - a.s);
    const used = new Set();
    for (const { r } of pg) {
      if (out.player.length >= 2 || used.has(r.season)) continue; used.add(r.season); // two different seasons
      const n = r.nwl || {};
      // name only the NWL team he scored for (known from 2022 on); never who drafted him (Hunter, Oct 20)
      const owner = n.manager ? (n.started ? ` for <b>${escH(n.manager)}</b>` : `, <b>on ${escH(n.manager)}'s bench</b>`) : '';
      out.player.push({ html: `<b>${r.season}:</b> ${escH(r.player)} (${escH(r.pos)}, ${escH(r.team)}) went off for ${f1(n.manager ? n.points : r.pts)}${n.manager ? '' : ' half-PPR'} vs ${escH(r.opp)}: ${escH(r.line)}${owner}.${r.pos_alltime_top10 ? ` One of the 10 best ${escH(r.pos)} games since 2013.` : ''}` });
    }

    // a move from around today's date in a past season: a trade, or the biggest winning FAAB bid
    const md = d => { const x = new Date(d + 'T12:00:00'); return isNaN(x) ? null : x; };
    const near = d => { const x = md(d); if (!x) return null; const y = new Date(h.today); y.setFullYear(x.getFullYear()); const diff = Math.abs(x - y) / 864e5; return diff <= 3 && x.getFullYear() < SEASON ? diff : null; };
    const trades = (h.trades || []).filter(t => /^\d{4}-\d\d-\d\d$/.test(t.date) && near(t.date) != null).sort((a, b) => near(a.date) - near(b.date));
    const bids = (h.tx || []).filter(t => t.bid_outcome !== 'lost' && +t.bid_amount >= 20 && /^\d{4}-\d\d-\d\d$/.test(t.date) && near(t.date) != null).sort((a, b) => b.bid_amount - a.bid_amount);
    const strip = s => s.replace(/(QB|RB|WR|TE|HC) - /g, '');
    if (trades.length && (!bids.length || wk % 2)) { const t = trades[0]; out.move = { html: `<b>${t.date.slice(0, 4)}:</b> ${escH(t.team1)} traded for ${escH(strip(t.team1_received))}, sending ${escH(strip(t.team2_received))} to ${escH(t.team2)} (${new Date(t.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}).` }; }
    else if (bids.length) { const b = bids[0]; out.move = { html: `<b>${b.season}:</b> ${escH(b.manager)} spent $${b.bid_amount} of FAAB on ${escH(b.player)} (${new Date(b.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}).` }; }
    out.links = { team: link('pages/hall-of-fame.html', 'Hall of Fame'), move: link('pages/transactions.html', 'Transactions') };
    return out;
  }
  function renderHistory(el, H, week, compact) {
    if (!el) return;
    const items = [...H.team, ...H.player, ...(H.move ? [H.move] : [])];
    if (!items.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="twh-head"><span class="twh-eyebrow">This week in NWL history</span><span class="twh-wk">Week ${week}</span></div>
      <ul class="twh-list">${H.team.map(i => `<li class="team">${i.html}</li>`).join('')}${H.player.map(i => `<li class="player">${i.html}</li>`).join('')}${H.move ? `<li class="move">${H.move.html}</li>` : ''}</ul>
      ${compact ? '' : `<div class="twh-links">More in the ${H.links.team} and ${H.links.move}</div>`}`;
  }

  return { load, allGames, streakRuns, recordWatch, renderRecordWatch, historyThisWeek, renderHistory, ordn, f1, escH, SEASON };
})();
