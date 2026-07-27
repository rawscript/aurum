# Aurum

Turn any Google Forms or Microsoft Forms link into a WhatsApp conversation.
No app installs, no logins — people just scan a QR code, say "hi", and chat
their way through what used to be a form.

## How it fits together

```
public/index.html      → organizer landing page (paste link, get QR + wa.me link)
public/dashboard.html   → live stats: started / completed / drop-off per question
server.js               → Express app: webhook + dashboard API
src/formParser.js       → scrapes Google/Microsoft Forms into a normalized question list
src/conversationEngine.js → the chat state machine (language, questions, validation)
src/whatsappClient.js   → sends messages via Meta's WhatsApp Cloud API
src/sheetsClient.js     → appends completed responses to a Google Sheet
src/scheduler.js        → nudges abandoned chats, sends event reminders
src/store.js            → JSON-file datastore (swap for Postgres when you outgrow it)
data/db.json             → created automatically on first run
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Copy the environment template**
   ```bash
   cp .env.example .env
   ```

3. **WhatsApp Cloud API** (free tier is plenty to start)
   - Create a Meta developer app at developers.facebook.com → add the
     "WhatsApp" product.
   - From the WhatsApp → API Setup page, copy the temporary access token and
     the Phone Number ID into `.env`.
   - Set `WHATSAPP_VERIFY_TOKEN` to any string — you'll paste the same
     string into the Meta webhook config in step 5.
   - Set `WHATSAPP_BUSINESS_NUMBER` to the test/production number shown
     there, digits only, country code first (e.g. `15551234567`).

4. **Google Sheets export** (optional but recommended)
   - Google Cloud Console → create a project → enable the "Google Sheets
     API" → create a Service Account → generate a JSON key.
   - Put the service account's email and private key into `.env`
     (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`).
   - Leave `createSheet` checked on the landing page and Aurum will create a
     fresh spreadsheet per event automatically.

5. **Deploy and wire up the webhook**
   - Deploy this app anywhere that gives you a public HTTPS URL (Render,
     Railway, Fly.io, a small VPS, etc.) and set `BASE_URL` accordingly.
   - In the Meta app dashboard → WhatsApp → Configuration, set the webhook
     URL to `https://your-domain.example.com/webhook` and the verify token
     to match `WHATSAPP_VERIFY_TOKEN`.
   - Subscribe to the `messages` webhook field.

6. **Run it**
   ```bash
   npm start
   ```
   Visit `/` to create your first event, and `/dashboard.html` to watch
   responses come in.

## How the WhatsApp deep link works

`wa.me` links support pre-filled text via a `?text=` query parameter. Aurum
encodes the form's ID into that text (e.g. `Start FORM_ab12cd34`), so one
WhatsApp Business number can run unlimited events — when someone taps the
link or scans the QR code, WhatsApp opens with that text ready to send, and
Aurum reads it on the first message to know which form they're there for.

## Known limitations (v0.1)

- Microsoft Forms parsing is a best-effort HTML scrape — it handles short
  answer and multiple-choice questions well, but grids, ranking, and file
  uploads aren't supported yet.
- The datastore is a single JSON file. Fine for a few thousand responses;
  move to Postgres before running many concurrent large events.
- Only English and Swahili are wired up in `conversationEngine.js` — adding
  a language is just adding another key to the `COPY` object.
