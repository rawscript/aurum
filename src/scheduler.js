// scheduler.js
// Two background jobs:
//  1. Nudge people who went quiet mid-conversation.
//  2. Send a reminder to everyone who completed a form, N hours before the event.

const cron = require("node-cron");
const store = require("./store");
const wa = require("./whatsappClient");

const NUDGE_AFTER_MINUTES = Number(process.env.NUDGE_AFTER_MINUTES || 60);
const REMINDER_HOURS_BEFORE_EVENT = Number(process.env.REMINDER_HOURS_BEFORE_EVENT || 24);

async function runNudgeCheck() {
  const now = Date.now();
  const conversations = await store.allConversations();

  for (const convo of conversations) {
    if (convo.stage !== "in_progress" || convo.nudged) continue;
    const minutesSinceActivity = (now - new Date(convo.lastMessageAt).getTime()) / 60000;
    if (minutesSinceActivity >= NUDGE_AFTER_MINUTES) {
      try {
        await wa.sendText(
          convo.waId,
          convo.lang === "sw"
            ? "Habari, uko pale? Nimehifadhi majibu yako — jibu wakati wowote uko tayari kuendelea."
            : "Hey, still there? I saved your answers so far — just reply to continue whenever you're ready."
        );
        convo.nudged = true;
        await store.saveConversation(convo.waId, convo);
      } catch (err) {
        console.error(`Nudge failed for ${convo.waId}:`, err.message);
      }
    }
  }
}

async function runReminderCheck() {
  const now = Date.now();
  const forms = await store.listForms();

  for (const form of forms) {
    if (!form.eventDateTime || form.reminderSent) continue;
    const eventTime = new Date(form.eventDateTime).getTime();
    const hoursUntilEvent = (eventTime - now) / 3600000;

    if (hoursUntilEvent <= REMINDER_HOURS_BEFORE_EVENT && hoursUntilEvent > 0) {
      const attendees = (await store.listConversationsForForm(form.id)).filter(
        (c) => c.status === "completed"
      );

      for (const convo of attendees) {
        try {
          const when = new Date(form.eventDateTime).toLocaleString();
          await wa.sendText(
            convo.waId,
            convo.lang === "sw"
              ? `Kikumbusho: "${form.title}" ni saa ${when}. Tunakuona hivi karibuni! 🎉`
              : `Reminder: "${form.title}" is coming up on ${when}. See you there! 🎉`
          );
        } catch (err) {
          console.error(`Reminder failed for ${convo.waId}:`, err.message);
        }
      }
      form.reminderSent = true;
      await store.saveForm(form);
    }
  }
}

function start() {
  // Every 5 minutes is frequent enough for both jobs without hammering the API.
  cron.schedule("*/5 * * * *", () => {
    runNudgeCheck().catch((e) => console.error("Nudge job error:", e));
    runReminderCheck().catch((e) => console.error("Reminder job error:", e));
  });
  console.log("Aurum scheduler started (nudges + reminders, every 5 min).");
}

module.exports = { start };
EOF
node -c /home/claude/aurum/src/scheduler.js && echo OK