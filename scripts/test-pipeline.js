/**
 * Test script — runs the content generation pipeline with dummy data.
 * No Monday.com webhook or item fetch required.
 *
 * Usage:
 *   node scripts/test-pipeline.js [brandId] [model] [--no-wp]
 *
 * Arguments (all optional, defaults shown):
 *   brandId  — "achora" | "maple"          (default: "achora")
 *   model    — "OpenAI" | "Gemini" | "Claude"  (default: brand's defaultModel)
 *   --no-wp  — skip WordPress post creation and print content to console instead
 *
 * Examples:
 *   node scripts/test-pipeline.js
 *   node scripts/test-pipeline.js maple
 *   node scripts/test-pipeline.js maple Claude
 *   node scripts/test-pipeline.js achora OpenAI --no-wp
 */

import "dotenv/config";
import { getBrandById } from "../src/brands/index.js";
import { generateBlogContent } from "../src/services/ai.service.js";
import { createPrivatePost } from "../src/services/cms.service.js";

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const noWp = args.includes("--no-wp");
const positional = args.filter((a) => !a.startsWith("--"));

const brandId = positional[0] || "achora";
const modelOverride = positional[1] || null;

// ── Dummy test data ────────────────────────────────────────────────────────────

const TEST_TITLE = "How to Make the Most of Your NDIS Plan in 2025";

// ── Run ────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("  MNO Automations — Pipeline Test");
console.log("=".repeat(60));
console.log(`  Brand   : ${brandId}`);
console.log(`  Title   : ${TEST_TITLE}`);
console.log(`  WP post : ${noWp ? "skipped (--no-wp)" : "enabled"}`);
console.log("=".repeat(60));
console.log();

const brand = getBrandById(brandId);
if (!brand) {
  console.error(`[test] Unknown brandId "${brandId}". Available: achora, maple`);
  process.exit(1);
}

const model = modelOverride || brand.ai.defaultModel;
console.log(`[test] Using model: "${model}"`);
console.log();

const chatInput = `Write a blog post about:\nTitle: ${TEST_TITLE}`;

// Stage 1: AI content generation (includes RAG + metadata fetch)
console.log("[test] Stage 1 — Generating blog content...");
let parsedOutput;
try {
  parsedOutput = await generateBlogContent(chatInput, model, brand);
  console.log("[test] Stage 1 complete.");
  console.log();
  console.log("── Generated output ─────────────────────────────────────");
  console.log(`  Title       : ${parsedOutput.title}`);
  console.log(`  SEO Title   : ${parsedOutput.seoTitle}`);
  console.log(`  Slug        : ${parsedOutput.slug}`);
  console.log(`  Meta desc   : ${parsedOutput.metaDescription}`);
  console.log(`  Primary KW  : ${parsedOutput.keywords?.primary}`);
  console.log(`  Secondary   : ${(parsedOutput.keywords?.secondary || []).join(", ")}`);
  console.log(`  Token used  : ${parsedOutput.token_used}`);
  console.log(`  Content len : ${parsedOutput.content?.length ?? 0} chars`);
  console.log("─────────────────────────────────────────────────────────");
  console.log();
} catch (err) {
  console.error("[test] Stage 1 FAILED:", err.message);
  process.exit(1);
}

// Stage 2: WordPress post (skippable)
if (noWp) {
  console.log("[test] Stage 2 — WordPress skipped (--no-wp flag set).");
  console.log();
  console.log("── Content HTML preview (first 500 chars) ───────────────");
  console.log(parsedOutput.content?.slice(0, 500));
  console.log("─────────────────────────────────────────────────────────");
} else {
  console.log("[test] Stage 2 — Creating private WordPress post...");
  try {
    const wpResponse = await createPrivatePost(parsedOutput, brand.cms);
    console.log("[test] Stage 2 complete.");
    console.log();
    console.log("── WordPress result ──────────────────────────────────────");
    console.log(`  Post ID  : ${wpResponse.id}`);
    console.log(`  Link     : ${wpResponse.guid?.rendered}`);
    console.log(`  Status   : ${wpResponse.status}`);
    console.log("─────────────────────────────────────────────────────────");
  } catch (err) {
    console.error("[test] Stage 2 FAILED:", err.message);
    process.exit(1);
  }
}

console.log();
console.log("[test] Done.");
