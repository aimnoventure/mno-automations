/**
 * Test script — runs the newsletter generation pipeline with dummy data.
 * No Monday.com webhook or item fetch required.
 *
 * Usage:
 *   node scripts/test-newsletter-pipeline.js [brandId]
 *
 * Arguments (optional):
 *   brandId — "achora"  (default: "achora")
 *
 * Examples:
 *   node scripts/test-newsletter-pipeline.js
 *   node scripts/test-newsletter-pipeline.js achora
 *
 * Output:
 *   Creates three Google Docs (OpenAI, Claude, Gemini versions) and prints their URLs.
 */

import "dotenv/config";
import { getBrandById } from "../src/brands/index.js";
import { generateAllNewsletterVersions, scrapeBlogArticles } from "../src/services/ai.service.js";
import { buildCampaignPayload } from "../src/webhooks/generate-newsletter.webhook.js";
import { buildFormattedTemplate } from "../src/utils/format-newsletter-template.js";
import { createNewsletterDoc } from "../src/services/google-docs.service.js";

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const brandId = process.argv[2] || "achora";

// ── Dummy test data ────────────────────────────────────────────────────────────

const TEST_TOPIC        = "Navigating NDIS Plan Reviews in 2026";
const TEST_DIRECTION    = "Focus on what participants should prepare before their review meeting, common mistakes to avoid, and how Achora can help them get the best outcome.";
const TEST_ITEM_NAME    = "April 2026 Newsletter";

// Simulates the column_values array returned by Monday getItemById for the newsletter board.
// Indices match brand.newsletter.columns (see achora.config.js).
const DUMMY_COLUMN_VALUES = [
  { text: null },                   // 0: Subitems
  { text: TEST_DIRECTION },         // 1: Email Direction/Prompt
  { text: "" },                     // 2: Source (optional)
  { text: "Generate Content" },     // 3: Status
  { text: "" },                     // 4: Output (written by pipeline)
  { text: "" },                     // 5: OpenAI Output (written by pipeline)
  { text: "" },                     // 6: Claude Output (written by pipeline)
  { text: "" },                     // 7: Gemini Output (written by pipeline)
  { text: "Your NDIS Plan Review: What You Need to Know" },  // 8: Email Subject
  { text: "Achora" },               // 9: From Name
  { text: "admin@achora.com.au" },  // 10: From Email
  { text: "" },                     // 11: Banner Link (blank → uses default image)
  { text: "" },                     // 12: Feature Card Image 1
  { text: "" },                     // 13: Feature Card Image 2
  { text: "" },                     // 14: Feature Card Image 3
  { text: "" },                     // 15: Featured Video Thumbnail
  { text: "" },                     // 16: Logo
  { text: "" },                     // 17: Token Used
];

// ── Run ────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("  MNO Automations — Newsletter Pipeline Test");
console.log("=".repeat(60));
console.log(`  Brand   : ${brandId}`);
console.log(`  Topic   : ${TEST_TOPIC}`);
console.log("=".repeat(60));
console.log();

const brand = getBrandById(brandId);
if (!brand) {
  console.error(`[test] Unknown brandId "${brandId}". Available: achora`);
  process.exit(1);
}

const now = new Date();
const month = now.toLocaleString("en-AU", { month: "long" });
const year  = now.getFullYear();

const userPrompt = `Generate newsletter content for Achora's scheduled email.

**Topic:** ${TEST_TOPIC}
**Email direction:** ${TEST_DIRECTION}
**Additional useful sources:**
**Month:** ${month}
**Year:** ${year}`;

// Stage 1: Generate all 3 AI versions + scrape blog articles in parallel
console.log("[test] Stage 1 — Generating all AI versions + scraping blog articles...");
let versions, blogData;
try {
  [versions, blogData] = await Promise.all([
    generateAllNewsletterVersions(userPrompt, brand),
    scrapeBlogArticles(brand.newsletter.blogUrl),
  ]);
  console.log("[test] Stage 1 complete.");
  console.log();
  console.log("── AI Versions ───────────────────────────────────────────");
  for (const [label, content] of [["OpenAI", versions.openai], ["Claude", versions.claude], ["Gemini", versions.gemini]]) {
    if (content) {
      console.log(`  ${label}: ${content.section1?.heading}`);
    } else {
      console.log(`  ${label}: FAILED`);
    }
  }
  console.log("── Scraped blog articles ─────────────────────────────────");
  (blogData.blog_articles || []).forEach((a, i) => {
    console.log(`  [${i + 1}] ${a.title}`);
  });
  console.log("─────────────────────────────────────────────────────────");
  console.log();
} catch (err) {
  console.error("[test] Stage 1 FAILED:", err.message);
  process.exit(1);
}

// Stage 2: Build payloads + formatted templates for each version
console.log("[test] Stage 2 — Building payloads and templates...");

function buildTemplate(content) {
  if (!content) return null;
  const combined = { ...content, ...blogData };
  const payload  = buildCampaignPayload(combined, DUMMY_COLUMN_VALUES, TEST_ITEM_NAME, brand);
  return buildFormattedTemplate(payload);
}

const templates = {
  openai: buildTemplate(versions.openai),
  claude: buildTemplate(versions.claude),
  gemini: buildTemplate(versions.gemini),
};

// Stage 3: Create Google Docs for all 3 versions in parallel
console.log("[test] Stage 3 — Creating Google Docs...");
const docResults = await Promise.allSettled(
  Object.entries(templates).map(async ([label, template]) => {
    if (!template) return [label, null];
    const url = await createNewsletterDoc(
      `${TEST_ITEM_NAME} — ${label.charAt(0).toUpperCase() + label.slice(1)}`,
      template,
      brand.newsletter.googleDocs
    );
    return [label, url];
  })
);

console.log();
console.log("── Output ────────────────────────────────────────────────");
for (const result of docResults) {
  if (result.status === "fulfilled") {
    const [label, url] = result.value;
    console.log(`  ${label.padEnd(8)}: ${url || "FAILED"}`);
  } else {
    console.error(`  FAILED: ${result.reason?.message}`);
  }
}
console.log("─────────────────────────────────────────────────────────");
console.log();
console.log("[test] Done.");
