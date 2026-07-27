require("dotenv").config();
const express = require("express");
const path = require("path");
const { nanoid } = require("nanoid");
const QRCode = require("qrcode");

const store = require("./src/store");
const { parseForm } = require("./src/formParser");
const { handleIncomingMessage } = require("./src/conversationEngine");
const { createSpreadsheetForForm } = require("./src/sheetsClient");
const scheduler = require("./src/scheduler");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const WHATSAPP_BUSINESS_NUMBER = process.env.WHATSAPP_BUSINESS_NUMBER || "";

// ---------------------------------------------------------------------------
// WhatsApp webhook
// ---------------------------------------------------------------------------

// Meta calls this once, on setup, to verify you own the endpoint.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Every inbound WhatsApp message lands here.
app.post("/webhook", async (req, res) => {
  // Acknowledge immediately — WhatsApp retries aggressively if you're slow.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;
    if (!messages) return; // could be a status update (delivered/read), ignore

    for (const message of messages) {
      await handleIncomingMessage(message);
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

// ---------------------------------------------------------------------------
// Dashboard API — used by public/index.html and public/dashboard.html
// ---------------------------------------------------------------------------

// Step 1 of the organizer flow: paste a form link, get back questions + a
// WhatsApp link + QR code.
app.post("/api/forms", async (req, res) => {
  try {
    const { url, eventDateTime, createSheet } = req.body;
    if (!url) return res.status(400).json({ error: "Missing 'url'." });

    const parsed = await parseForm(url);
    const id = nanoid(8);

    const form = {
      id,
      title: parsed.title,
      questions: parsed.questions,
      sourceUrl: parsed.sourceUrl,
      provider: parsed.provider,
      eventDateTime: eventDateTime || null,
      sheetId: null,
      reminderSent: false,
      createdAt: new Date().toISOString(),
    };

    if (createSheet) {
      try {
        form.sheetId = await createSpreadsheetForForm(form);
      } catch (err) {
        console.error("Sheet creation failed (continuing without it):", err.message);
      }
    }

    store.saveForm(form);

    const waLink = buildWhatsAppLink(id);
    const qrDataUrl = await QRCode.toDataURL(waLink, { margin: 1, width: 512 });

    res.json({ form, waLink, qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/forms", (req, res) => {
  const forms = store.listForms().map((f) => ({
    ...f,
    waLink: buildWhatsAppLink(f.id),
    stats: computeStats(f.id),
  }));
  res.json(forms);
});

app.get("/api/forms/:id", (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form) return res.status(404).json({ error: "Not found" });
  res.json({ ...form, waLink: buildWhatsAppLink(form.id), stats: computeStats(form.id) });
});

app.get("/api/forms/:id/qr", async (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form) return res.status(404).send("Not found");
  const png = await QRCode.toBuffer(buildWhatsAppLink(form.id), { margin: 1, width: 512 });
  res.set("Content-Type", "image/png");
  res.send(png);
});

app.get("/api/forms/:id/responses", (req, res) => {
  const form = store.getForm(req.params.id);
  if (!form) return res.status(404).json({ error: "Not found" });
  const convos = store
    .listConversationsForForm(form.id)
    .filter((c) => c.status === "completed")
    .map((c) => ({ waId: c.waId, completedAt: c.completedAt, answers: c.answers }));
  res.json(convos);
});

function buildWhatsAppLink(formId) {
  const prefill = encodeURIComponent(`Start FORM_${formId}`);
  return `https://wa.me/${WHATSAPP_BUSINESS_NUMBER}?text=${prefill}`;
}

function computeStats(formId) {
  const convos = store.listConversationsForForm(formId);
  const form = store.getForm(formId);
  const totalStarted = convos.length;
  const totalCompleted = convos.filter((c) => c.status === "completed").length;

  // Where people drop off, bucketed by question index they stalled on.
  const dropoffByQuestion = {};
  for (const c of convos) {
    if (c.status === "completed") continue;
    const idx = c.currentQuestionIndex ?? 0;
    const label = form?.questions?.[idx]?.label || `Question ${idx + 1}`;
    dropoffByQuestion[label] = (dropoffByQuestion[label] || 0) + 1;
  }

  return { totalStarted, totalCompleted, dropoffByQuestion };
}

app.listen(PORT, () => {
  console.log(`Aurum listening on port ${PORT} (${BASE_URL})`);
  scheduler.start();
});