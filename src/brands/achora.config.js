/**
 * Achora brand configuration.
 *
 * Pure data — no logic. All secrets are read from environment variables,
 * which are loaded by `import "dotenv/config"` in src/index.js before
 * this module is evaluated.
 */

export default {
  id: "achora",
  name: "Achora",

  monday: {
    apiKey: process.env.MONDAY_API_KEY_ACHORA,
    webhookSecret: process.env.MONDAY_WEBHOOK_SECRET_ACHORA,
    boardId: process.env.MONDAY_BOARD_ID_ACHORA, // "5025223094"

    columns: {
      aiModelSelector: 0,               // index into the column_values array returned by Monday API
      status: "status",
      privateLink: "text_mky267gq",
      htmlContent: "text_mky0aydz",
      seoTitle: "text_mky1jkt6",
      wpPostId: "numeric_mky2q9e8",
      tokenUsed: "numeric_mky1snpf",
    },

    statusLabels: {
      contentGenerated: "Content Generated",
      generationFailed: "Generation Failed",
    },
  },

  ai: {
    defaultModel: "OpenAI", // fallback when Monday column value is blank or unrecognised
    systemPrompt: `[ACHORA SYSTEM PROMPT PLACEHOLDER — Replace with the actual brand prompt from n8n]`,
  },

  cms: {
    type: "wordpress",
    url: process.env.WP_URL_ACHORA,           // e.g. https://achora.com.au (no trailing slash)
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
  },
};
