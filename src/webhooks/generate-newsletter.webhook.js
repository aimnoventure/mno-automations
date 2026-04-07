import { getBrandById } from "../brands/index.js";
import { validateWebhookSignature } from "../utils/validate-webhook.js";
import { getItemById, updateItemColumns } from "../services/monday.service.js";
import { generateNewsletterContent, scrapeBlogArticles } from "../services/ai.service.js";
import { buildFormattedTemplate } from "../utils/format-newsletter-template.js";
import { createNewsletterDoc } from "../services/google-docs.service.js";

/**
 * Express route handler for POST /webhooks/:brandId/generate-newsletter.
 *
 * Handles the Monday.com "Generate Content" trigger on the newsletter board.
 * Responds 200 immediately, then runs the full newsletter pipeline in the background.
 *
 * Expected Monday webhook payload shape:
 * {
 *   challenge: "abc123",   // present on first registration only
 *   event: {
 *     pulseName: "Newsletter topic here",
 *     boardId: 5026304080,
 *     pulseId: 123456789
 *   }
 * }
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export async function handleGenerateNewsletterWebhook(req, res) {
  // Step 1: Monday challenge handshake — respond before any validation.
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
    validateWebhookSignature(req, brand.newsletter.webhookSecret);
  } catch (err) {
    console.error(`[newsletter] Signature validation failed for brand "${brandId}":`, err.message);
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  // Step 4: Respond 200 immediately — Monday will retry if we wait for the pipeline
  res.status(200).json({ received: true });

  // Step 5: Run pipeline in the background
  runPipeline(req.body.event, brand).catch((err) => {
    console.error("[newsletter] Unhandled top-level error:", err);
  });
}

/**
 * Full newsletter generation pipeline. Runs after the 200 response is sent.
 *
 * @param {Object} event - Monday.com webhook event (req.body.event)
 * @param {Object} brand - Resolved brand config from brands/index.js
 */
async function runPipeline(event, brand) {
  const pulseId = event?.pulseId;
  const boardId = event?.boardId;
  const cols = brand.newsletter.columns;

  console.log(`[newsletter] Starting pipeline for item ${pulseId} (board ${boardId})`);

  // Stage 1: Fetch full Monday item
  let item;
  try {
    item = await getItemById(pulseId, brand.monday.apiKey);
  } catch (err) {
    console.error("[newsletter] Failed to fetch Monday item:", err.message);
    return;
  }

  const columnValues = item.column_values;
  // Resolve Output column ID directly from the item — no extra API call needed
  const outputColumnId = columnValues[cols.output]?.id || null;
  const topic = item.name || "Generate newsletter topic based on current NDIS news";
  const emailDirection = columnValues[cols.emailDirection]?.text || "";
  const additionalSources = columnValues[cols.additionalSources]?.text || "";

  const now = new Date();
  const month = now.toLocaleString("en-AU", { month: "long" });
  const year = now.getFullYear();

  // Stage 2: Build newsletter AI prompt
  const userPrompt = `Generate newsletter content for Achora's scheduled email.

**Topic:** ${topic}
**Email direction:** ${emailDirection}
**Additional useful sources:** ${additionalSources}
**Month:** ${month}
**Year:** ${year}`;

  // Stage 3: Generate newsletter content via AI
  let newsletterContent;
  try {
    newsletterContent = await generateNewsletterContent(userPrompt, brand);
    console.log(`[newsletter] AI content generated for item ${pulseId}`);
  } catch (err) {
    console.error("[newsletter] AI generation failed:", err.message);
    await safeUpdateStatus(boardId, pulseId, brand.newsletter.statusLabels.generationFailed, brand);
    return;
  }

  // Stage 4: Scrape real blog articles from Achora website
  let blogData;
  try {
    blogData = await scrapeBlogArticles(brand.newsletter.blogUrl);
    console.log(`[newsletter] Blog articles scraped for item ${pulseId}`);
  } catch (err) {
    console.error("[newsletter] Blog scraping failed:", err.message);
    await safeUpdateStatus(boardId, pulseId, brand.newsletter.statusLabels.generationFailed, brand);
    return;
  }

  // Stage 5: Merge — real blog articles override AI-generated placeholders
  const combined = { ...newsletterContent, ...blogData };

  // Stage 6: Build Campaign Monitor payload
  const payload = buildCampaignPayload(combined, columnValues, item.name, brand);

  // Stage 7: Build formatted template
  const formattedTemplate = buildFormattedTemplate(payload);

  // Stage 8: Create Google Doc and get its URL
  let docUrl = null;
  try {
    docUrl = await createNewsletterDoc(item.name, formattedTemplate, brand.newsletter.googleDocs);
    console.log(`[newsletter] Google Doc created for item ${pulseId}: ${docUrl}`);
  } catch (err) {
    console.error("[newsletter] Failed to create Google Doc:", err.message);
  }

  // Stage 9: Update Monday item — Output column (doc URL) + status in one call
  try {
    const columnUpdates = {
      status: { label: brand.newsletter.statusLabels.campaignCreated },
    };
    if (outputColumnId && docUrl) {
      columnUpdates[outputColumnId] = docUrl;
    }
    await updateItemColumns(boardId, pulseId, columnUpdates, brand.monday.apiKey);
    console.log(`[newsletter] Monday item ${pulseId} updated to "${brand.newsletter.statusLabels.campaignCreated}"`);
    if (outputColumnId && docUrl) {
      console.log(`[newsletter] Output column set to Google Doc URL for item ${pulseId}`);
    }
  } catch (err) {
    console.error(`[newsletter] Monday status update failed for item ${pulseId}:`, err.message);
  }
}

/**
 * Builds the full Campaign Monitor "create from template" payload.
 * Maps AI-generated newsletter content and Monday item column values to the
 * CM template's Singlelines, Multilines, Images, and Repeaters structure.
 *
 * @param {Object} combined     - Merged AI output: newsletter content + scraped blog articles
 * @param {Array}  columnValues - column_values array from Monday getItemById response
 * @param {string} itemName     - Monday item name (used for campaign name)
 * @param {Object} brand        - Brand config (newsletter.campaignMonitor, newsletter.defaultImages)
 * @returns {Object} Campaign Monitor API payload
 */
export function buildCampaignPayload(combined, columnValues, itemName, brand) {
  const cm = brand.newsletter.campaignMonitor;
  const cols = brand.newsletter.columns;
  const defaults = brand.newsletter.defaultImages;

  // Extract values from Monday columns, falling back to defaults for images
  const subject    = columnValues[cols.emailSubject]?.text?.trim() || "Achora Email Newsletter";
  const fromName   = columnValues[cols.fromName]?.text?.trim()     || "Achora";
  const fromEmail  = columnValues[cols.fromEmail]?.text?.trim()    || "admin@achora.com.au";
  const bannerUrl  = columnValues[cols.bannerLink]?.text           || defaults.banner;
  const image1Url  = columnValues[cols.featureImage1]?.text        || defaults.featureCard1;
  const image2Url  = columnValues[cols.featureImage2]?.text        || defaults.featureCard2;
  const image3Url  = columnValues[cols.featureImage3]?.text        || defaults.featureCard3;
  const videoUrl   = columnValues[cols.videoThumbnail]?.text       || defaults.videoThumb;
  const logoUrl    = columnValues[cols.logo]?.text                 || defaults.footerLogo;

  const campaignName = `${itemName} [${Date.now()}]`;

  const s1 = combined.section1 || {};
  const s2 = combined.section2 || {};
  const s3 = combined.section3 || {};
  const b0 = combined.blog_articles?.[0] || {};
  const b1 = combined.blog_articles?.[1] || {};

  return {
    Name:      campaignName,
    Subject:   subject,
    FromName:  fromName,
    FromEmail: fromEmail,
    ReplyTo:   fromEmail,
    ListIDs:   [cm.defaultListId],
    SegmentIDs: [],
    TemplateID: cm.templateId,
    TemplateContent: {
      Singlelines: [
        { Content: combined.greeting || "Hi, there!", Href: "" },
        { Content: "Contact Achora", Href: "https://achora.com.au/contact" },
        { Content: "Achora · 517/5 Celebration Drive Bella Vista 2153 New South Wales · Australia", Href: "" },
        { Content: "You are receiving this email as you have signed up to one of Achora's products or services, or have come into contact with one of our online service offerings.", Href: "" },
      ],
      Multilines: [
        { Content: `<p>${combined.seasonal_message || ""}</p><p>${combined.intro_paragraph || ""}</p>` },
      ],
      Images: [
        { Content: defaults.headerLogo, Alt: "Achora", Href: "https://achora.com.au" },
        { Content: bannerUrl,           Alt: "Achora Newsletter", Href: "https://achora.com.au" },
        { Content: logoUrl,             Alt: "Achora", Href: "https://achora.com.au" },
      ],
      Repeaters: [
        {
          Items: [
            {
              Layout: "Feature Card - Image Left (Purple)",
              Singlelines: [
                { Content: s1.heading  || "", Href: "" },
                { Content: s1.cta_text || "", Href: "https://achora.com.au/plan-check" },
              ],
              Multilines: [
                {
                  Content: `<p>${s1.bullets?.[0] || ""}</p><p>${s1.bullets?.[1] || ""}</p><p>${s1.bullets?.[2] || ""}</p>`,
                },
              ],
              Images: [
                { Content: image1Url, Alt: "NDIS Plan Support", Href: "https://achora.com.au/plan-check" },
              ],
            },
            {
              Layout: "Feature Card - Image Right (Teal)",
              Singlelines: [
                { Content: s2.heading      || "", Href: "" },
                { Content: s2.bullets?.[0] || "", Href: "" },
                { Content: s2.bullets?.[1] || "", Href: "" },
                { Content: s2.bullets?.[2] || "", Href: "" },
                { Content: s2.cta_text     || "", Href: "https://achora.com.au/ndis-goals" },
              ],
              Multilines: [],
              Images: [
                { Content: image2Url, Alt: "NDIS Tips", Href: "https://achora.com.au/ndis-goals" },
              ],
            },
            {
              Layout: "Feature Card - Split (Yellow/White)",
              Singlelines: [
                { Content: s3.heading  || "", Href: "" },
                { Content: s3.cta_text || "", Href: "https://achora.com.au/contact" },
              ],
              Multilines: [
                { Content: `<p>${s3.description || ""}</p>` },
              ],
              Images: [
                { Content: image3Url, Alt: "NDIS Resource", Href: "https://achora.com.au/contact" },
              ],
            },
            {
              Layout: "Full-Width Image + Caption",
              Singlelines: [],
              Multilines: [
                { Content: `<p>${combined.participant_insight || ""}</p>` },
              ],
              Images: [
                { Content: videoUrl, Alt: "Achora Highlight", Href: "" },
              ],
            },
            {
              Layout: "Section Heading",
              Singlelines: [
                { Content: "Interesting Reads:", Href: "" },
              ],
              Multilines: [],
              Images: [],
            },
            {
              Layout: "Blog Card - Two Column (Teal)",
              Singlelines: [
                { Content: b0.title || "", Href: b0.url || "" },
                { Content: "Learn More",  Href: b0.url || "" },
              ],
              Multilines: [
                { Content: `<p>${b0.description || ""}</p>` },
              ],
              Images: [
                { Content: defaults.blogImage1, Alt: b0.title || "Blog article", Href: b0.url || "" },
              ],
            },
            {
              Layout: "Blog Card - Two Column (Yellow)",
              Singlelines: [
                { Content: b1.title || "", Href: b1.url || "" },
                { Content: "Read More",   Href: b1.url || "" },
              ],
              Multilines: [
                { Content: `<p>${b1.description || ""}</p>` },
              ],
              Images: [
                { Content: defaults.blogImage2, Alt: b1.title || "Blog article", Href: b1.url || "" },
              ],
            },
            {
              Layout: "Full-Width Banner",
              Singlelines: [],
              Multilines: [],
              Images: [
                { Content: defaults.footerBanner, Alt: "Achora Banner", Href: "https://achora.com.au" },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Attempts to update the Monday item status to an error label without throwing.
 *
 * @param {string|number} boardId     - Newsletter Monday board ID
 * @param {string|number} itemId      - Monday item ID
 * @param {string}        statusLabel - Error status label (e.g. "Generation Failed")
 * @param {Object}        brand       - Brand config (for API key)
 */
async function safeUpdateStatus(boardId, itemId, statusLabel, brand) {
  try {
    await updateItemColumns(
      boardId,
      itemId,
      { status: { label: statusLabel } },
      brand.monday.apiKey
    );
  } catch (err) {
    console.error("[newsletter] safeUpdateStatus also failed:", err.message);
  }
}
