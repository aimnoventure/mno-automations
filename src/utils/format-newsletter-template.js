/**
 * Converts a Campaign Monitor newsletter payload into a human-readable
 * editable content template (plain text).
 *
 * @param {Object} payload - The full CM payload produced by buildCampaignPayload()
 * @returns {string} Formatted template string
 */
export function buildFormattedTemplate(payload, model = null) {
  const tc   = payload.TemplateContent;
  const sl   = tc.Singlelines;
  const ml   = tc.Multilines;
  const items = tc.Repeaters?.[0]?.Items || [];

  // Helper: strip HTML tags and convert <p>...</p> blocks to plain paragraphs
  const stripHtml = (html = "") =>
    html
      .replace(/<\/p>\s*<p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim();

  // Helper: extract <p> blocks as an array of plain strings
  const pBlocks = (html = "") =>
    (html.match(/<p>([\s\S]*?)<\/p>/gi) || [])
      .map((p) => p.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);

  // Pull top-level fields
  const greeting       = sl[0]?.Content || "";
  const ctaButtonText  = sl[1]?.Content || "";
  const ctaLink        = sl[1]?.Href    || "#";
  const openingMsg     = stripHtml(ml[0]?.Content);

  // Pull repeater items by index (order matches buildCampaignPayload)
  const card1     = items[0] || {};   // Feature Card - Image Left (Purple)
  const card2     = items[1] || {};   // Feature Card - Image Right (Teal)
  const card3     = items[2] || {};   // Feature Card - Split (Yellow/White)
  const fullWidth = items[3] || {};   // Full-Width Image + Caption
  const secHead   = items[4] || {};   // Section Heading
  const blog1     = items[5] || {};   // Blog Card (Teal)
  const blog2     = items[6] || {};   // Blog Card (Yellow)

  // Card 1 bullets come from <p> blocks in Multilines
  const card1Bullets = pBlocks(card1.Multilines?.[0]?.Content);

  // Card 2 bullets come from Singlelines[1..3]
  const card2Bullets = (card2.Singlelines || []).slice(1, -1).map((s) => s.Content).filter(Boolean);

  const sep  = "====================================================";
  const dash = "----------------------------------------------------";

  const header = model
    ? `ACHORA NEWSLETTER - ${model.toUpperCase()} VERSION`
    : "ACHORA NEWSLETTER - EDITABLE CONTENT TEMPLATE";

  const lines = [
    sep,
    header,
    sep,
    " ",
    `Name: ${payload.Name}`,
    ` Subject: ${payload.Subject}`,
    " ",
    dash,
    "GREETING",
    dash,
    " ",
    "Greeting:",
    greeting,
    " ",
    "Opening Message:",
    openingMsg,
    " ",
    " ",
    dash,
    "PRIMARY CTA",
    dash,
    " ",
    "CTA 1:",
    `Button Text: ${ctaButtonText}`,
    `Link: ${ctaLink}`,
    " ",
    " ",
    dash,
    "FEATURE CARD 1 — Purple Card (Image Left)",
    dash,
    " ",
    "Title:",
    card1.Singlelines?.[0]?.Content || "",
    " ",
    "Description:",
    ...card1Bullets,
    " ",
    "CTA:",
    `Button Text: ${card1.Singlelines?.[1]?.Content || ""}`,
    `Link: ${card1.Singlelines?.[1]?.Href || "#"}`,
    " ",
    " ",
    dash,
    "FEATURE CARD 2 — Teal Card (Image Right)",
    dash,
    " ",
    "Title:",
    card2.Singlelines?.[0]?.Content || "",
    " ",
    "Description (List):",
    ...card2Bullets.map((b) => `- ${b}`),
    " ",
    "CTA:",
    `Button Text: ${card2.Singlelines?.at(-1)?.Content || ""}`,
    `Link: ${card2.Singlelines?.at(-1)?.Href || "#"}`,
    " ",
    " ",
    dash,
    "FEATURE CARD 3 — Split Card (Yellow/White)",
    dash,
    " ",
    "Title:",
    card3.Singlelines?.[0]?.Content || "",
    " ",
    "Description:",
    stripHtml(card3.Multilines?.[0]?.Content),
    " ",
    "CTA:",
    `Button Text: ${card3.Singlelines?.[1]?.Content || ""}`,
    `Link: ${card3.Singlelines?.[1]?.Href || "#"}`,
    " ",
    " ",
    dash,
    "FULL-WIDTH IMAGE + CAPTION",
    dash,
    " ",
    "Caption:",
    stripHtml(fullWidth.Multilines?.[0]?.Content),
    " ",
    `Image Link: ${fullWidth.Images?.[0]?.Href || "#"}`,
    " ",
    " ",
    dash,
    "SECTION HEADING",
    dash,
    " ",
    "Heading:",
    secHead.Singlelines?.[0]?.Content || "",
    " ",
    " ",
    dash,
    "BLOG CARD 1 — Teal Button",
    dash,
    " ",
    "Title:",
    blog1.Singlelines?.[0]?.Content || "",
    " ",
    "Description:",
    stripHtml(blog1.Multilines?.[0]?.Content),
    " ",
    "CTA:",
    `Button Text: ${blog1.Singlelines?.[1]?.Content || ""}`,
    `Link: ${blog1.Singlelines?.[1]?.Href || "#"}`,
    " ",
    " ",
    dash,
    "BLOG CARD 2 — Yellow Button",
    dash,
    " ",
    "Title:",
    blog2.Singlelines?.[0]?.Content || "",
    " ",
    "Description:",
    stripHtml(blog2.Multilines?.[0]?.Content),
    " ",
    "CTA:",
    `Button Text: ${blog2.Singlelines?.[1]?.Content || ""}`,
    `Link: ${blog2.Singlelines?.[1]?.Href || "#"}`,
    " ",
    sep,
    "END OF TEMPLATE",
    sep,
  ];

  return lines.join("\n");
}
