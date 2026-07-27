// sheetsClient.js
// Appends completed form responses to a Google Sheet — created and owned by
// the organizer's own Google account (via googleAuth.js), not a shared
// service account. This is what makes "sign in with Google" meaningful:
// the organizer can see the file in their own Drive and revoke access anytime.

const { google } = require("googleapis");
const googleAuth = require("./googleAuth");

async function ensureHeaderRow(sheets, spreadsheetId, questions) {
  const header = ["Timestamp", "WhatsApp Number", ...questions.map((q) => q.label)];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Sheet1!A1",
    valueInputOption: "RAW",
    requestBody: { values: [header] },
  });
}

// Creates a fresh spreadsheet in the organizer's Drive for a new form and
// returns its ID. Requires the organizer to have signed in with Google.
async function createSpreadsheetForForm(form, organizerId) {
  if (!organizerId) {
    throw new Error(
      "Creating a Sheet requires the organizer to sign in with Google first."
    );
  }
  const auth = await googleAuth.getAuthorizedClient(organizerId);
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

async function appendResponse(spreadsheetId, form, waId, answers) {
  if (!form.organizerId) {
    throw new Error("This form has no organizer on file — cannot access its Sheet.");
  }
  const auth = await googleAuth.getAuthorizedClient(form.organizerId);
  const sheets = google.sheets({ version: "v4", auth });

  // Cheap idempotent header write — guarantees a brand-new sheet always gets
  // labeled columns before the first row lands.
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

module.exports = { appendResponse, createSpreadsheetForForm };
EOF
node -c /home/claude/aurum/src/sheetsClient.js && echo OK