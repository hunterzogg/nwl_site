// Read-only query engine over the league's JSON data, used by the ZogGPT tools.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const SKIP = new Set(['player_weeks']); // nested file; exposed below as a flattened table instead
const cache = {};

function listDatasets() {
  const out = [];
  const scan = (dir, prefix) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) { if (f === 'season_2026') scan(full, 'season_2026/'); continue; }
      if (!f.endsWith('.json')) continue;
      const name = prefix + f.slice(0, -5);
      if (!SKIP.has(f.slice(0, -5))) out.push(name);
    }
  };
  scan(DATA_DIR, '');
  out.push('player_weeks', 'team_games', 'trade_assets'); // virtual tables built below
  return out.sort();
}

// One row per team per game (both sides of every matchup), 2013 through the games finished so far in 2026.
function buildTeamGames() {
  const rows = [];
  const push = (season, week, manager, opponent, score, opp) => rows.push({
    season: String(season), week: String(week), manager, opponent, score, opp_score: opp,
    result: score > opp ? 'W' : score < opp ? 'L' : 'T', margin: Math.round((score - opp) * 100) / 100,
  });
  for (const m of JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'matchup_results.json'), 'utf8'))) {
    push(m.season, m.week, m.winner, m.loser, +m.winning_score, +m.losing_score);
    push(m.season, m.week, m.loser, m.winner, +m.losing_score, +m.winning_score);
  }
  for (const wk of JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'season_2026', 'matchups.json'), 'utf8'))) {
    for (const g of wk.games) {
      if (g.winner !== 'HOME' && g.winner !== 'AWAY') continue; // not finished yet
      push(2026, wk.week, g.home_manager, g.away_manager, g.home_score, g.away_score);
      push(2026, wk.week, g.away_manager, g.home_manager, g.away_score, g.home_score);
    }
  }
  return rows;
}

// One row per asset moved in a trade (2022+): who sent it, who received it, its position, and when.
function buildTradeAssets() {
  const rows = [];
  for (const tr of JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'trades.json'), 'utf8'))) {
    const month = parseInt(String(tr.date).slice(5, 7), 10);
    for (const [receiver, sender, text] of [[tr.team1, tr.team2, tr.team1_received], [tr.team2, tr.team1, tr.team2_received]]) {
      for (const part of String(text || '').split(';')) {
        const s = part.trim(); if (!s) continue;
        const i = s.indexOf(' - ');
        rows.push({ season: tr.season, date: tr.date, month, sender, receiver, position: i > 0 ? s.slice(0, i).trim() : 'OTHER', asset: i > 0 ? s.slice(i + 3).trim() : s });
      }
    }
  }
  return rows;
}

// player_weeks.json is nested (players by id, seasons -> weeks -> [manager, playerId, slot, points]); flatten to rows.
function flattenPlayerWeeks() {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'player_weeks.json'), 'utf8'));
  const rows = [];
  for (const [season, s] of Object.entries(raw.seasons || {})) {
    for (const [week, list] of Object.entries(s.weeks || {})) {
      for (const [manager, id, slot, points] of list) {
        const [player, position] = raw.players[id] || [id, ''];
        rows.push({ season, week, manager, player, position, slot, points });
      }
    }
  }
  return rows;
}

function load(name) {
  if (!listDatasets().includes(name)) throw new Error(`Unknown dataset "${name}". Call describe_data to list datasets.`);
  if (!cache[name]) cache[name] = name === 'player_weeks' ? flattenPlayerWeeks() : name === 'team_games' ? buildTeamGames() : name === 'trade_assets' ? buildTradeAssets() : JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + '.json'), 'utf8'));
  return cache[name];
}

const num = (v) => (typeof v === 'string' && v.trim() !== '' && !isNaN(v) ? Number(v) : v);

function describe() {
  return listDatasets().map((name) => {
    const d = load(name);
    if (Array.isArray(d)) {
      const keys = d[0] && typeof d[0] === 'object' ? Object.keys(d[0]) : [];
      return { dataset: name, kind: 'table', rows: d.length, fields: keys, sample: d[0] };
    }
    return { dataset: name, kind: 'object', top_level_keys: Object.keys(d).slice(0, 15) };
  });
}

function matches(row, f) {
  const a = num(row[f.field]);
  let b = f.value;
  const lc = (x) => (typeof x === 'string' ? x.toLowerCase() : x);
  if (f.op === 'in') return (Array.isArray(b) ? b : [b]).map((x) => lc(num(x))).includes(lc(a));
  b = num(b);
  switch (f.op || 'eq') {
    case 'eq': return lc(a) === lc(b);
    case 'neq': return lc(a) !== lc(b);
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'contains': return String(a ?? '').toLowerCase().includes(String(b).toLowerCase());
    default: throw new Error(`Unknown op "${f.op}"`);
  }
}

function query({ dataset, filters = [], select, group_by, metrics, order_by, limit = 25 }) {
  const d = load(dataset);
  if (!Array.isArray(d)) throw new Error(`"${dataset}" is not a table; use get_json instead.`);
  limit = Math.min(Math.max(1, limit | 0 || 25), 100);
  let rows = d.filter((r) => filters.every((f) => matches(r, f)));
  const total_matching = rows.length;

  if (group_by && group_by.length) {
    const groups = new Map();
    for (const r of rows) {
      const key = group_by.map((g) => r[g]).join('\u0001');
      if (!groups.has(key)) groups.set(key, { keys: Object.fromEntries(group_by.map((g) => [g, r[g]])), rows: [] });
      groups.get(key).rows.push(r);
    }
    const ms = metrics && metrics.length ? metrics : [{ fn: 'count' }];
    rows = [...groups.values()].map(({ keys, rows: rs }) => {
      const o = { ...keys };
      for (const m of ms) {
        const vals = m.field ? rs.map((r) => num(r[m.field])).filter((v) => typeof v === 'number') : [];
        const as = m.as || (m.fn === 'count' ? 'count' : `${m.fn}_${m.field}`);
        o[as] = m.fn === 'count' ? rs.length
          : m.fn === 'sum' ? vals.reduce((x, y) => x + y, 0)
          : m.fn === 'avg' ? (vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 100) / 100 : null)
          : m.fn === 'min' ? Math.min(...vals)
          : m.fn === 'max' ? Math.max(...vals) : null;
      }
      return o;
    });
  } else if (metrics && metrics.length) {
    const o = {};
    for (const m of metrics) {
      const vals = m.field ? rows.map((r) => num(r[m.field])).filter((v) => typeof v === 'number') : [];
      const as = m.as || (m.fn === 'count' ? 'count' : `${m.fn}_${m.field}`);
      o[as] = m.fn === 'count' ? rows.length : m.fn === 'sum' ? vals.reduce((x, y) => x + y, 0)
        : m.fn === 'avg' ? (vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 100) / 100 : null)
        : m.fn === 'min' ? Math.min(...vals) : Math.max(...vals);
    }
    return { total_matching, rows: [o] };
  }

  if (order_by && order_by.field) {
    const dir = order_by.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((x, y) => {
      const a = num(x[order_by.field]), b = num(y[order_by.field]);
      return a === b ? 0 : (a > b ? 1 : -1) * dir;
    });
  }
  let out = rows.slice(0, limit);
  if (select && select.length) out = out.map((r) => Object.fromEntries(select.map((k) => [k, r[k]])));
  return { total_matching, returned: out.length, rows: out };
}

// Longest runs of consecutive games (in season/week order) where `condition` holds, per group (default: per manager).
function streaks({ dataset, condition, filters = [], group_by = ['manager'], top = 10, min_length = 2 }) {
  const d = load(dataset);
  if (!Array.isArray(d)) throw new Error(`"${dataset}" is not a table.`);
  if (!condition || !condition.field) throw new Error('condition {field, op, value} is required');
  top = Math.min(Math.max(1, top | 0 || 10), 50);
  const rows = d.filter((r) => filters.every((f) => matches(r, f)));
  const groups = new Map();
  for (const r of rows) {
    const key = group_by.map((g) => r[g]).join(' / ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const latest = rows.reduce((m, r) => Math.max(m, +r.season * 100 + +r.week), 0);
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (+a.season - +b.season) || (+a.week - +b.week));
    let run = [];
    const flush = () => {
      if (run.length >= min_length) {
        const a = run[0], b = run[run.length - 1];
        out.push({ group: key, length: run.length, from: `${a.season} Wk ${a.week}`, to: `${b.season} Wk ${b.week}`, ongoing: +b.season * 100 + +b.week === latest });
      }
      run = [];
    };
    for (const r of list) { if (matches(r, condition)) run.push(r); else flush(); }
    flush();
  }
  out.sort((a, b) => b.length - a.length);
  return { note: 'Streaks run through consecutive games in season/week order, including across seasons. Filters remove games before the streak is computed.', total_streaks: out.length, streaks: out.slice(0, top) };
}

function getJson({ dataset, key }) {
  let d = load(dataset);
  if (key) d = d[key];
  const s = JSON.stringify(d);
  return s.length > 12000 ? { truncated: true, text: s.slice(0, 12000) } : d;
}

module.exports = { describe, query, streaks, getJson, listDatasets };
