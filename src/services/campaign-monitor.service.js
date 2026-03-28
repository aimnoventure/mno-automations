import axios from "axios";

const TIMEOUT_MS = 30_000;

/**
 * Creates a Campaign Monitor campaign from a template.
 *
 * Uses HTTP Basic Auth — Campaign Monitor API key as the username, "X" as the
 * password (CM convention; any non-empty string works as the password).
 *
 * @param {Object} payload - Full campaign payload including TemplateContent
 * @param {Object} cmConfig - Campaign Monitor config from brand.newsletter.campaignMonitor
 * @param {string} cmConfig.apiKey   - Campaign Monitor API key
 * @param {string} cmConfig.clientId - Campaign Monitor client ID
 * @returns {Promise<string>} The new campaign ID returned by Campaign Monitor
 */
export async function createCampaign(payload, cmConfig) {
  const { apiKey, clientId } = cmConfig;
  const credentials = Buffer.from(`${apiKey}:X`).toString("base64");

  const response = await axios.post(
    `https://api.createsend.com/api/v3.3/campaigns/${clientId}/fromtemplate.json`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      timeout: TIMEOUT_MS,
    }
  );

  return response.data; // Campaign Monitor returns the new campaign ID as a plain string
}
