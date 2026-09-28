'use strict';
// better-sqlite3 singleton. Creates data/ + data/uploads if missing,
// opens data/marketplace.db, and runs db/schema.sql on boot (idempotent).
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const db = new Database(path.join(dataDir, 'marketplace.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migration: add trial_ends_at to pro_profiles if missing
// (SQLite has no ADD COLUMN IF NOT EXISTS).
try {
  const cols = db.prepare('PRAGMA table_info(pro_profiles)').all().map((c) => c.name);
  if (!cols.includes('trial_ends_at')) {
    db.exec('ALTER TABLE pro_profiles ADD COLUMN trial_ends_at TEXT');
  }
  if (!cols.includes('is_partner')) {
    db.exec('ALTER TABLE pro_profiles ADD COLUMN is_partner INTEGER NOT NULL DEFAULT 0');
  }
} catch (e) {
  console.error('Migration failed:', e.message);
}

function now() {
  return new Date().toISOString();
}

module.exports = { db, now };
