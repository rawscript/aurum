// conversationEngine.js
// The heart of Aurum: takes one incoming WhatsApp message + the sender's
// current conversation state, and decides what happens next — ask the next
// question, re-ask on a bad answer, or wrap up and write to the sheet.

const store = require("./store");
const wa = require("./whatsappClient");
const { appendResponse } = require("./sheetsClient");

const COPY = {
  en: {
    chooseLanguage: "Hi! Which language would you like to continue in?",
    welcome: (title) => `Hi 👋 I'm here to help you with "${title}". This will only take a minute — ready?`,
    invalidChoice: (opts) => `Sorry, I didn't quite get that. Please choose one of: ${opts.join(", ")}`,
    invalidEmail: "That doesn't look like a valid email — mind sending it again?",
    required: "This one's required, so I do need an answer to continue 🙂",
    done: "All done — thank you! Your response has been recorded. 🎉",
    resume: "Welcome back! Let's pick up where we left off.",
    nudge: "Hey, still there? I saved your answers so far — just reply to continue whenever you're ready.",
  },
  sw: {
    chooseLanguage: "Habari! Ungependa kuendelea kwa lugha gani?",
    welcome: (title) => `Habari 👋 Nipo hapa kukusaidia na "${title}". Itachukua dakika moja tu — uko tayari?`,
    invalidChoice: (opts) => `Samahani, sikuelewa vizuri. Tafadhali chagua mojawapo: ${opts.join(", ")}`,
    invalidEmail: "Hiyo haionekani kama barua pepe sahihi — tafadhali tuma tena?",
    required: "Swali hili linahitajika, hivyo nahitaji jibu ili tuendelee 🙂",
    done: "Tumemaliza — asante! Jibu lako limehifadhiwa. 🎉",
    resume: "Karibu tena! Tuendelee pale tulipoishia.",
    nudge: "Habari, uko pale? Nimehifadhi majibu yako — jibu wakati wowote uko tayari kuendelea.",
  },
};

function t(lang, key, ...args) {
  const dict = COPY[lang] || COPY.en;
  const val = dict[key];
  return typeof val === "function" ? val(...args) : val;
}

// Parses the special deep-link payload WhatsApp sends when someone taps a
// wa.me link with prefilled text, e.g. "Start FORM_abc123".
function extractFormId(messageText) {
  const match = (messageText || "").match(/FORM_([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function validateAnswer(question, rawText) {
  const text = (rawText || "").trim();

  if (question.required && text.length === 0) {
    return { ok: false, errorKey: "required" };
  }

  if (question.type === "email") {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
    if (!ok) return { ok: false, errorKey: "invalidEmail" };
  }

  if (question.type === "single_choice" && question.options.length > 0) {
    const match = question.options.find(
      (o) => o.toLowerCase() === text.toLowerCase()
    );
    if (!match) return { ok: false, errorKey: "invalidChoice", errorArgs: [question.options] };
    return { ok: true, value: match };
  }

  return { ok: true, value: text };
}

async function askQuestion(waId, lang, question) {
  if (question.type === "single_choice" && question.options.length > 0) {
    if (question.options.length <= 3) {
      await wa.sendButtons(waId, question.label, question.options);
    } else {
      await wa.sendList(waId, question.label, question.options);
    }
  } else {
    await wa.sendText(waId, question.label);
  }
}

// Extracts plain text from either a regular text message or a button/list reply.
function messageBodyOf(message) {
  if (message.type === "text") return message.text.body;
  if (message.type === "interactive") {
    const i = message.interactive;
    if (i.type === "button_reply") return i.button_reply.title;
    if (i.type === "list_reply") return i.list_reply.title;
  }
  return "";
}

async function handleIncomingMessage(message) {
  const waId = message.from;
  const body = messageBodyOf(message);
  let convo = store.getConversation(waId);

  // Brand-new conversation: figure out which form this belongs to.
  if (!convo) {
    const formId = extractFormId(body) || extractFormId(message.context?.body);
    if (!formId) {
      await wa.sendText(
        waId,
        "Hi! I couldn't tell which form you're here for — please scan the event's QR code or use its Aurum link to get started."
      );
      return;
    }
    const form = store.getForm(formId);
    if (!form) {
      await wa.sendText(waId, "Sorry, I couldn't find that form — it may have been removed.");
      return;
    }
    convo = {
      waId,
      formId,
      lang: null,
      stage: "awaiting_language",
      currentQuestionIndex: 0,
      answers: {},
      status: "active",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    };
    store.saveConversation(waId, convo);
    await wa.sendButtons(waId, COPY.en.chooseLanguage, ["English", "Swahili"]);
    return;
  }

  convo.lastMessageAt = new Date().toISOString();

  const form = store.getForm(convo.formId);
  if (!form) {
    store.deleteConversation(waId);
    await wa.sendText(waId, "Sorry, this form is no longer available.");
    return;
  }

  // Stage 1: language selection
  if (convo.stage === "awaiting_language") {
    const lang = /swahili/i.test(body) ? "sw" : "en";
    convo.lang = lang;
    convo.stage = "in_progress";
    store.saveConversation(waId, convo);
    await wa.sendText(waId, t(lang, "welcome", form.title));
    await askQuestion(waId, lang, form.questions[0]);
    return;
  }

  // Stage 2: walking through questions
  if (convo.stage === "in_progress") {
    const question = form.questions[convo.currentQuestionIndex];
    const result = validateAnswer(question, body);

    if (!result.ok) {
      await wa.sendText(waId, t(convo.lang, result.errorKey, ...(result.errorArgs || [])));
      return; // re-ask same question, don't advance
    }

    convo.answers[question.id] = result.value;
    convo.currentQuestionIndex += 1;
    store.saveConversation(waId, convo);

    if (convo.currentQuestionIndex >= form.questions.length) {
      convo.stage = "completed";
      convo.status = "completed";
      convo.completedAt = new Date().toISOString();
      store.saveConversation(waId, convo);
      await wa.sendText(waId, t(convo.lang, "done"));

      if (form.sheetId) {
        try {
          await appendResponse(form.sheetId, form, waId, convo.answers);
        } catch (err) {
          console.error("Failed to append to sheet:", err.message);
        }
      }
      return;
    }

    await askQuestion(waId, convo.lang, form.questions[convo.currentQuestionIndex]);
    return;
  }

  // Stage 3: already completed — treat any further message as a fresh chat
  if (convo.stage === "completed") {
    await wa.sendText(waId, "You've already completed this form — thanks again! 🎉");
    return;
  }
}

module.exports = { handleIncomingMessage, extractFormId };
