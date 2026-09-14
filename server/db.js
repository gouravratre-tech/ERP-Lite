const { Pool } = require('pg');
const { SHEETS, SHARED_SHEETS } = require('./config');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set it to your Neon connection string.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon (and most managed Postgres) require SSL. Set DATABASE_SSL=false only
  // for a local Postgres instance you're using to test this project.
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}

// A tiny settings table replaces PropertiesService / UserProperties
async function ensureSettingsTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS "Settings" (key TEXT PRIMARY KEY, value TEXT)`);
}
async function getSetting(key, fallback) {
  const rows = await query('SELECT value FROM "Settings" WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO "Settings" (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

// Attachments are stored as rows (bytea) rather than local disk, because Render's
// free tier wipes its filesystem on every restart/redeploy. Neon's free tier is
// capped at 0.5GB total though, so this isn't meant for large volumes of big files.
async function ensureAttachmentsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "Attachments" (
      "Id" TEXT PRIMARY KEY,
      "FileName" TEXT,
      "MimeType" TEXT,
      "Data" BYTEA,
      "CreatedAt" TIMESTAMPTZ DEFAULT now()
    )
  `);
}

// Creates missing tables and adds missing columns (never deletes anything) —
// run once at startup, safe to run again on every deploy.
async function ensureSchema() {
  await ensureSettingsTable();
  await ensureAttachmentsTable();
  for (const key of Object.keys(SHEETS)) {
    const cfg = SHEETS[key];
    const isShared = SHARED_SHEETS.indexOf(cfg.name) > -1;
    const allCols = isShared ? cfg.columns.slice() : ['FirmId'].concat(cfg.columns);

    const colDefs = allCols.map(c => `"${c}" TEXT`).join(', ');
    await pool.query(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${colDefs})`);

    for (const c of allCols) {
      await pool.query(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS "${c}" TEXT`);
    }
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${cfg.name}_id" ON "${cfg.name}" ("${cfg.idField}")`);
    if (!isShared) {
      await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${cfg.name}_firm" ON "${cfg.name}" ("FirmId")`);
    }
  }
}

module.exports = { pool, query, ensureSchema, getSetting, setSetting };
