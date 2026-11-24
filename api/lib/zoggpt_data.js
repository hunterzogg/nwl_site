// Read-only query engine over the league's JSON data, used by the ZogGPT tools.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const SKIP = new Set(['player_weeks', 'nfl_position_finishes', 'scorigami_combos']); // too big / nested for generic queries
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
  return out.sort();
}

function load(name) {
  if (!listDatasets().includes(name)) throw new Error(`Unknown dataset "${name}". Call describe_data to list datasets.`);
  if (!cache[name]) cache[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + '.json'), 'utf8'));
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

function getJson({ dataset, key }) {
  let d = load(dataset);
  if (key) d = d[key];
  const s = JSON.stringify(d);
  return s.length > 12000 ? { truncated: true, text: s.slice(0, 12000) } : d;
}

module.exports = { describe, query, getJson, listDatasets };
