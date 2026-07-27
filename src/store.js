// store.js
// Minimal JSON-file datastore. Swap this out for Postgres/Mongo later —
// every other module only talks to the functions exported here, never
// to the file directly, so the storage layer is a clean seam to replace.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { forms: {}, conversations: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- Forms ----------

function saveForm(form) {
  const db = load();
  db.forms[form.id] = form;
  save(db);
  return form;
}

function getForm(formId) {
  const db = load();
  return db.forms[formId] || null;
}

function listForms() {
  const db = load();
  return Object.values(db.forms);
}

// ---------- Conversations ----------
// Keyed by WhatsApp sender id (waId), since one number holds one active
// conversation with a given user at a time.

function getConversation(waId) {
  const db = load();
  return db.conversations[waId] || null;
}

function saveConversation(waId, convo) {
  const db = load();
  db.conversations[waId] = convo;
  save(db);
  return convo;
}

function deleteConversation(waId) {
  const db = load();
  delete db.conversations[waId];
  save(db);
}

function listConversationsForForm(formId) {
  const db = load();
  return Object.values(db.conversations).filter((c) => c.formId === formId);
}

function allConversations() {
  const db = load();
  return Object.values(db.conversations);
}

module.exports = {
  saveForm,
  getForm,
  listForms,
  getConversation,
  saveConversation,
  deleteConversation,
  listConversationsForForm,
  allConversations,
};
