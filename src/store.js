// store.js
// Data-access layer backed by Postgres (Neon). Every function here is now
// async — callers must `await` them. The rest of the app (server.js,
// conversationEngine.js, scheduler.js) only ever talks to this module, so
// the database itself stays a clean, swappable seam.

const db = require("./db");

// ---------- Organizers ----------

async function upsertOrganizer({ googleId, email, name, accessToken, refreshToken, tokenExpiry }) {
  const { rows } = await db.query(
    `INSERT INTO organizers (google_id, email, name, access_token, refresh_token, token_expiry)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (google_id) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       access_token = EXCLUDED.access_token,
       -- keep the existing refresh token if Google doesn't send a new one
       -- (it only sends one on the very first consent grant)
       refresh_token = COALESCE(EXCLUDED.refresh_token, organizers.refresh_token),
       token_expiry = EXCLUDED.token_expiry
     RETURNING *`,
    [googleId, email, name, accessToken, refreshToken, tokenExpiry]
  );
  return mapOrganizer(rows[0]);
}

async function getOrganizer(id) {
  const { rows } = await db.query(`SELECT * FROM organizers WHERE id = $1`, [id]);
  return rows[0] ? mapOrganizer(rows[0]) : null;
}

async function updateOrganizerTokens(id, { accessToken, tokenExpiry, refreshToken }) {
  await db.query(
    `UPDATE organizers SET access_token = $2, token_expiry = $3,
       refresh_token = COALESCE($4, refresh_token)
     WHERE id = $1`,
    [id, accessToken, tokenExpiry, refreshToken || null]
  );
}

function mapOrganizer(row) {
  if (!row) return null;
  return {
    id: row.id,
    googleId: row.google_id,
    email: row.email,
    name: row.name,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiry: Number(row.token_expiry),
    createdAt: row.created_at,
  };
}

// ---------- Forms ----------

async function saveForm(form) {
  await db.query(
    `INSERT INTO forms (id, organizer_id, title, questions, source_url, provider, event_date_time, sheet_id, reminder_sent, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()))
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       questions = EXCLUDED.questions,
       source_url = EXCLUDED.source_url,
       provider = EXCLUDED.provider,
       event_date_time = EXCLUDED.event_date_time,
       sheet_id = EXCLUDED.sheet_id,
       reminder_sent = EXCLUDED.reminder_sent`,
    [
      form.id,
      form.organizerId || null,
      form.title,
      JSON.stringify(form.questions),
      form.sourceUrl,
      form.provider,
      form.eventDateTime,
      form.sheetId,
      !!form.reminderSent,
      form.createdAt || null,
    ]
  );
  return form;
}

async function getForm(formId) {
  const { rows } = await db.query(`SELECT * FROM forms WHERE id = $1`, [formId]);
  return rows[0] ? mapForm(rows[0]) : null;
}

async function listForms(organizerId = null) {
  const { rows } = organizerId
    ? await db.query(`SELECT * FROM forms WHERE organizer_id = $1 ORDER BY created_at DESC`, [organizerId])
    : await db.query(`SELECT * FROM forms ORDER BY created_at DESC`);
  return rows.map(mapForm);
}

function mapForm(row) {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    questions: row.questions, // jsonb comes back already parsed
    sourceUrl: row.source_url,
    provider: row.provider,
    eventDateTime: row.event_date_time,
    sheetId: row.sheet_id,
    reminderSent: row.reminder_sent,
    createdAt: row.created_at,
  };
}

// ---------- Conversations ----------
// Keyed by WhatsApp sender id (waId) — one active conversation per user.

async function getConversation(waId) {
  const { rows } = await db.query(`SELECT * FROM conversations WHERE wa_id = $1`, [waId]);
  return rows[0] ? mapConvo(rows[0]) : null;
}

async function saveConversation(waId, convo) {
  await db.query(
    `INSERT INTO conversations
       (wa_id, form_id, lang, stage, current_question_index, answers, status, nudged, created_at, last_message_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, now()),COALESCE($10, now()),$11)
     ON CONFLICT (wa_id) DO UPDATE SET
       form_id = EXCLUDED.form_id,
       lang = EXCLUDED.lang,
       stage = EXCLUDED.stage,
       current_question_index = EXCLUDED.current_question_index,
       answers = EXCLUDED.answers,
       status = EXCLUDED.status,
       nudged = EXCLUDED.nudged,
       last_message_at = EXCLUDED.last_message_at,
       completed_at = EXCLUDED.completed_at`,
    [
      waId,
      convo.formId,
      convo.lang,
      convo.stage,
      convo.currentQuestionIndex || 0,
      JSON.stringify(convo.answers || {}),
      convo.status,
      !!convo.nudged,
      convo.createdAt || null,
      convo.lastMessageAt || null,
      convo.completedAt || null,
    ]
  );
  return convo;
}

async function deleteConversation(waId) {
  await db.query(`DELETE FROM conversations WHERE wa_id = $1`, [waId]);
}

async function listConversationsForForm(formId) {
  const { rows } = await db.query(`SELECT * FROM conversations WHERE form_id = $1`, [formId]);
  return rows.map(mapConvo);
}

async function allConversations() {
  const { rows } = await db.query(`SELECT * FROM conversations`);
  return rows.map(mapConvo);
}

function mapConvo(row) {
  return {
    waId: row.wa_id,
    formId: row.form_id,
    lang: row.lang,
    stage: row.stage,
    currentQuestionIndex: row.current_question_index,
    answers: row.answers,
    status: row.status,
    nudged: row.nudged,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    completedAt: row.completed_at,
  };
}

module.exports = {
  upsertOrganizer,
  getOrganizer,
  updateOrganizerTokens,
  saveForm,
  getForm,
  listForms,
  getConversation,
  saveConversation,
  deleteConversation,
  listConversationsForForm,
  allConversations,
};
