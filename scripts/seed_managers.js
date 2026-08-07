// One-time setup: creates a random passcode for each of the 13 managers and inserts them
// (bcrypt-hashed) into the managers table. Prints the plaintext passcodes to your own
// terminal ONLY, once - copy them somewhere safe (a note, a password manager) and share with
// each manager however you like. Nothing plaintext is ever written to a file or the database.
//
// Usage:
//   cd ~/Sites/nwl_site
//   vercel env pull .env.local          # pulls POSTGRES_URL etc. from the linked Vercel project
//   export $(grep -v '^#' .env.local | xargs)
//   node scripts/seed_managers.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { sql } = require('../api/lib/db');

// Stowe is a former manager (2013-2016) kept in data/managers.json for the historical archive,
// but doesn't play in the live season - skip him so he never gets a login.
const INACTIVE_MANAGERS = ['Stowe'];

function randomPasscode() {
  // 6-digit numeric, easy to text/read aloud - this is a friends-league gate, not a bank login.
  return String(crypto.randomInt(100000, 999999));
}

async function main() {
  const managersPath = path.join(__dirname, '..', 'data', 'managers.json');
  const managers = JSON.parse(fs.readFileSync(managersPath, 'utf8'));

  console.log('Manager passcodes (copy these now, they will not be shown again):\n');
  for (const { manager } of managers) {
    if (INACTIVE_MANAGERS.includes(manager)) continue;
    const passcode = randomPasscode();
    const hash = await bcrypt.hash(passcode, 10);
    await sql`
      INSERT INTO managers (name, passcode_hash) VALUES (${manager}, ${hash})
      ON CONFLICT (name) DO UPDATE SET passcode_hash = ${hash}
    `;
    console.log(`  ${manager.padEnd(12)} ${passcode}`);
  }
  console.log('\nDone. Share each passcode with its manager, then delete this output from your terminal scrollback.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
