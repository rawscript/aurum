// googleAuth.js
// Handles "Sign in with Google" for organizers. Unlike the old service-account
// approach, every Sheet Aurum creates now lives in the organizer's own Drive,
// under their own account — Aurum just holds a token they can revoke anytime
// from myaccount.google.com/permissions.

const { google } = require("googleapis");
const store = require("./store");

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file", // only files Aurum itself creates — not the organizer's whole Drive
];

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent", // forces refresh_token on every sign-in, not just the first
    scope: SCOPES,
  });
}

// Exchanges the ?code= from Google's redirect for tokens, fetches the
// organizer's profile, and upserts them into the organizers table.
async function handleCallback(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data: profile } = await oauth2.userinfo.get();

  const organizer = await store.upsertOrganizer({
    googleId: profile.id,
    email: profile.email,
    name: profile.name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token, // may be null on repeat sign-ins; upsertOrganizer preserves the old one
    tokenExpiry: tokens.expiry_date,
  });

  return organizer;
}

// Returns a ready-to-use OAuth2 client for an organizer, refreshing the
// access token first if it's expired or about to expire.
async function getAuthorizedClient(organizerId) {
  const organizer = await store.getOrganizer(organizerId);
  if (!organizer) throw new Error("Organizer not found — please sign in again.");
  if (!organizer.refreshToken) {
    throw new Error(
      "No Google refresh token on file for this organizer — they need to sign in again and approve access."
    );
  }

  const client = newOAuthClient();
  client.setCredentials({
    access_token: organizer.accessToken,
    refresh_token: organizer.refreshToken,
    expiry_date: organizer.tokenExpiry,
  });

  const isExpiringSoon = !organizer.tokenExpiry || organizer.tokenExpiry < Date.now() + 60_000;
  if (isExpiringSoon) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    await store.updateOrganizerTokens(organizerId, {
      accessToken: credentials.access_token,
      tokenExpiry: credentials.expiry_date,
      refreshToken: credentials.refresh_token,
    });
  }

  return client;
}

module.exports = { getAuthUrl, handleCallback, getAuthorizedClient };
