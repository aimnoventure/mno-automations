import { google } from "googleapis";

/**
 * Creates a Google Doc with the given title and plain-text content,
 * places it in the specified Drive folder, and returns the doc URL.
 * Authenticates as the folder owner via OAuth2 refresh token so files
 * count against the owner's Drive quota (not a service account).
 *
 * @param {string} title - Document title (used as the Google Doc name)
 * @param {string} content - Plain-text body to insert into the document
 * @param {Object} googleDocsConfig - From brand.newsletter.googleDocs
 * @param {string} googleDocsConfig.folderId     - Google Drive folder ID
 * @param {string} googleDocsConfig.clientId     - OAuth2 Client ID
 * @param {string} googleDocsConfig.clientSecret - OAuth2 Client Secret
 * @param {string} googleDocsConfig.refreshToken - OAuth2 Refresh Token
 * @returns {Promise<string>} The Google Doc URL
 */
export async function createNewsletterDoc(title, content, googleDocsConfig) {
  const { folderId, clientId, clientSecret, refreshToken } = googleDocsConfig;

  // Guard: catch missing config early with a clear message
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REFRESH_TOKEN is not set"
    );
  }
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_NEWSLETTER_FOLDER_ID is not set");
  }

  console.log(`[google-docs] Target folder ID: ${folderId}`);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const auth = oauth2Client;

  const docs  = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  // Step 1: Create the doc directly inside the target folder
  console.log("[google-docs] Step 1 — Creating file via Drive API...");
  let createResponse;
  try {
    createResponse = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId],
      },
      fields: "id",
    });
  } catch (err) {
    throw new Error(`Drive files.create failed: ${err.message} (code: ${err.code})`);
  }

  const documentId = createResponse.data.id;
  console.log(`[google-docs] Step 1 complete — documentId: ${documentId}`);

  // Step 2: Insert plain-text content
  console.log("[google-docs] Step 2 — Inserting content via Docs API...");
  try {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: content,
            },
          },
        ],
      },
    });
  } catch (err) {
    throw new Error(`Docs batchUpdate failed: ${err.message} (code: ${err.code})`);
  }

  console.log("[google-docs] Step 2 complete — content inserted.");
  return `https://docs.google.com/document/d/${documentId}/edit`;
}
