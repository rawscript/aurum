// whatsappClient.js
// Thin wrapper around Meta's WhatsApp Cloud API for sending messages.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const axios = require("axios");

const GRAPH_VERSION = "v20.0";

function client() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !token) {
    throw new Error(
      "Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN in environment."
    );
  }
  return axios.create({
    baseURL: `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

async function sendText(to, body) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: false },
  });
}

// Sends up to 3 tappable buttons — nicer than free text for single_choice
// questions with few options. WhatsApp caps button labels at 20 chars.
async function sendButtons(to, body, options) {
  const buttons = options.slice(0, 3).map((opt, i) => ({
    type: "reply",
    reply: { id: `opt_${i}`, title: opt.slice(0, 20) },
  }));
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons },
    },
  });
}

// For 4+ options, WhatsApp requires a list message instead of buttons.
async function sendList(to, body, options) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: "Choose",
        sections: [
          {
            title: "Options",
            rows: options.slice(0, 10).map((opt, i) => ({
              id: `opt_${i}`,
              title: opt.slice(0, 24),
            })),
          },
        ],
      },
    },
  });
}

module.exports = { sendText, sendButtons, sendList };
