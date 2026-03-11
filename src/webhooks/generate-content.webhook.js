import { getBrandById } from "../brands/index.js";
import { validateWebhookSignature } from "../utils/validate-webhook.js";
import { getItemById, updateItemColumns } from "../services/monday.service.js";
import { generateBlogContent } from "../services/ai.service.js";
import { createPrivatePost } from "../services/cms.service.js";

/**
 * Express route handler for POST /webhooks/:brandId/generate-content.
 *
 * Handles the Monday.com "Generate Content" trigger. Responds 200 immediately
 * (before any async work) to satisfy Monday's webhook timeout requirement, then
 * runs the full content pipeline in the background.
 *
 * Expected Monday webhook payload shape:
 * {
 *   challenge: "abc123",   // present on first registration only
 *   event: {
 *     pulseName: "Blog title here",
 *     boardId: 5025223094,
 *     pulseId: 123456789
 *   }
 * }
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export async function handleGenerateContentWebhook(req, res) {
  // Step 1: Monday challenge handshake — must be handled before signature validation.
  // Monday sends this on webhook registration and expects the challenge echoed back.
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  // Step 2: Resolve brand from URL param
  const { brandId } = req.params;
  const brand = getBrandById(brandId);
  if (!brand) {
    return res.status(400).json({ error: `Unknown brand: ${brandId}` });
  }

  // Step 3: Validate HMAC-SHA256 webhook signature
  try {
    validateWebhookSignature(req, brand.monday.webhookSecret);
  } catch (err) {
    console.error(`[webhook] Signature validation failed for brand "${brandId}":`, err.message);
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  // Step 4: Respond 200 immediately — Monday will retry if we wait for the full pipeline
  res.status(200).json({ received: true });

  // Step 5: Run the full pipeline in the background (intentionally not awaited)
  // The .catch() at the call site is required — without it, a rejected promise becomes
  // an unhandled rejection which can crash the Node.js process.
  runPipeline(req.body.event, brand).catch((err) => {
    console.error("[pipeline] Unhandled top-level error:", err);
  });
}

/**
 * The full async content generation pipeline. Runs after the 200 response is sent.
 * Each stage is wrapped in its own try/catch so a failure at one stage can be logged
 * and, where possible, the Monday item status is updated to reflect the error.
 *
 * @param {Object} event - The Monday.com webhook event object (req.body.event)
 * @param {Object} brand - The resolved brand config from brands/index.js
 */
async function runPipeline(event, brand) {
  const pulseName =
    event?.pulseName || "Generate blog post title based on current NDIS news";
  const boardId = event?.boardId;
  const pulseId = event?.pulseId;
  const cols = brand.monday.columns;

  console.log(`[pipeline] Starting for item ${pulseId} (board ${boardId})`);

  // Stage 1: Fetch full Monday item to get column values (including AI model selector)
  let item;
  try {
    item = await getItemById(pulseId, brand.monday.apiKey);
  } catch (err) {
    console.error("[pipeline] Failed to fetch Monday item:", err.message);
    return; // Cannot proceed without column values
  }

  // Stage 2: Extract AI model from the designated column index
  const columnValues = item.column_values;
  const model = columnValues[cols.aiModelSelector]?.text || brand.ai.defaultModel;
  console.log(`[pipeline] Using AI model: "${model}" for item ${pulseId}`);

  // Stage 3: Build chat input and generate blog content
  const chatInput = `Write a blog post about:\nTitle: ${pulseName}`;

  let parsedOutput;
  try {
    parsedOutput = await generateBlogContent(chatInput, model, brand);
    console.log(`[pipeline] AI generation complete for item ${pulseId}`);
  } catch (err) {
    console.error("[pipeline] AI generation failed:", err.message);
    await safeUpdateStatus(boardId, pulseId, brand.monday.statusLabels.generationFailed, brand);
    return;
  }

  // Stage 4: Create a private WordPress post with the generated content
  let wpResponse;
  try {
    wpResponse = await createPrivatePost(parsedOutput, brand.cms);
    console.log(`[pipeline] WordPress post created: ID=${wpResponse.id}`);
  } catch (err) {
    console.error("[pipeline] WordPress post creation failed:", err.message);
    await safeUpdateStatus(boardId, pulseId, brand.monday.statusLabels.generationFailed, brand);
    return;
  }

  // Stage 5: Update Monday board item with all generated data
  try {
    await updateItemColumns(
      boardId,
      pulseId,
      {
        [cols.status]: { label: brand.monday.statusLabels.contentGenerated },
        [cols.privateLink]: wpResponse.guid.rendered,
        [cols.htmlContent]: parsedOutput.content,
        [cols.seoTitle]: parsedOutput.seoTitle,
        [cols.wpPostId]: String(wpResponse.id),
        [cols.tokenUsed]: String(parsedOutput.token_used),
      },
      brand.monday.apiKey
    );
    console.log(`[pipeline] Monday item ${pulseId} updated successfully`);
  } catch (err) {
    // Content has already been generated and published — log but do not propagate
    console.error(
      `[pipeline] Monday update failed for item ${pulseId} (content still published):`,
      err.message
    );
  }
}

/**
 * Attempts to update the Monday item status to an error label without throwing.
 * Called when the pipeline fails partway through so the board reflects the failure.
 *
 * @param {string|number} boardId - The Monday board ID
 * @param {string|number} itemId - The Monday item ID
 * @param {string} statusLabel - The error status label string (e.g. "Generation Failed")
 * @param {Object} brand - The brand config (used for column ID and API key)
 */
async function safeUpdateStatus(boardId, itemId, statusLabel, brand) {
  try {
    await updateItemColumns(
      boardId,
      itemId,
      { [brand.monday.columns.status]: { label: statusLabel } },
      brand.monday.apiKey
    );
  } catch (err) {
    console.error("[pipeline] safeUpdateStatus also failed:", err.message);
  }
}
