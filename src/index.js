// dotenv/config MUST be imported first — brand configs read process.env at import time
import "dotenv/config";

// Force IPv4-first DNS resolution globally — prevents ENETUNREACH errors on hosts
// (e.g. Render) where IPv6 routing is unavailable but DNS returns AAAA records.
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");

import express from "express";
import { handleGenerateContentWebhook } from "./webhooks/generate-content.webhook.js";
import { handleGenerateTitleWebhook } from "./webhooks/generate-title.webhook.js";
import { handleGenerateNewsletterWebhook } from "./webhooks/generate-newsletter.webhook.js";

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
app.post("/webhooks/:brandId/generate-title", handleGenerateTitleWebhook);
app.post("/webhooks/:brandId/generate-newsletter", handleGenerateNewsletterWebhook);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Running on port ${PORT}`);
});
