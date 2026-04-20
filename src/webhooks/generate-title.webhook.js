import { getBrandById } from "../brands/index.js";
import { validateWebhookSignature } from "../utils/validate-webhook.js";
import { getItemById, createBoardItem, updateItemColumns } from "../services/monday.service.js";
import { generateBlogTitles } from "../services/ai.service.js";
import { getLatestMotionTask } from "../services/motion.service.js";

/**
 * Express route handler for POST /webhooks/:brandId/generate-title.
 *
 * Handles the Monday.com "Generate Title" trigger. Responds 200 immediately
 * (before any async work) to satisfy Monday's webhook timeout requirement, then
 * runs the title generation pipeline in the background.
 *
 * Expected Monday webhook payload shape:
 * {
 *   challenge: "abc123",   // present on first registration only
 *   event: {
 *     pulseName: "NDIS plan management topic",
 *     boardId: 5025222939,
 *     pulseId: 123456789
 *   }
 * }
 *
 * Monday item column layout (source board):
 *   column_values[1].text  → number of titles to generate (default 5)
 *   column_values[2].text  → source URL for additional context
 *   column_values[3].text  → keywords
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export async function handleGenerateTitleWebhook(req, res) {
  // Step 1: Monday challenge handshake — must be handled before signature validation.
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Step 2: Resolve brand from URL param
  const { brandId } = req.params;
  const brand = getBrandById(brandId);
  if (!brand) {
    return res.status(400).json({ error: `Unknown brand: ${brandId}` });
  }

  if (!brand.titleGeneration) {
    return res.status(400).json({ error: `Brand "${brandId}" has no titleGeneration config` });
  }

  // Step 3: Validate HMAC-SHA256 webhook signature (skipped when no secret is configured)
  try {
    validateWebhookSignature(req, brand.monday.webhookSecret);
  } catch (err) {
    console.error(`[generate-title] Signature validation failed for brand "${brandId}":`, err.message);
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  // Step 4: Respond 200 immediately — Monday will retry if we wait
  res.status(200).json({ received: true });

  // Step 5: Run the pipeline in the background (intentionally not awaited)
  runTitlePipeline(req.body.event, brand).catch((err) => {
    console.error("[generate-title] Unhandled top-level error:", err);
  });
}

/**
 * The full async title generation pipeline. Runs after the 200 response is sent.
 *
 * @param {Object} event - The Monday.com webhook event object (req.body.event)
 * @param {Object} brand - The resolved brand config from brands/index.js
 */
async function runTitlePipeline(event, brand) {
  const pulseId = event?.pulseId;
  const cfg = brand.titleGeneration;
  const cols = cfg.columns;

  console.log(`[generate-title] Starting pipeline for item ${pulseId}`);

  // Stage 1: Fetch the Monday item to read column values
  let item;
  try {
    item = await getItemById(pulseId, brand.monday.apiKey);
  } catch (err) {
    console.error("[generate-title] Failed to fetch Monday item:", err.message);
    return;
  }

  // Stage 2: Fetch latest Motion task (non-blocking — null if unavailable)
  const motionTask = await getLatestMotionTask(brand.motion);
  if (motionTask) {
    console.log(`[generate-title] Motion task fetched: "${motionTask.name}"`);
  }

  // Stage 3: Extract topic details from column values
  const columnValues = item.column_values;
  const topic = item.name;
  const numberOfTitles = parseInt(columnValues[cols.numberOfTitles]?.text, 10) || 5;
  const source = columnValues[cols.source]?.text || "";
  const keywords = columnValues[cols.keywords]?.text || "";

  console.log(`[generate-title] Topic: "${topic}", titles requested: ${numberOfTitles}`);

  // Stage 4: Build chatInput
  const jsonSample =
    `{\n  "blog_titles": [\n` +
    `    { "title": "Understanding Your NDIS Plan Management: A Complete Guide", "source": "https://example.com/article", "source_type": "motion" },\n` +
    `    { "title": "NDIS Plan Management vs Self-Management: Which Option Is Right for You?", "source": null, "source_type": "rag" }\n` +
    `  ]\n}`;

  let chatInput;
  if (topic.toLowerCase() === "latest ndis news") {
    chatInput =
      `Generate ${numberOfTitles || 3} blog post titles for Australian-owned NDIS provider. ` +
      `Choose topics from the latest news posted in www.ndis.gov.au/news/.\n` +
      `Links are:\nhttps://www.ndis.gov.au/news/latest?page=0\nhttps://www.ndis.gov.au/news/latest?page=1 and so on.\n\n` +
      `# OUTPUT FORMAT\nThe format must be a valid json and remove conversational filler, pre-prompt statement, or introductory remark.\n\n` +
      `Required JSON Format Sample:\n${jsonSample}`;
  } else {
    chatInput =
      `Generate ${numberOfTitles} blog post titles for Australian-owned NDIS provider around this topic:\n${topic}.` +
      (source ? `\n\nGet more details on this topic in this url: ${source}` : "") +
      `\n\n# OUTPUT FORMAT\nThe format must be a valid json and remove conversational filler, pre-prompt statement, or introductory remark.\n\n` +
      `Required JSON Format Sample:\n${jsonSample}`;
  }

  // Stage 5: Generate titles via AI
  let parsedOutput;
  try {
    parsedOutput = await generateBlogTitles(chatInput, brand, motionTask);
    console.log(`[generate-title] AI generated ${parsedOutput.blog_titles?.length ?? 0} titles for item ${pulseId}`);
  } catch (err) {
    console.error("[generate-title] AI generation failed:", err.message);
    await safeUpdateStatus(cfg.sourceBoardId, pulseId, cfg.statusLabels.failed, brand);
    return;
  }

  // Stage 6: Create one Monday item per generated title in the target board
  const blogTitles = parsedOutput.blog_titles || [];

  let createErrors = 0;
  for (const titleItem of blogTitles) {
    const titleText = titleItem.title ?? titleItem; // handle both object and legacy string shape
    const itemSource = titleItem.source || source || null;
    const titleColumnValues = {
      ...(itemSource && { [cols.targetSource]: itemSource }),
      ...(keywords && { [cols.targetKeywords]: keywords }),
    };
    try {
      await createBoardItem(
        cfg.targetBoardId,
        cfg.targetGroupId,
        titleText,
        titleColumnValues,
        brand.monday.apiKey
      );
      console.log(`[generate-title] Created title item: "${titleText}" (source_type: ${titleItem.source_type ?? "unknown"})`);
    } catch (err) {
      createErrors++;
      console.error(`[generate-title] Failed to create item for title "${titleText}":`, err.message);
    }
  }

  if (createErrors > 0) {
    console.warn(`[generate-title] ${createErrors}/${blogTitles.length} title items failed to create`);
  }

  // Stage 7: Update original topic item status to "Done"
  try {
    await updateItemColumns(
      cfg.sourceBoardId,
      pulseId,
      { [cols.status]: { label: cfg.statusLabels.done } },
      brand.monday.apiKey
    );
    console.log(`[generate-title] Marked source item ${pulseId} as Done`);
  } catch (err) {
    console.error(`[generate-title] Failed to update source item status:`, err.message);
  }
}

/**
 * Attempts to update the source Monday item status to an error label without throwing.
 *
 * @param {string|number} boardId
 * @param {string|number} itemId
 * @param {string} statusLabel
 * @param {Object} brand
 */
async function safeUpdateStatus(boardId, itemId, statusLabel, brand) {
  try {
    await updateItemColumns(
      boardId,
      itemId,
      { [brand.titleGeneration.columns.status]: { label: statusLabel } },
      brand.monday.apiKey
    );
  } catch (err) {
    console.error("[generate-title] safeUpdateStatus also failed:", err.message);
  }
}
