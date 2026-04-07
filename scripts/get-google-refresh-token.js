/**
 * One-time script to obtain a Google OAuth2 refresh token.
 *
 * Usage:
 *   node scripts/get-google-refresh-token.js
 *
 * Prerequisites:
 *   - GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env
 *   - The OAuth2 app must be published (or your email added as a test user)
 *   - Authorised redirect URI in Google Cloud Console must include:
 *       http://localhost:3001/oauth2callback
 *
 * Steps:
 *   1. Run this script
 *   2. Open the printed URL in your browser
 *   3. Log in with ardsleysupport@gmail.com and grant access
 *   4. The script prints your refresh token — copy it into .env as GOOGLE_OAUTH_REFRESH_TOKEN
 */

import "dotenv/config";
import http from "http";
import { google } from "googleapis";

const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:3001/oauth2callback";
const PORT          = 3001;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌  GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",          // force consent screen so refresh token is always returned
  scope: [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
  ],
});

console.log();
console.log("=".repeat(60));
console.log("  Google OAuth2 — Refresh Token Setup");
console.log("=".repeat(60));
console.log();
console.log("Open this URL in your browser:");
console.log();
console.log(authUrl);
console.log();
console.log("Waiting for Google to redirect to localhost...");
console.log("(If you see an 'unverified app' warning, click Advanced → Go to app)");
console.log();

// Start a temporary local server to catch the OAuth2 callback
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) return;

  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const code   = url.searchParams.get("code");
  const error  = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>Auth failed: ${error}</h2><p>You can close this tab.</p>`);
    console.error("❌  Auth failed:", error);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <h2>✅ Authorisation successful!</h2>
      <p>You can close this tab and check the terminal for your refresh token.</p>
    `);

    console.log("=".repeat(60));
    console.log("  ✅  Authorisation successful!");
    console.log("=".repeat(60));
    console.log();
    console.log("Add this to your .env file:");
    console.log();
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log();
    console.log("Also add the same value to Render environment variables.");
    console.log();

    if (!tokens.refresh_token) {
      console.warn("⚠️  No refresh token returned.");
      console.warn("    This usually means the app was already authorised previously.");
      console.warn("    Go to https://myaccount.google.com/permissions, revoke access,");
      console.warn("    then run this script again.");
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><p>${err.message}</p>`);
    console.error("❌  Token exchange failed:", err.message);
  }

  server.close();
});

server.listen(PORT, () => {});
