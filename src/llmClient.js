// llmClient.js
// Wraps the NVIDIA-hosted Nemotron model (OpenAI-compatible API) and gives
// the conversation engine two narrow, specific jobs:
//   1. When someone's free-text answer doesn't exactly match a multiple-choice
//      option, ask the model whether it clearly means one of them anyway.
//   2. When someone asks a side question mid-form ("why do you need this?",
//      "what is this event?"), give a short, on-topic reply instead of just
//      repeating a validation error.
// It is deliberately NOT used to freely chat — every call is scoped and
// constrained so the bot stays predictable and on-task.

const OpenAI = require("openai");

function client() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("Missing NVIDIA_API_KEY in environment.");
  return new OpenAI({
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey,
  });
}

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

async function complete(messages, { maxTokens = 300 } = {}) {
  const completion = await client().chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.3, // low — we want consistent, predictable behavior, not creativity
    top_p: 0.95,
    max_tokens: maxTokens,
    extra_body: {
      chat_template_kwargs: { enable_thinking: true },
      reasoning_budget: 1024,
    },
    stream: false,
  });
  return completion.choices?.[0]?.message?.content?.trim() || "";
}

// Tries to match a free-text answer to one of the form's multiple-choice
// options. Returns the matched option string, or null if there's no
// confident match (in which case the caller should fall back to a normal
// "please choose one of..." re-ask).
async function matchFreeformToOption(questionLabel, options, userText) {
  const prompt = [
    {
      role: "system",
      content:
        "You match a WhatsApp user's free-text reply to one option from a fixed list. " +
        "Reply with ONLY the exact option text if there's a clear, confident match, " +
        'or the single word "NONE" if there is not. Never explain your reasoning, never add punctuation.',
    },
    {
      role: "user",
      content: `Question: ${questionLabel}\nOptions: ${options.join(" | ")}\nUser reply: "${userText}"`,
    },
  ];

  const reply = await complete(prompt, { maxTokens: 30 });
  const match = options.find((o) => o.toLowerCase() === reply.toLowerCase().trim());
  return match || null;
}

// Answers a side question the user asked instead of responding to the
// current question, then hands control back to the calling code so it can
// re-ask the pending question. Kept short and grounded in the form's own
// title/question — it must not invent event details it wasn't given.
async function answerSideQuestion(formTitle, currentQuestionLabel, userText, lang) {
  const languageInstruction =
    lang === "sw"
      ? "Respond in Swahili."
      : "Respond in English.";

  const prompt = [
    {
      role: "system",
      content:
        `You are a brief, friendly WhatsApp assistant helping someone fill out a form called "${formTitle}". ` +
        "They've asked a side question instead of answering. Give a short, helpful reply — 1-3 sentences, no markdown, " +
        "no emoji spam (at most one). Do not invent facts you weren't given about the event. " +
        `After answering, do not restate the form question yourself, the calling code will re-ask it. ${languageInstruction}`,
    },
    {
      role: "user",
      content: `Current question they were asked: "${currentQuestionLabel}"\nTheir message: "${userText}"`,
    },
  ];

  return complete(prompt, { maxTokens: 200 });
}

// Cheap heuristic to decide whether a failed answer looks like a genuine
// side question (worth an LLM call) versus just a bad/garbled attempt at
// answering (cheaper to just re-ask normally).
function looksLikeAQuestion(text) {
  return /\?|^(why|what|who|when|where|how|is this|do i|can i|habari|kwa nini|nini|vipi)\b/i.test(
    (text || "").trim()
  );
}

module.exports = { matchFreeformToOption, answerSideQuestion, looksLikeAQuestion };
