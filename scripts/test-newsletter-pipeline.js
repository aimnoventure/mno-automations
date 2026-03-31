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
 *   Writes the full Campaign Monitor payload to output/newsletter-test-{timestamp}.txt
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { getBrandById } from "../src/brands/index.js";
import { generateNewsletterContent, scrapeBlogArticles } from "../src/services/ai.service.js";
import { buildCampaignPayload } from "../src/webhooks/generate-newsletter.webhook.js";
import { buildFormattedTemplate } from "../src/utils/format-newsletter-template.js";

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
  { text: "" },                     // 4: Output (written by pipeline, not read)
  { text: "Your NDIS Plan Review: What You Need to Know" },  // 5: Email Subject
  { text: "Achora" },               // 6: From Name
  { text: "admin@achora.com.au" },  // 7: From Email
  { text: "" },                     // 8: Banner Link (blank → uses default image)
  { text: "" },                     // 9: Feature Card Image 1
  { text: "" },                     // 10: Feature Card Image 2
  { text: "" },                     // 11: Feature Card Image 3
  { text: "" },                     // 12: Featured Video Thumbnail
  { text: "" },                     // 13: Logo
  { text: "" },                     // 14: Token Used
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

// Stage 1: AI newsletter content generation
console.log("[test] Stage 1 — Generating newsletter content via AI...");
let newsletterContent;
try {
  newsletterContent = await generateNewsletterContent(userPrompt, brand);
  console.log("[test] Stage 1 complete.");
  console.log();
  console.log("── Newsletter content summary ────────────────────────────");
  console.log(`  Hero tagline     : ${newsletterContent.hero_tagline}`);
  console.log(`  Greeting         : ${newsletterContent.greeting}`);
  console.log(`  Seasonal message : ${newsletterContent.seasonal_message}`);
  console.log(`  Section 1        : ${newsletterContent.section1?.heading}`);
  console.log(`  Section 2        : ${newsletterContent.section2?.heading}`);
  console.log(`  Section 3        : ${newsletterContent.section3?.heading}`);
  console.log("─────────────────────────────────────────────────────────");
  console.log();
} catch (err) {
  console.error("[test] Stage 1 FAILED:", err.message);
  process.exit(1);
}

// Stage 2: Scrape real blog articles from Achora website
console.log("[test] Stage 2 — Scraping blog articles from Achora website...");
let blogData;
try {
  blogData = await scrapeBlogArticles(brand.newsletter.blogUrl);
  console.log("[test] Stage 2 complete.");
  console.log();
  console.log("── Scraped blog articles ─────────────────────────────────");
  (blogData.blog_articles || []).forEach((a, i) => {
    console.log(`  [${i + 1}] ${a.title}`);
    console.log(`      ${a.url}`);
  });
  console.log("─────────────────────────────────────────────────────────");
  console.log();
} catch (err) {
  console.error("[test] Stage 2 FAILED:", err.message);
  process.exit(1);
}

// Stage 3: Merge outputs
const combined = { ...newsletterContent, ...blogData };

// Stage 4: Build Campaign Monitor payload
console.log("[test] Stage 3 — Building Campaign Monitor payload...");
const payload = buildCampaignPayload(combined, DUMMY_COLUMN_VALUES, TEST_ITEM_NAME, brand);
console.log("[test] Stage 3 complete.");
console.log();

// Stage 5: Write template to file
const outputDir        = path.resolve("output");
const templateFilename = path.join(outputDir, `newsletter-template-${Date.now()}.txt`);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(templateFilename, buildFormattedTemplate(payload), "utf8");

console.log("── Output ────────────────────────────────────────────────");
console.log(`  Template written to : ${templateFilename}`);
console.log("─────────────────────────────────────────────────────────");
console.log();
console.log("[test] Done.");
