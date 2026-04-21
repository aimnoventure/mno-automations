import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
// import pg from "pg";
// const { Pool } = pg;

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
 * Retrieves all rows from the document_metadata table using the Supabase client.
 * Logs a success or failure message so you can confirm connectivity.
 *
 * @param {Object} ragConfig - RAG configuration from the brand config (brand.rag)
 * @returns {Promise<Object[]>} Array of document metadata rows
 */
async function getDocumentMetadata(ragConfig) {
  const supabase = createClient(ragConfig.supabaseUrl, ragConfig.supabaseKey);

  const { data, error } = await supabase
    .from(ragConfig.metadataTable)
    .select("*");

  if (error) {
    console.error("[getDocumentMetadata] Connection failed:", error.message);
    throw new Error(`Supabase metadata error: ${error.message}`);
  }

  console.log(`[getDocumentMetadata] Connected successfully — ${data.length} row(s) retrieved from "${ragConfig.metadataTable}"`);
  return data;
}

/**
 * Builds the combined user message that includes RAG context and the original
 * user prompt. Used identically across all three AI providers.
 *
 * @param {string[]} ragContext - Array of relevant text chunks
 * @param {string} userPrompt - The original user prompt (blog title instruction)
 * @returns {string} The complete user message to send to the AI
 */
function buildUserMessage(ragContext, docMetadata, userPrompt) {
  const metaBlock = docMetadata.length
    ? `Document metadata:\n${JSON.stringify(docMetadata, null, 2)}`
    : "";

  return `Relevant context from the website:
---
${ragContext.join("\n---\n")}

---
${metaBlock ? `\n${metaBlock}\n\n---\n\n` : "\n"}${userPrompt}`;
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
    model: "gemini-2.0-flash-lite",
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

// ── JSON fence stripping ───────────────────────────────────────────────────────

/**
 * Removes markdown code fences from an AI response string and extracts the
 * outermost JSON object. Safe to call on already-clean strings.
 *
 * Steps:
 *   1. Trim whitespace
 *   2. Strip leading ```json or ``` fence
 *   3. Strip trailing ``` fence
 *   4. Slice from first { to last } to discard any remaining preamble/postamble
 *
 * @param {string} str - Raw AI output, possibly wrapped in markdown fences
 * @returns {string} Cleaned string that starts with { and ends with }
 */
function stripMarkdownFences(str) {
  let s = str.trim();
  s = s.replace(/^```(?:json)?\s*/i, "");
  s = s.replace(/\s*```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start !== -1 && end !== -1 ? s.slice(start, end + 1) : s.trim();
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
    // Strip leading ```json or ``` fence and trailing ``` fence
    let s = rawString.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    // Then slice from first { to last } to drop any remaining preamble
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    const cleaned = start !== -1 && end !== -1 ? s.slice(start, end + 1) : s;
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse AI JSON response: ${err.message}\n` +
        `Raw output (first 200 chars): ${rawString.slice(0, 200)}`
    );
  }
}

// ── Website metadata helper (for title generation) ────────────────────────────

/**
 * Retrieves all rows from the website_metadata table using the Supabase client.
 * Used by the title generation pipeline to check for existing blog titles
 * and prevent duplication.
 *
 * @param {Object} ragConfig - RAG configuration from the brand config (brand.rag)
 * @returns {Promise<Object[]>} Array of website metadata rows
 */
async function getWebsiteMetadata(ragConfig) {
  const supabase = createClient(ragConfig.supabaseUrl, ragConfig.supabaseKey);

  const columns = ragConfig.websiteMetadataColumns || "*";
  const { data, error } = await supabase
    .from(ragConfig.websiteMetadataTable)
    .select(columns);

  if (error) {
    console.error("[getWebsiteMetadata] Query failed:", error.message);
    throw new Error(`Supabase website_metadata error: ${error.message}`);
  }

  console.log(`[getWebsiteMetadata] Retrieved ${data.length} row(s) from "${ragConfig.websiteMetadataTable}"`);
  return data;
}

// ── Main exports ────────────────────────────────────────────────────────────────

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
/**
 * Orchestrates the blog title generation pipeline:
 * 1. Fetch existing titles from Supabase website_metadata table
 * 2. Call OpenAI gpt-4o with the brand's title strategist system prompt
 * 3. Clean and parse the JSON response
 *
 * @param {string} chatInput - The user prompt, e.g. "Generate 5 blog titles about: ..."
 * @param {Object} brand - The full brand config object from brands/index.js
 * @returns {Promise<Object>} Parsed titles object: { blog_titles: string[], metadata_check: {...} }
 * @throws {Error} If Supabase query, AI generation, or JSON parsing fails
 */
export async function generateBlogTitles(chatInput, brand, motionTask = null) {
  const websiteMetadata = await getWebsiteMetadata(brand.rag);

  const { systemPrompt } = brand.titleGeneration;

  let fullInput = chatInput;
  if (motionTask) {
    fullInput +=
      `\n\n[MOTION NEWS SOURCE]\nHeading: ${motionTask.name}\n${motionTask.description}\nPublished: ${motionTask.createdTime}`;
  }

  // No RAG vector chunks needed — pass empty array; website_metadata fills the context slot
  let rawOutput = await callOpenAI(systemPrompt, fullInput, [], websiteMetadata);
  rawOutput = await cleanJsonWithGpt(rawOutput);

  return parseAiResponse(rawOutput);
}

/**
 * Generates newsletter content for Achora using the newsletter system prompt and RAG context.
 *
 * Returns a parsed JSON object with all newsletter sections. The blog_articles field
 * in the returned object should be treated as a placeholder — it will be overridden
 * by the real articles scraped from the Achora blog in the webhook pipeline.
 *
 * @param {string} userPrompt - Built prompt containing topic, email direction, month, year
 * @param {Object} brand - Full brand config (uses brand.newsletter.ai.systemPrompt and brand.rag)
 * @returns {Promise<Object>} Parsed newsletter content: { hero_tagline, greeting, seasonal_message,
 *   intro_paragraph, section1, section2, section3, participant_insight, blog_articles }
 */
export async function generateNewsletterContent(userPrompt, brand) {
  const ragContext = await getRagContext(userPrompt, brand.rag);
  const { systemPrompt } = brand.newsletter.ai;

  let rawOutput = await callOpenAI(systemPrompt, userPrompt, ragContext, []);
  rawOutput = await cleanJsonWithGpt(rawOutput);
  return parseAiResponse(rawOutput);
}

/**
 * Generates newsletter content using all three AI models in parallel,
 * sharing a single RAG context fetch across all three calls.
 *
 * @param {string} userPrompt - Built prompt containing topic, email direction, month, year
 * @param {Object} brand - Full brand config
 * @returns {Promise<{ openai: Object, claude: Object, gemini: Object }>}
 *   Each value is the parsed newsletter content object, or null if that model failed.
 */
export async function generateAllNewsletterVersions(userPrompt, brand) {
  const ragContext = await getRagContext(userPrompt, brand.rag);
  const { systemPrompt } = brand.newsletter.ai;

  async function withOpenAI() {
    let raw = await callOpenAI(systemPrompt, userPrompt, ragContext, []);
    raw = await cleanJsonWithGpt(raw);
    return parseAiResponse(raw);
  }

  async function withClaude() {
    const raw = await callClaude(systemPrompt, userPrompt, ragContext, []);
    return parseAiResponse(raw);
  }

  async function withGemini() {
    let raw = await callGemini(systemPrompt, userPrompt, ragContext, []);
    raw = await cleanJsonWithGpt(raw);
    return parseAiResponse(raw);
  }

  const [openaiResult, claudeResult, geminiResult] = await Promise.allSettled([
    withOpenAI(),
    withClaude(),
    withGemini(),
  ]);

  const extract = (result, label) => {
    if (result.status === "fulfilled") return result.value;
    console.error(`[newsletter] ${label} generation failed:`, result.reason?.message);
    return null;
  };

  return {
    openai: extract(openaiResult, "OpenAI"),
    claude: extract(claudeResult, "Claude"),
    gemini: extract(geminiResult, "Gemini"),
  };
}

/**
 * Fetches the Achora blog page, strips HTML tags to plain text, then calls
 * OpenAI to extract the 2 most recent blog articles (title, description, url).
 *
 * Does NOT use RAG — the scraped HTML provides all the context needed.
 *
 * @param {string} blogUrl - URL of the blog listing page (e.g. https://www.achora.com.au/blog/)
 * @returns {Promise<Object>} { blog_articles: [{ title, description, url }, { title, description, url }] }
 */
export async function scrapeBlogArticles(blogUrl) {
  const htmlResponse = await axios.get(blogUrl, { timeout: 15_000 });

  // Strip HTML tags and collapse whitespace, then take only the first 15,000 characters.
  // Blog listings show the most recent articles near the top, so truncating is safe
  // and keeps the prompt well within token limits for gpt-4o-mini.
  const text = htmlResponse.data
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15_000);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",  // sufficient for simple extraction; much higher TPM limit
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Find the latest 2 blog articles from the page content below. Extract the title, a 2-sentence description, and the full absolute URL for each article.

Page content:
${text}

Return ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "blog_articles": [
    { "title": "", "description": "", "url": "" },
    { "title": "", "description": "", "url": "" }
  ]
}`,
      },
    ],
  });

  let rawOutput = response.choices[0].message.content;
  rawOutput = await cleanJsonWithGpt(rawOutput);
  return parseAiResponse(rawOutput);
}

export async function generateBlogContent(chatInput, model, brand) {
  const [ragContext, docMetadata] = await Promise.all([
    getRagContext(chatInput, brand.rag),
    getDocumentMetadata(brand.rag),
  ]);

  const { systemPrompt, defaultModel } = brand.ai;
  const normalizedModel = (model || defaultModel).toLowerCase();

  let rawOutput;

  if (normalizedModel.includes("gemini")) {
    rawOutput = await callGemini(systemPrompt, chatInput, ragContext, docMetadata);
    rawOutput = stripMarkdownFences(rawOutput);
    rawOutput = await cleanJsonWithGpt(rawOutput);
  } else if (normalizedModel.includes("claude")) {
    rawOutput = await callClaude(systemPrompt, chatInput, ragContext, docMetadata);
    rawOutput = stripMarkdownFences(rawOutput);
    rawOutput = await cleanJsonWithGpt(rawOutput);
  } else {
    // Default: OpenAI (also handles unrecognised values)
    rawOutput = await callOpenAI(systemPrompt, chatInput, ragContext, docMetadata);
    rawOutput = stripMarkdownFences(rawOutput);
    rawOutput = await cleanJsonWithGpt(rawOutput);
  }

  return parseAiResponse(rawOutput);
}
