// One-time (or per-new-manager) setup: inserts a row per manager into the managers table with
// no password set yet (passcode_hash NULL) - each manager claims their own account by simply
// logging in for the first time and choosing a password themselves (see api/login.js). Nothing
// to generate or distribute here anymore.
//
// Safe to re-run: existing managers (already claimed or not) are left untouched via
// ON CONFLICT DO NOTHING - this only ever adds rows for managers who don't have one yet.
//
// Usage:
//   cd ~/Sites/nwl_site
//   vercel env pull .env.local          # pulls POSTGRES_URL etc. from the linked Vercel project
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_managers.js

const fs = require('fs');
const path = require('path');
const { sql } = require('../api/lib/db');

// Stowe is a former manager (2013-2016) kept in data/managers.json for the historical archive,
// but doesn't play in the live season - skip him so he never gets a login.
const INACTIVE_MANAGERS = ['Stowe'];

async function main() {
  const managersPath = path.join(__dirname, '..', 'data', 'managers.json');
  const managers = JSON.parse(fs.readFileSync(managersPath, 'utf8'));

  for (const { manager } of managers) {
    if (INACTIVE_MANAGERS.includes(manager)) continue;
    await sql`
      INSERT INTO managers (name, passcode_hash) VALUES (${manager}, NULL)
      ON CONFLICT (name) DO NOTHING
    `;
    console.log(`  ${manager}`);
  }
  console.log('\nDone. Each manager sets their own password the first time they log in at /pages/pickem.html.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
