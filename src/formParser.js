// formParser.js
// Given a public Google Forms or Microsoft Forms link, fetch it and
// return a normalized list of questions Aurum's chat engine can walk through.
//
// Normalized question shape:
// { id, label, type: 'short_text' | 'long_text' | 'single_choice' | 'multi_choice' | 'email' | 'number', options: [], required: bool }

const axios = require("axios");
const cheerio = require("cheerio");

const GOOGLE_QUESTION_TYPES = {
  0: "short_text", // SHORT_ANSWER
  1: "long_text", // PARAGRAPH
  2: "single_choice", // MULTIPLE_CHOICE
  3: "single_choice", // DROPDOWN
  4: "multi_choice", // CHECKBOX
  5: "linear_scale",
  7: "grid",
  9: "date",
  10: "time",
};

async function parseForm(url) {
  if (/docs\.google\.com\/forms/.test(url)) {
    return parseGoogleForm(url);
  }
  if (/forms\.office\.com|forms\.microsoft\.com/.test(url)) {
    return parseMicrosoftForm(url);
  }
  throw new Error(
    "Unrecognized form link. Aurum currently supports Google Forms and Microsoft Forms URLs."
  );
}

async function parseGoogleForm(url) {
  const { data: html } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 (AurumFormBot)" },
  });

  const match = html.match(/var FB_PUBLIC_LOAD_DATA_ = (.*?);<\/script>/s);
  if (!match) {
    throw new Error(
      "Could not read this Google Form. Make sure link sharing is set to 'Anyone with the link'."
    );
  }

  const raw = JSON.parse(match[1]);
  const title = raw[3] || "Untitled form";
  const items = (raw[1] && raw[1][1]) || [];

  const questions = [];
  for (const item of items) {
    const label = item[1];
    const typeArr = item[4];
    if (!label || !typeArr) continue; // skip section headers/images with no answer field

    const fieldId = typeArr[0][0];
    const googleType = item[3];
    const required = !!(typeArr[0][2] === 1);
    const optionsRaw = typeArr[0][1];
    const options = optionsRaw ? optionsRaw.map((o) => o[0]) : [];

    let type = GOOGLE_QUESTION_TYPES[googleType] || "short_text";
    if (type === "grid" || type === "linear_scale") {
      // Not conversationally friendly to replicate exactly — degrade gracefully.
      type = "short_text";
    }
    if (/email/i.test(label)) type = "email";

    questions.push({
      id: String(fieldId),
      label: label.trim(),
      type,
      options,
      required,
    });
  }

  return { title, questions, sourceUrl: url, provider: "google_forms" };
}

async function parseMicrosoftForm(url) {
  // Microsoft Forms doesn't expose a clean embedded JSON blob the way Google
  // Forms does, so this is a best-effort HTML scrape. It reliably gets
  // question labels and choice options for simple forms; grids, ranking, and
  // file-upload questions are not supported and are skipped with a warning.
  const { data: html } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 (AurumFormBot)" },
  });
  const $ = cheerio.load(html);

  const title = $("title").first().text().replace(/- Microsoft Forms.*/i, "").trim() || "Untitled form";

  const questions = [];
  $("[data-automation-id='questionItem']").each((i, el) => {
    const label = $(el).find("[data-automation-id='questionTitle']").text().trim();
    if (!label) return;

    const hasChoices = $(el).find("[data-automation-id='choiceOption']").length > 0;
    const options = [];
    if (hasChoices) {
      $(el)
        .find("[data-automation-id='choiceOption']")
        .each((j, opt) => options.push($(opt).text().trim()));
    }

    questions.push({
      id: `msq_${i}`,
      label,
      type: hasChoices ? "single_choice" : "short_text",
      options,
      required: $(el).text().includes("*"),
    });
  });

  if (questions.length === 0) {
    throw new Error(
      "Couldn't read any questions from this Microsoft Form. It may require sign-in, or its layout isn't supported yet — you can add questions manually in the Aurum dashboard instead."
    );
  }

  return { title, questions, sourceUrl: url, provider: "microsoft_forms" };
}

module.exports = { parseForm };
