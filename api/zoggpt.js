const { sql } = require('./lib/db');
const { getManagerSession } = require('./lib/session');
const data = require('./lib/zoggpt_data');

const MODEL = process.env.ZOGGPT_MODEL || 'claude-haiku-5-5';
const DAILY_LIMIT = parseInt(process.env.ZOGGPT_DAILY_LIMIT || '30', 10);
const MAX_TOOL_ROUNDS = 6;

const SYSTEM = `You are ZogGPT, the stats assistant for the NWL (National Wayzata League), a 13-team fantasy football league that has played since 2013. You answer questions about league history using the data tools. Rules:
- Answer ONLY from tool results. Never guess or fill in from memory. If the data can't answer, say so plainly.
- Always call describe_data first if you're unsure which dataset or fields exist. Numbers are often stored as strings; the query tool handles that.
- Keep answers short and direct: lead with the answer, then one line of context. Use plain text, no tables unless asked. Show scores to one decimal.
- Compare across the whole league history (2013 onward) by default. Scoring rules changed over the years (see the scoring_era_notes dataset); if a comparison across eras would change the conclusion, mention it briefly.
- Data caveats: transaction counts per manager (manager_season_tx) count a trade for both teams involved. Trade-by-trade data (trades, transactions_with_dates) only exists from 2022 on. Before 2024 the league did not separate waivers from free agent pickups.
- You only discuss NWL data. Politely decline anything else.`;

const TOOLS = [
  { name: 'describe_data', description: 'List every dataset with its row count, field names, and a sample row. Call this first if unsure what is available.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'query_data',
    description: 'Filter, group, aggregate, sort and limit rows of a table dataset. Field values that look numeric are compared as numbers. Strings compare case-insensitively.',
    input_schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] }, value: {} }, required: ['field', 'value'] } },
        select: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
        group_by: { type: 'array', items: { type: 'string' } },
        metrics: { type: 'array', items: { type: 'object', properties: { fn: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, field: { type: 'string' }, as: { type: 'string' } }, required: ['fn'] }, description: 'Aggregates, with or without group_by' },
        order_by: { type: 'object', properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'integer', description: 'Max rows, default 25, max 100' },
      },
      required: ['dataset'],
    },
  },
  { name: 'get_json', description: 'Read an object-style dataset (e.g. season_2026/standings) or one top-level key of it. Output is truncated at ~12k characters.', input_schema: { type: 'object', properties: { dataset: { type: 'string' }, key: { type: 'string' } }, required: ['dataset'] } },
];

function runTool(name, input) {
  try {
    if (name === 'describe_data') return data.describe();
    if (name === 'query_data') return data.query(input);
    if (name === 'get_json') return data.getJson(input);
    return { error: `Unknown tool ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}

async function underLimit(manager) {
  await sql`CREATE TABLE IF NOT EXISTS zoggpt_usage (manager text NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, count int NOT NULL DEFAULT 0, PRIMARY KEY (manager, day))`;
  const r = await sql`INSERT INTO zoggpt_usage (manager, day, count) VALUES (${manager}, CURRENT_DATE, 1)
    ON CONFLICT (manager, day) DO UPDATE SET count = zoggpt_usage.count + 1 RETURNING count`;
  return r.rows[0].count <= DAILY_LIMIT;
}

async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ZogGPT is not configured yet.' });

  const manager = getManagerSession(req);
  if (!manager) return res.status(401).json({ error: 'Log in on the Pick’em page to use ZogGPT.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const history = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
  const messages = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'Ask a question.' });

  try {
    if (!(await underLimit(manager))) return res.status(429).json({ error: `Daily limit of ${DAILY_LIMIT} questions reached. Try again tomorrow.` });

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      const out = await callClaude(messages);
      if (out.stop_reason !== 'tool_use') {
        const text = (out.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return res.status(200).json({ answer: text || 'I couldn’t find an answer to that.' });
      }
      messages.push({ role: 'assistant', content: out.content });
      messages.push({
        role: 'user',
        content: out.content.filter((b) => b.type === 'tool_use').map((b) => ({
          type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(runTool(b.name, b.input || {})).slice(0, 30000),
        })),
      });
    }
    res.status(200).json({ answer: 'That question needed too many lookups. Try asking it more narrowly.' });
  } catch (e) {
    console.error('zoggpt', e);
    res.status(500).json({ error: 'ZogGPT hit an error. Try again.' });
  }
};
