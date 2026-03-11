import { createHmac, timingSafeEqual } from "crypto";

/**
 * Validates a Monday.com webhook HMAC-SHA256 signature.
 *
 * Monday sends the signature in the Authorization header as: Bearer <hmac_hex>
 * The HMAC is computed over the raw request body bytes using the webhook secret.
 * Requires req.rawBody (Buffer) to be set — this is done by the express.json
 * verify callback in src/index.js.
 *
 * @param {import("express").Request} req - Express request object with req.rawBody attached
 * @param {string} secret - The brand's MONDAY_WEBHOOK_SECRET from brands/achora.config.js
 * @throws {Error} If the Authorization header is missing, malformed, or the signature does not match
 */
export function validateWebhookSignature(req, secret) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }

  const token = authHeader.slice("Bearer ".length);

  const rawBody = req.rawBody;
  if (!rawBody) {
    throw new Error(
      "rawBody not available — ensure express.json verify callback is configured in index.js"
    );
  }

  const expectedHmac = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedHmac, "utf8");
  const tokenBuf = Buffer.from(token, "utf8");

  // timingSafeEqual throws if buffers have different lengths — check first
  if (expectedBuf.length !== tokenBuf.length) {
    throw new Error("Webhook signature mismatch");
  }

  if (!timingSafeEqual(expectedBuf, tokenBuf)) {
    throw new Error("Webhook signature mismatch");
  }
}
