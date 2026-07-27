// db.js
// Postgres connection (Neon) — replaces the old JSON-file datastore.
// Everything else in the app still goes through store.js; this module
// only owns the raw connection and the schema.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL; Neon's own certs are fine to trust here
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres error on idle client:", err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS organizers (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry BIGINT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      organizer_id INTEGER REFERENCES organizers(id) ON DELETE SET NULL,
      title TEXT,
      questions JSONB NOT NULL,
      source_url TEXT,
      provider TEXT,
      event_date_time TIMESTAMPTZ,
      sheet_id TEXT,
      reminder_sent BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      wa_id TEXT PRIMARY KEY,
      form_id TEXT REFERENCES forms(id) ON DELETE CASCADE,
      lang TEXT,
      stage TEXT NOT NULL DEFAULT 'awaiting_language',
      current_question_index INTEGER NOT NULL DEFAULT 0,
      answers JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      nudged BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      last_message_at TIMESTAMPTZ DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
  `);

  console.log("Postgres schema ready (organizers, forms, conversations).");
}

module.exports = { pool, query, initSchema };
