import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;

// ── RAG helpers ────────────────────────────────────────────────────────────────

/**
 * Retrieves relevant RAG context chunks from Supabase by embedding the query
 * with OpenAI and calling the match_website_chunks vector search function.
 *
 * @param {string} chatInput - The user prompt / blog title to embed
 * @param {Object} ragConfig - RAG configuration from the brand config (brand.rag)
 * @returns {Promise<string[]>} Array of relevant text chunks from the vector store
 */
async function getRagContext(chatInput, ragConfig) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: chatInput,
  });

  const embedding = embeddingResponse.data[0].embedding;

  const supabase = createClient(ragConfig.supabaseUrl, ragConfig.supabaseKey);

  const { data, error } = await supabase.rpc(ragConfig.matchFunction, {
    query_embedding: embedding,
    match_count: 5,
  });

  if (error) {
    throw new Error(`Supabase RAG error: ${error.message}`);
  }

  return (data || []).map((row) => row.content);
}

/**
 * Fetches all rows from the document_metadata table in Postgres.
 * Provides the AI with a list of available reference documents.
 *
 * A new Pool is created per call to avoid holding an idle connection open
 * on Render's free tier where the DB may be paused between requests.
 *
 * @param {Object} dbConfig - Database configuration from the brand config (brand.db)
 * @returns {Promise<Object[]>} Array of document metadata rows
 */
async function getDocumentMetadata(dbConfig) {
  const pool = new Pool({ connectionString: dbConfig.connectionString });
  try {
    const result = await pool.query("SELECT * FROM document_metadata");
    return result.rows;
  } finally {
    await pool.end();
  }
}

/**
 * Builds the combined user message that includes RAG context, document metadata,
 * and the original user prompt. Used identically across all three AI providers.
 *
 * @param {string[]} ragContext - Array of relevant text chunks
 * @param {Object[]} docMetadata - Rows from document_metadata table
 * @param {string} userPrompt - The original user prompt (blog title instruction)
 * @returns {string} The complete user message to send to the AI
 */
function buildUserMessage(ragContext, docMetadata, userPrompt) {
  return `Relevant context from the Achora website:
---
${ragContext.join("\n---\n")}

Available reference documents:
${JSON.stringify(docMetadata, null, 2)}

---

${userPrompt}`;
}

// ── AI provider callers ────────────────────────────────────────────────────────

/**
 * Calls OpenAI gpt-4o to generate the blog post.
 *
 * @param {string} systemPrompt - Achora brand system prompt
 * @param {string} userPrompt - Blog title instruction
 * @param {string[]} ragContext - RAG text chunks
 * @param {Object[]} docMetadata - Document metadata rows
 * @returns {Promise<string>} Raw text response from OpenAI (may contain markdown fences)
 */
async function callOpenAI(systemPrompt, userPrompt, ragContext, docMetadata) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: buildUserMessage(ragContext, docMetadata, userPrompt) },
    ],
  });

  return response.choices[0].message.content;
}

/**
 * Calls Google Gemini 1.5 Pro to generate the blog post.
 *
 * @param {string} systemPrompt - Achora brand system prompt (passed as systemInstruction)
 * @param {string} userPrompt - Blog title instruction
 * @param {string[]} ragContext - RAG text chunks
 * @param {Object[]} docMetadata - Document metadata rows
 * @returns {Promise<string>} Raw text response from Gemini (may contain markdown fences)
 */
async function callGemini(systemPrompt, userPrompt, ragContext, docMetadata) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent(
    buildUserMessage(ragContext, docMetadata, userPrompt)
  );

  return result.response.text();
}

/**
 * Calls Anthropic Claude (claude-sonnet-4-5) to generate the blog post.
 * Claude is instructed to return raw JSON directly — no markdown fences.
 *
 * @param {string} systemPrompt - Achora brand system prompt
 * @param {string} userPrompt - Blog title instruction
 * @param {string[]} ragContext - RAG text chunks
 * @param {Object[]} docMetadata - Document metadata rows
 * @returns {Promise<string>} Raw JSON string response from Claude
 */
async function callClaude(systemPrompt, userPrompt, ragContext, docMetadata) {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from environment automatically

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      { role: "user", content: buildUserMessage(ragContext, docMetadata, userPrompt) },
    ],
  });

  return response.content[0].text;
}

// ── JSON cleaning & parsing ────────────────────────────────────────────────────

/**
 * Passes raw AI output through GPT-4o-mini to strip any markdown code fences
 * and return clean JSON. Used for OpenAI and Gemini outputs.
 *
 * @param {string} rawOutput - The raw string returned by the AI provider
 * @returns {Promise<string>} Clean JSON string with no markdown wrapping
 */
async function cleanJsonWithGpt(rawOutput) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Read the output below and return a clean json. Do not wrap the response in \`\`\`json or any markdown code block. Output raw JSON only.\n\nOutput:\n\n${rawOutput}`,
      },
    ],
  });

  return response.choices[0].message.content;
}

/**
 * Parses the cleaned AI output string into a structured JavaScript object.
 *
 * Expected shape:
 * {
 *   title: string,
 *   seoTitle: string,
 *   slug: string,
 *   metaDescription: string,
 *   content: string,           // HTML blog content
 *   keywords: { primary: string, secondary: string[] },
 *   token_used: number
 * }
 *
 * @param {string} rawString - The clean JSON string to parse
 * @returns {Object} Parsed blog content object
 * @throws {Error} If JSON.parse fails — includes the first 200 chars of rawString for debugging
 */
function parseAiResponse(rawString) {
  try {
    return JSON.parse(rawString.trim());
  } catch (err) {
    throw new Error(
      `Failed to parse AI JSON response: ${err.message}\n` +
        `Raw output (first 200 chars): ${rawString.slice(0, 200)}`
    );
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full AI content generation pipeline:
 * 1. Retrieve RAG context from Supabase vector store
 * 2. Fetch document metadata from Postgres
 * 3. Route to the appropriate AI provider based on the model selector
 * 4. Optionally clean JSON output (OpenAI and Gemini only)
 * 5. Parse and return the structured blog content object
 *
 * @param {string} chatInput - The user prompt, e.g. "Write a blog post about:\nTitle: ..."
 * @param {string} model - AI model selector from Monday column (e.g. "OpenAI", "Gemini", "Claude")
 * @param {Object} brand - The full brand config object from brands/index.js
 * @returns {Promise<Object>} Parsed blog content: { title, seoTitle, slug, metaDescription, content, keywords, token_used }
 * @throws {Error} If RAG retrieval, AI generation, or JSON parsing fails
 */
export async function generateBlogContent(chatInput, model, brand) {
  const [ragContext, docMetadata] = await Promise.all([
    getRagContext(chatInput, brand.rag),
    getDocumentMetadata(brand.db),
  ]);

  const { systemPrompt, defaultModel } = brand.ai;
  const normalizedModel = (model || defaultModel).toLowerCase();

  let rawOutput;

  if (normalizedModel.includes("gemini")) {
    rawOutput = await callGemini(systemPrompt, chatInput, ragContext, docMetadata);
    rawOutput = await cleanJsonWithGpt(rawOutput);
  } else if (normalizedModel.includes("claude")) {
    rawOutput = await callClaude(systemPrompt, chatInput, ragContext, docMetadata);
    // Claude returns clean JSON directly — no cleaning step needed
  } else {
    // Default: OpenAI (also handles unrecognised values)
    rawOutput = await callOpenAI(systemPrompt, chatInput, ragContext, docMetadata);
    rawOutput = await cleanJsonWithGpt(rawOutput);
  }

  return parseAiResponse(rawOutput);
}
