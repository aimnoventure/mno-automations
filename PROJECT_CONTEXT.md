# Automation Server — Project Context

> This document describes the project's purpose, tech stack, folder structure, routing conventions, and best practices. Use this as the source of truth when generating or modifying code.

---

## Project Purpose

This is a **single Node.js backend server** that handles workflow automation previously managed in n8n. It handles:

- Receiving webhooks from **Monday.com** (per brand, per workflow type)
- Triggering **AI content generation** (blog posts, newsletters, social content, etc.)
- Publishing generated content to each brand's CMS
- Sending newsletters/emails
- Running scheduled **cron jobs**

The server is hosted on **Render** as a single Web Service.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| AI Generation | `@anthropic-ai/sdk` or `openai` |
| Scheduling | `node-cron` |
| HTTP Client | `axios` |
| Email | `resend` |
| Environment Variables | `dotenv` |
| Hosting | Render (single Web Service) |

---

## Multi-Brand Architecture

This server supports **multiple brands (companies)**. Each brand:

- Has its own Monday.com board, webhook secret, and column mappings
- Has its own brand/tone guidelines for AI generation
- Has its own CMS and email configuration
- Receives its own dedicated webhook URLs (e.g. `/webhooks/brand-a/blog-post`)

All brands share the **same pipeline logic** in `services/`. Brand-specific details are isolated in `brands/*.config.js`. Adding a new brand only requires adding a new config file — no changes to pipeline logic.

---

## Folder Structure

```
my-automation-server/
│
├── src/
│   ├── index.js                          # App entry point — registers all routes and cron jobs
│   │
│   ├── webhooks/                         # Webhook route handlers (one file per workflow type)
│   │   ├── blog-post.webhook.js          # Handles blog post creation trigger
│   │   ├── newsletter.webhook.js         # Handles newsletter trigger
│   │   └── social-post.webhook.js        # Handles social post trigger
│   │
│   ├── jobs/                             # Cron jobs (scheduled background tasks)
│   │   ├── weekly-digest.job.js
│   │   └── sitemap-ping.job.js
│   │
│   ├── services/                         # Reusable pipeline logic (shared across all brands)
│   │   ├── ai.service.js                 # AI content generation
│   │   ├── monday.service.js             # Monday.com API interactions
│   │   ├── cms.service.js                # Publish to CMS (WordPress, Ghost, etc.)
│   │   └── email.service.js              # Send newsletters/emails
│   │
│   ├── brands/                           # Brand-specific configuration
│   │   ├── brand-a.config.js             # Config for Brand A
│   │   ├── brand-b.config.js             # Config for Brand B
│   │   └── index.js                      # Exports getBrandById() lookup helper
│   │
│   └── utils/
│       ├── validate-webhook.js           # Verifies Monday.com HMAC webhook signatures
│       └── logger.js                     # Shared logger
│
├── .env                                  # All secrets and environment variables
├── .env.example                          # Template of required env vars (no real secrets)
├── package.json
├── render.yaml                           # Render deployment config as code
└── PROJECT_CONTEXT.md                    # ← This file
```

---

## Routing Convention

Each brand has its own URL namespace. All brands share the same handler function — the brand is resolved from the URL param.

```
POST /webhooks/:brandId/blog-post
POST /webhooks/:brandId/newsletter
POST /webhooks/:brandId/social-post
```

### Example Registration in `index.js`

```js
import { handleBlogPostWebhook } from "./webhooks/blog-post.webhook.js";
import { handleNewsletterWebhook } from "./webhooks/newsletter.webhook.js";

app.post("/webhooks/:brandId/blog-post", handleBlogPostWebhook);
app.post("/webhooks/:brandId/newsletter", handleNewsletterWebhook);
```

### Example Webhook Handler

```js
// webhooks/blog-post.webhook.js
import { getBrandById } from "../brands/index.js";
import { generateContent } from "../services/ai.service.js";
import { publishPost } from "../services/cms.service.js";
import { validateWebhookSignature } from "../utils/validate-webhook.js";

export async function handleBlogPostWebhook(req, res) {
  const { brandId } = req.params;

  const brand = getBrandById(brandId);
  if (!brand) return res.status(400).json({ error: "Unknown brand" });

  validateWebhookSignature(req, brand.monday.webhookSecret);

  const { itemName } = req.body.event;

  const content = await generateContent(itemName, brand.ai);
  await publishPost(content, brand.cms);

  res.json({ success: true });
}
```

---

## Brand Config Structure

Each brand config file exports an object with this shape:

```js
// brands/brand-a.config.js
export default {
  id: "brand-a",                          // Must match the :brandId URL param
  name: "Acme Corp",
  monday: {
    boardId: "123456",
    webhookSecret: process.env.MONDAY_SECRET_BRAND_A,
    statusColumn: "blog_status",
  },
  ai: {
    tone: "professional and concise",
    audience: "B2B executives",
    wordCount: 1200,
    systemPrompt: "You are a content writer for Acme Corp...",
  },
  cms: {
    type: "wordpress",                    // "wordpress" | "ghost" | "webflow" etc.
    apiUrl: process.env.WP_URL_BRAND_A,
    apiKey: process.env.WP_KEY_BRAND_A,
  },
  email: {
    fromName: "Acme Insights",
    fromEmail: "newsletter@acme.com",
    listId: process.env.EMAIL_LIST_BRAND_A,
  }
}
```

### Brand Lookup (`brands/index.js`)

```js
import brandA from "./brand-a.config.js";
import brandB from "./brand-b.config.js";

const brands = {
  [brandA.id]: brandA,
  [brandB.id]: brandB,
};

export const getBrandById = (id) => brands[id] ?? null;
```

---

## Environment Variables

All secrets live in `.env`. Never hardcode secrets in config files — always reference `process.env.*`.

```bash
# Monday.com
MONDAY_SECRET_BRAND_A=
MONDAY_SECRET_BRAND_B=

# CMS — Brand A (WordPress)
WP_URL_BRAND_A=
WP_KEY_BRAND_A=

# CMS — Brand B (Ghost)
GHOST_URL_BRAND_B=
GHOST_KEY_BRAND_B=

# Email
EMAIL_LIST_BRAND_A=
EMAIL_LIST_BRAND_B=

# AI
ANTHROPIC_API_KEY=

# Server
PORT=3000
```

---

## Best Practices

### Security
- Always **validate Monday.com webhook signatures** (HMAC-SHA256) before processing any payload
- Store all secrets in environment variables, never in code
- Return `200 OK` to Monday.com immediately if processing is async (prevents retries)

### Code Organisation
- Webhook handlers are **thin** — they only validate, extract data, and delegate to services
- All reusable logic lives in `services/` — never duplicate logic across webhook files
- Brand config is **pure data** — no logic in config files

### Adding a New Brand
1. Create `brands/brand-c.config.js` with the brand's config
2. Register it in `brands/index.js`
3. Add the brand's secrets to `.env` and Render's environment tab
4. No changes needed to webhooks or services

### Adding a New Workflow Type
1. Create `webhooks/new-workflow.webhook.js`
2. Register the route in `index.js` for all relevant brands
3. Add or reuse services as needed

### Render Hosting
- Deploy as a **single Web Service** — all webhooks and cron jobs in one app
- Add a `GET /health` endpoint and ping it every 10 minutes (via [cron-job.org](https://cron-job.org)) to prevent cold starts on free tier
- Define the service in `render.yaml` so deployments are reproducible
- Set all environment variables in Render's dashboard under **Environment**

---

## Cron Jobs

Scheduled tasks are registered in `index.js` using `node-cron` alongside the Express server:

```js
import cron from "node-cron";
import { runWeeklyDigest } from "./jobs/weekly-digest.job.js";

// Runs every Monday at 8am
cron.schedule("0 8 * * 1", runWeeklyDigest);
```

Each job file exports a single async function. Jobs can also accept a brand config if they are brand-specific.

---

## Health Endpoint

Always include this in `index.js`:

```js
app.get("/health", (req, res) => res.json({ status: "ok" }));
```
