// sheetsClient.js
// Appends completed form responses to a Google Sheet using a service account.
// Setup: Google Cloud Console > create service account > enable Sheets API >
// download JSON key > share the target spreadsheet with the service account email.

const { google } = require("googleapis");

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error("Missing Google service account credentials in environment.");
  }
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
}

async function ensureHeaderRow(sheets, spreadsheetId, questions) {
  const header = ["Timestamp", "WhatsApp Number", ...questions.map((q) => q.label)];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: { values: [header] },
  });
}

async function appendResponse(spreadsheetId, form, waId, answers) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Cheap idempotent header write — fine at this volume, and guarantees a
  // brand-new sheet always gets labeled columns before the first row lands.
  await ensureHeaderRow(sheets, spreadsheetId, form.questions);

  const row = [
    new Date().toISOString(),
    waId,
    ...form.questions.map((q) => answers[q.id] ?? ""),
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Sheet1!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

// Creates a fresh spreadsheet for a new form and returns its ID.
// Organizers can also skip this and paste an existing sheet ID they own.
async function createSpreadsheetForForm(form) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Aurum — ${form.title}` },
      sheets: [{ properties: { title: "Sheet1" } }],
    },
  });
  const spreadsheetId = res.data.spreadsheetId;
  await ensureHeaderRow(sheets, spreadsheetId, form.questions);
  return spreadsheetId;
}

module.exports = { appendResponse, createSpreadsheetForForm };
