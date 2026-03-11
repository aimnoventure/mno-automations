# Workflow Plan: Generate Blog Content (Achora)
> Migrated from n8n — "Webhook - When Status change to Generate Content"

---

## Overview

When a Monday.com board item's status is changed to **"Generate Content"**, this workflow:

1. Receives the webhook from Monday.com and immediately responds with a challenge (to satisfy Monday's webhook handshake)
2. Extracts the board item details from the webhook payload
3. Fetches the full Monday.com board item to get column values (title + selected AI model)
4. Builds a user prompt from the item name
5. Routes to the correct AI model based on the Monday column value (OpenAI, Gemini, or Claude)
6. Each AI model uses RAG — querying a Supabase vector store (`website_chunks`) and a Postgres document metadata table — to generate the blog post
7. Parses and cleans the JSON output from the AI agent
8. Creates a **private** WordPress post with the generated content
9. Updates the Monday.com board item with the generated content, SEO title, WordPress post ID, private link, token usage, and sets the status to **"Content Generated"**

---

## Full Flow Diagram

```
Monday.com (status → "Generate Content")
        │
        ▼
POST /webhooks/achora/generate-content
        │
        ├─→ [1] Respond 200 with challenge immediately
        │
        ▼
[2] Extract from payload:
    - pulseName (blog title, or fallback)
    - boardId
    - pulseId
        │
        ▼
[3] Monday API → Get Board Item by pulseId
    - column_values[0].text → AI model selector ("OpenAI" | "Gemini" | "Claude")
        │
        ▼
[4] Build user prompt:
    "Write a blog post about:\nTitle: {pulseName}"
        │
        ▼
[5] Switch on AI model
    ├── "OpenAI"  → [6a] OpenAI agent   → [7a] GPT-4o-mini JSON cleaner → [8] Parse JSON
    ├── "Gemini"  → [6b] Gemini agent   → [7b] GPT-4o-mini JSON cleaner → [8] Parse JSON
    └── "Claude"  → [6c] Anthropic agent → (raw JSON output)            → [8] Parse JSON

    Each agent uses:
    - Supabase Vector Store (table: website_chunks, fn: match_website_chunks)
    - Postgres tool (table: document_metadata) for listing available documents
    - OpenAI Embeddings (for vector search)
        │
        ▼
[8] Parse JSON response into structured object:
    { title, seoTitle, slug, metaDescription, content, keywords, token_used }
        │
        ▼
[9] WordPress API → Create Post (status: "private")
    - title: output.title
    - content: output.content
    - slug: output.slug
        │
        ▼
[10] Monday API → Update Board Item Columns
    - status            → "Content Generated"
    - text_mky267gq     → WordPress private post link (guid.rendered)
    - text_mky0aydz     → Generated HTML content
    - text_mky1jkt6     → SEO title
    - numeric_mky2q9e8  → WordPress post ID
    - numeric_mky1snpf  → Token count used
```

---

## File Location (in project structure)

```
src/
└── webhooks/
    └── generate-content.webhook.js   ← this workflow lives here
```

Registered in `index.js` as:
```js
app.post("/webhooks/:brandId/generate-content", handleGenerateContentWebhook);
```

---

## Step-by-Step Implementation Plan

### Step 1 — Receive Webhook & Respond to Monday Challenge

Monday.com sends a challenge on first registration and expects it echoed back immediately. The response must happen **before** any async processing.

```
- Method: POST
- Path: /webhooks/:brandId/generate-content
- Immediately respond: { "challenge": req.body.challenge }
- Then continue processing asynchronously (do not await the full pipeline before responding)
```

> ⚠️ Important: The full pipeline (AI generation, WordPress, Monday update) takes 30–60+ seconds. Monday will retry if it doesn't get a quick 200 response. Always respond first, then run the pipeline in the background.

---

### Step 2 — Extract Payload Data

From `req.body.event`, extract:

| Variable | Source | Fallback |
|---|---|---|
| `pulseName` | `req.body.event.pulseName` | `"Generate blog post title based on current NDIS news"` |
| `boardId` | `req.body.event.boardId` | — |
| `pulseId` | `req.body.event.pulseId` | — |

---

### Step 3 — Fetch Full Monday.com Board Item

Call Monday.com API to get the full item by `pulseId`. This is needed because the webhook payload does not include all column values.

**Data needed from this call:**
- `column_values[0].text` → AI model selector (e.g., `"OpenAI"`, `"Gemini"`, `"Claude"`)

**Monday GraphQL Query:**
```graphql
query {
  items(ids: [PULSE_ID]) {
    id
    name
    column_values {
      id
      text
      value
    }
  }
}
```

**Service to use:** `services/monday.service.js` → `getItemById(pulseId)`

---

### Step 4 — Build User Prompt

```js
const chatInput = `Write a blog post about:\nTitle: ${pulseName}`;
const model = columnValues[0].text; // "OpenAI" | "Gemini" | "Claude"
```

---

### Step 5 — Route to AI Model (Switch)

Based on the `model` value (case-insensitive), call the appropriate AI service function.

| Model value | AI Provider | Notes |
|---|---|---|
| `"OpenAI"` | OpenAI (`gpt-4o` or similar) | Output goes through a JSON cleaning step with `gpt-4o-mini` |
| `"Gemini"` | Google Gemini | Output goes through a JSON cleaning step with `gpt-4o-mini` |
| `"Claude"` | Anthropic (`claude-sonnet-4-5`) | Outputs raw JSON directly — no cleaning step needed |
| fallback | OpenAI | Default if value is unrecognised |

**Service to use:** `services/ai.service.js` → `generateBlogContent(chatInput, model, brand)`

---

### Step 6 — AI Agent: RAG Content Generation

Each AI call uses the same system prompt (Achora brand voice) and has access to two tools:

**Tool 1: Supabase Vector Store (RAG)**
- Table: `website_chunks`
- Function: `match_website_chunks`
- Purpose: Retrieve relevant Achora website content for grounding
- Embedding model: OpenAI embeddings

**Tool 2: Postgres Document Metadata**
- Table: `document_metadata`
- Purpose: List available documents/data sources the agent can reference
- Query: `SELECT * FROM document_metadata`

**System Prompt:** The full Achora brand prompt is stored in `brands/achora.config.js` under `ai.systemPrompt`. It defines brand voice, SEO rules, HTML output format, and the required JSON output schema.

---

### Step 7 — JSON Cleaning (OpenAI + Gemini only)

Gemini and OpenAI agents sometimes wrap their output in markdown code fences. A secondary `gpt-4o-mini` call strips this and returns clean JSON:

```
Prompt: "Read the output below and return a clean json. Do not wrap the response 
in ```json or any markdown code block. Output raw JSON only.\n\nOutput:\n\n{raw_output}"
```

Claude outputs clean JSON directly — skip this step for Claude.

**This logic lives inside `services/ai.service.js`.**

---

### Step 8 — Parse AI JSON Response

Parse the cleaned string into a JS object. Expected shape:

```js
{
  title: "...",
  seoTitle: "...",
  slug: "...",
  metaDescription: "...",
  content: "<p>HTML blog content...</p>",
  keywords: {
    primary: "...",
    secondary: ["...", "..."]
  },
  token_used: 1234
}
```

> Wrap in try/catch. If JSON.parse fails, log the error and update Monday status to an error state.

---

### Step 9 — Create WordPress Post (Private Draft)

Call WordPress REST API to create a new post in **private** status.

**Endpoint:** `POST {WP_URL}/wp-json/wp/v2/posts`

**Payload:**
```js
{
  title: parsedOutput.title,
  content: parsedOutput.content,
  slug: parsedOutput.slug,
  status: "private"
}
```

**Response fields needed:**
- `id` → WordPress post numeric ID
- `guid.rendered` → Private post URL/link

**Service to use:** `services/cms.service.js` → `createPrivatePost(content, brand.cms)`

---

### Step 10 — Update Monday.com Board Item

Update the board item with all generated data.

**Monday.com Board ID:** `5025223094` (stored in `brands/achora.config.js`)

**Column updates:**

| Column ID | Value | Description |
|---|---|---|
| `status` | `"Content Generated"` | Status label |
| `text_mky267gq` | `wp_response.guid.rendered` | WordPress private post link |
| `text_mky0aydz` | `parsedOutput.content` | Full HTML content |
| `text_mky1jkt6` | `parsedOutput.seoTitle` | SEO title |
| `numeric_mky2q9e8` | `wp_response.id` | WordPress post ID (numeric) |
| `numeric_mky1snpf` | `parsedOutput.token_used` | Token count (numeric) |

**Service to use:** `services/monday.service.js` → `updateItemColumns(boardId, itemId, columnValues)`

---

## Required Credentials

All stored in `.env` and referenced via `brands/achora.config.js`.

### Monday.com
| Variable | Description |
|---|---|
| `MONDAY_API_KEY_ACHORA` | Monday.com API token (v2 API) |
| `MONDAY_WEBHOOK_SECRET_ACHORA` | HMAC secret for validating incoming webhooks |
| `MONDAY_BOARD_ID_ACHORA` | `5025223094` |

### WordPress
| Variable | Description |
|---|---|
| `WP_URL_ACHORA` | WordPress site URL (e.g., `https://achora.com.au`) |
| `WP_USERNAME_ACHORA` | WordPress application username |
| `WP_APP_PASSWORD_ACHORA` | WordPress application password (not login password) |

> WordPress REST API uses HTTP Basic Auth with application passwords. Generate one under Users → Profile → Application Passwords in WP Admin.

### AI Providers
| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Used for OpenAI agent + JSON cleaning + embeddings |
| `GOOGLE_GEMINI_API_KEY` | Used for Gemini agent |
| `ANTHROPIC_API_KEY` | Used for Claude agent |

### Supabase (RAG / Vector Store)
| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (not anon key — needs DB access) |

### PostgreSQL (Document Metadata)
| Variable | Description |
|---|---|
| `POSTGRES_CONNECTION_STRING` | Full Postgres connection string |

> Or use individual vars: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

---

## npm Packages Needed

```json
{
  "express": "^4.x",
  "axios": "^1.x",
  "openai": "^4.x",
  "@anthropic-ai/sdk": "^0.x",
  "@google/generative-ai": "^0.x",
  "@supabase/supabase-js": "^2.x",
  "pg": "^8.x",
  "dotenv": "^16.x"
}
```

---

## Brand Config (`brands/achora.config.js`)

```js
export default {
  id: "achora",
  name: "Achora",
  monday: {
    apiKey: process.env.MONDAY_API_KEY_ACHORA,
    webhookSecret: process.env.MONDAY_WEBHOOK_SECRET_ACHORA,
    boardId: process.env.MONDAY_BOARD_ID_ACHORA, // "5025223094"
    columns: {
      aiModelSelector: 0,        // column_values index
      status: "status",
      privateLink: "text_mky267gq",
      htmlContent: "text_mky0aydz",
      seoTitle: "text_mky1jkt6",
      wpPostId: "numeric_mky2q9e8",
      tokenUsed: "numeric_mky1snpf",
    },
    statusLabels: {
      contentGenerated: "Content Generated",
    }
  },
  ai: {
    defaultModel: "OpenAI",       // fallback if column value is unrecognised
    systemPrompt: `...`,          // full Achora brand system prompt (paste from n8n)
  },
  cms: {
    type: "wordpress",
    url: process.env.WP_URL_ACHORA,
    username: process.env.WP_USERNAME_ACHORA,
    appPassword: process.env.WP_APP_PASSWORD_ACHORA,
  },
  rag: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    vectorTable: "website_chunks",
    matchFunction: "match_website_chunks",
    metadataTable: "document_metadata",
  },
  db: {
    connectionString: process.env.POSTGRES_CONNECTION_STRING,
  }
}
```

---

## Error Handling Notes

- If Monday webhook challenge arrives (`req.body.challenge` is present), respond with `{ challenge }` and exit — do not process further
- If AI JSON parse fails, log the raw output and update Monday status to an error label (e.g., `"Generation Failed"`)
- If WordPress post creation fails, log the error and update Monday status to an error label
- If Monday update fails, log the error but do not throw — the content has already been generated
- All external API calls should have a timeout set (suggest 120s for AI calls, 30s for Monday/WordPress)

---

## `.env.example` additions for this workflow

```bash
# Monday.com — Achora
MONDAY_API_KEY_ACHORA=
MONDAY_WEBHOOK_SECRET_ACHORA=
MONDAY_BOARD_ID_ACHORA=5025223094

# WordPress — Achora
WP_URL_ACHORA=
WP_USERNAME_ACHORA=
WP_APP_PASSWORD_ACHORA=

# AI Providers
OPENAI_API_KEY=
GOOGLE_GEMINI_API_KEY=
ANTHROPIC_API_KEY=

# Supabase (RAG)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# PostgreSQL
POSTGRES_CONNECTION_STRING=
```
