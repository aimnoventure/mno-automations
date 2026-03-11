// dotenv/config MUST be imported first — brand configs read process.env at import time
import "dotenv/config";

import express from "express";
import { handleGenerateContentWebhook } from "./webhooks/generate-content.webhook.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
// The verify callback attaches the raw body Buffer to req.rawBody.
// This is required for HMAC-SHA256 webhook signature validation in validate-webhook.js.
// Do NOT add express.raw() separately — it would consume the body stream before
// express.json() can parse it.
app.use(
  express.json({
    verify: (_req, _res, buf) => {
      _req.rawBody = buf;
    },
  })
);

// ── Health check ──────────────────────────────────────────────────────────────
// Ping this endpoint every 10 minutes (e.g. via cron-job.org) to prevent
// cold starts on Render's free tier.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Webhook routes ────────────────────────────────────────────────────────────
app.post("/webhooks/:brandId/generate-content", handleGenerateContentWebhook);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Running on port ${PORT}`);
});
