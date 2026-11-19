// Schedule swap: every manager's record if he'd had each other manager's schedule. Shared by the 2026 Schedule Swap
// page (a Week 11 commentary sub-tab) and the Hall of Fame's Seasons tab (every past season's regular season).
// Needs shared.js (managerTag, managerColor). Regular-season games only; pass them in.
//
// games: [{ week, a, b, sa, sb }] - one entry per game, a/b the two managers and sa/sb their scores.
// In a week the schedule's owner played that team himself, the team instead plays the league median: a win if he
// beat that week's median score, a loss if not (per Hunter, Nov 19 2026). So every swapped record covers the same
// games as the real one. Ties (2013-14) count as half a win.
(function () {
  const CSS = `
.ss-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.ss-grid{border-collapse:separate;border-spacing:0;font-family:var(--font-mono);font-size:.78rem;font-variant-numeric:tabular-nums;width:100%}
.ss-grid th,.ss-grid td{padding:7px 6px;text-align:center;white-space:nowrap;border-bottom:1px solid var(--line)}
.ss-grid thead th{font-weight:600;color:var(--text-muted);font-size:.68rem;letter-spacing:.04em;vertical-align:bottom;background:var(--surface)}
.ss-grid thead th .dot{display:block;width:8px;height:8px;border-radius:50%;margin:0 auto 4px}
.ss-grid .rowh{position:sticky;left:0;z-index:1;background:var(--surface);text-align:left;font-family:var(--font-body);font-size:.82rem;font-weight:600;border-right:1px solid var(--line)}
.ss-grid .corner{position:sticky;left:0;z-index:2;text-align:left;font-family:var(--font-mono);font-size:.62rem;line-height:1.3;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.06em;border-right:1px solid var(--line)}
.ss-grid td.c{color:var(--text)}
.ss-grid td.self{outline:2px solid var(--live);outline-offset:-3px;font-weight:600;color:var(--live-bright)}
.ss-grid td.sum{border-left:1px solid var(--line);color:var(--text);font-weight:600}
.ss-grid tr.med td,.ss-grid tr.med th{border-top:1px solid var(--line-strong)}
.ss-grid tr.med .rowh{color:var(--text-muted);font-style:italic;font-weight:500}
.ss-grid tr.foot td,.ss-grid tr.foot th{border-bottom:none;border-top:1px solid var(--line-strong);color:var(--text-muted)}
.ss-grid .pos{color:#4FA876}.ss-grid .neg{color:#E0524A}
.ss-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:.74rem;color:var(--text-muted);margin-top:8px}
.ss-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-2px}
.ss-bars{display:flex;flex-direction:column;gap:6px;max-width:640px}
.ss-bar{display:grid;grid-template-columns:110px 1fr 1fr 56px;align-items:center;gap:8px;font-size:.82rem}
.ss-bar .neg-side{display:flex;justify-content:flex-end}.ss-bar .pos-side{display:flex}
.ss-bar .fill{height:14px;border-radius:3px}
.ss-bar .v{font-family:var(--font-mono);font-size:.78rem;text-align:right}
.ss-note{font-size:.76rem;color:var(--text-muted);max-width:72ch;margin:8px 0 0;line-height:1.45}
.ss-find{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:0 0 12px}
.ss-find>div{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:.82rem;line-height:1.4}
.ss-find b{display:block;font-family:var(--font-mono);font-size:.64rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:3px}
@media (max-width:640px){.ss-grid th,.ss-grid td{padding:6px 4px}.ss-bar{grid-template-columns:86px 1fr 1fr 48px}}`;
  function injectCSS() {
    if (document.getElementById('ss-css')) return;
    const s = document.createElement('style'); s.id = 'ss-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function compute(games) {
    const score = {}, opp = {}, weeks = new Set();
    games.forEach(g => {
      weeks.add(g.week);
      score[g.week + '|' + g.a] = g.sa; score[g.week + '|' + g.b] = g.sb;
      opp[g.week + '|' + g.a] = g.b; opp[g.week + '|' + g.b] = g.a;
    });
    const wk = [...weeks].sort((x, y) => x - y);
    const teams = [...new Set(games.flatMap(g => [g.a, g.b]))];
    // each week's median score: the stand-in opponent for "would have played himself", and the League median row
    const med = {};
    wk.forEach(w => {
      const v = teams.map(t => score[w + '|' + t]).filter(x => x != null).sort((x, y) => x - y);
      med[w] = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    });
    const rec = (a, b) => {
      const r = { w: 0, l: 0, t: 0 };
      wk.forEach(w => {
        const o = opp[w + '|' + b];
        if (!o || score[w + '|' + a] == null) return;
        const d = score[w + '|' + a] - (o === a ? med[w] : score[w + '|' + o]);
        d > 0 ? r.w++ : d < 0 ? r.l++ : r.t++;
      });
      r.n = r.w + r.l + r.t; r.pct = r.n ? (r.w + r.t / 2) / r.n : 0;
      return r;
    };
    const M = {}; teams.forEach(a => { M[a] = {}; teams.forEach(b => { M[a][b] = rec(a, b); }); });
    // League median row: a team that scores exactly that week's median score, played on each schedule
    const median = {};
    teams.forEach(b => {
      const r = { w: 0, l: 0, t: 0 };
      wk.forEach(w => {
        const o = opp[w + '|' + b];
        if (!o) return;
        const d = med[w] - score[w + '|' + o];
        d > 0 ? r.w++ : d < 0 ? r.l++ : r.t++;
      });
      r.n = r.w + r.l + r.t; r.pct = r.n ? (r.w + r.t / 2) / r.n : 0;
      median[b] = r;
    });
    const actual = a => M[a][a];
    const avgPct = a => teams.filter(b => b !== a).reduce((s, b) => s + M[a][b].pct, 0) / (teams.length - 1);
    const schedPct = b => teams.filter(a => a !== b).reduce((s, a) => s + M[a][b].pct, 0) / (teams.length - 1);
    const luck = a => actual(a).w + actual(a).t / 2 - avgPct(a) * actual(a).n;
    const order = [...teams].sort((a, b) => actual(b).pct - actual(a).pct || avgPct(b) - avgPct(a));
    const EPS = 1e-9;
    const bestOwn = teams.filter(a => teams.every(b => b === a || M[a][b].pct <= actual(a).pct + EPS));
    const worstOwn = teams.filter(a => teams.every(b => b === a || M[a][b].pct >= actual(a).pct - EPS));
    return { M, teams, order, weeks: wk, actual, avgPct, schedPct, luck, bestOwn, worstOwn, median };
  }

  const fmt = r => `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;
  const p3 = x => x.toFixed(3).replace(/^0/, '');
  const short = n => n.length > 6 ? n.slice(0, 5) + '.' : n;
  const names = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1);

  // { findings: bool, luckBars: bool, luckTitle } -> html
  function html(managers, R, opts = {}) {
    injectCSS();
    const { M, order, actual, avgPct, schedPct, luck } = R;
    const shade = (a, r) => {
      const diff = r.pct - actual(a).pct;
      if (Math.abs(diff) < 0.001) return '';
      const alpha = Math.min(0.6, 0.1 + Math.abs(diff) * 1.1).toFixed(2);
      return `background:${diff > 0 ? `rgba(79,168,118,${alpha})` : `rgba(224,82,74,${alpha})`}`;
    };
    const head = `<tr><th class="corner">Team ↓<br>Schedule →</th>${order.map(b =>
      `<th title="${b}'s schedule"><span class="dot" style="background:${managerColor(managers, b)}"></span>${short(b)}</th>`).join('')}<th title="Average win rate on the other schedules">Avg W%</th><th title="Real wins minus wins expected from the average">Luck</th></tr>`;
    const body = order.map(a => `<tr><th class="rowh">${managerTag(managers, a)}</th>${order.map(b => {
      const r = M[a][b];
      return a === b ? `<td class="c self" title="${a}'s real record">${fmt(r)}</td>`
        : `<td class="c" style="${shade(a, r)}" title="${a} with ${b}'s schedule: ${fmt(r)}">${fmt(r)}</td>`;
    }).join('')}<td class="sum">${p3(avgPct(a))}</td><td class="sum ${luck(a) >= 0.5 ? 'pos' : luck(a) <= -0.5 ? 'neg' : ''}">${luck(a) > 0 ? '+' : ''}${luck(a).toFixed(1)}</td></tr>`).join('');
    // League median row: shaded against .500, since a median team should break even on an average schedule
    const medRow = R.median ? `<tr class="med"><th class="rowh" title="A team that scores the league's median score every week">League median</th>${order.map(b => {
      const r = R.median[b], d = r.pct - 0.5;
      const bg = Math.abs(d) < 0.001 ? '' : `background:${d > 0 ? 'rgba(79,168,118,' : 'rgba(224,82,74,'}${Math.min(0.6, 0.1 + Math.abs(d) * 1.1).toFixed(2)})`;
      return `<td class="c" style="${bg}" title="League-median team with ${b}'s schedule: ${fmt(r)}">${fmt(r)}</td>`;
    }).join('')}<td class="sum"></td><td class="sum"></td></tr>` : '';
    const foot = `<tr class="foot"><th class="rowh" style="color:var(--text-muted);font-weight:500">Others' W%</th>${order.map(b =>
      `<td title="How the other teams do with ${b}'s schedule">${p3(schedPct(b))}</td>`).join('')}<td></td><td></td></tr>`;
    const hard = [...order].sort((a, b) => schedPct(a) - schedPct(b));
    const byLuck = [...order].sort((a, b) => luck(b) - luck(a));

    let find = '';
    if (opts.findings) {
      const n = order.length - 1;
      find = `<div class="ss-find">
        <div><b>Got his best possible schedule</b>${R.bestOwn.length ? names(R.bestOwn.map(a => `${a} (${fmt(actual(a))})`)) : 'Nobody'}</div>
        <div><b>Got his worst possible schedule</b>${R.worstOwn.length ? names(R.worstOwn.map(a => `${a} (${fmt(actual(a))})`)) : 'Nobody'}</div>
        <div><b>Luckiest / unluckiest</b>${byLuck[0]} (+${luck(byLuck[0]).toFixed(1)} wins) / ${byLuck.at(-1)} (${luck(byLuck.at(-1)).toFixed(1)})</div>
        <div><b>Hardest / easiest schedule</b>${hard[0]}'s (others went ${p3(schedPct(hard[0]))}) / ${hard.at(-1)}'s (${p3(schedPct(hard.at(-1)))})</div>
      </div>`;
    }
    const maxL = Math.max(...byLuck.map(a => Math.abs(luck(a))), 1);
    const bars = opts.luckBars ? `<h3 class="${opts.luckClass || 'ss-h'}" style="margin-top:22px">${opts.luckTitle || 'Schedule Luck, in Wins'}</h3>
      <div class="ss-bars">${byLuck.map(a => {
        const v = luck(a), w = (Math.abs(v) / maxL * 100).toFixed(1);
        return `<div class="ss-bar"><span>${managerTag(managers, a)}</span>
          <div class="neg-side">${v < 0 ? `<div class="fill" style="width:${w}%;background:#E0524A"></div>` : ''}</div>
          <div class="pos-side">${v > 0 ? `<div class="fill" style="width:${w}%;background:#4FA876"></div>` : ''}</div>
          <span class="v">${v > 0 ? '+' : ''}${v.toFixed(1)}</span></div>`;
      }).join('')}</div>
      <p class="ss-note">Positive means his schedule handed him more wins than it would most teams.</p>` : '';
    return `${find}<div class="ss-scroll"><table class="ss-grid"><thead>${head}</thead><tbody>${body}${medRow}${foot}</tbody></table></div>
      <div class="ss-legend"><span><i style="background:rgba(79,168,118,.45)"></i>Higher win rate than his real record</span><span><i style="background:rgba(224,82,74,.45)"></i>Lower</span><span><i style="outline:2px solid var(--live);outline-offset:-2px"></i>Real record</span></div>
      <p class="ss-note"><b>Avg W%</b> is his win rate across the other ${order.length - 1} schedules. <b>Luck</b> is his real wins minus the wins that rate predicts. <b>League median</b> is a team that scores exactly the league's median score every week, played on that schedule. <b>Others' W%</b> is how everyone else does with that schedule: lower means tougher (hardest: ${hard[0]}, ${p3(schedPct(hard[0]))}; easiest: ${hard.at(-1)}, ${p3(schedPct(hard.at(-1)))}). In a week the schedule's owner played that team himself, the team plays the league median instead: a win if he beat that week's median score.</p>
      ${bars}`;
  }

  window.ScheduleSwap = { compute, html, fmt };
})();
