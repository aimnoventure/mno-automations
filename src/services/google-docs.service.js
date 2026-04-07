import { google } from "googleapis";

/**
 * Creates a Google Doc with the given title and plain-text content,
 * places it in the specified Drive folder, and returns its public URL.
 *
 * @param {string} title - Document title (used as the Google Doc name)
 * @param {string} content - Plain-text body to insert into the document
 * @param {Object} googleDocsConfig - From brand.newsletter.googleDocs
 * @param {string} googleDocsConfig.folderId - Google Drive folder ID to place the doc in
 * @param {Object} googleDocsConfig.credentials - Parsed service account JSON key
 * @returns {Promise<string>} The Google Doc URL
 */
export async function createNewsletterDoc(title, content, googleDocsConfig) {
  const { folderId, credentials } = googleDocsConfig;

  // Guard: catch missing config early with a clear message
  if (!credentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set or failed to parse");
  }
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_NEWSLETTER_FOLDER_ID is not set");
  }

  console.log(`[google-docs] Auth client_email: ${credentials.client_email}`);
  console.log(`[google-docs] Target folder ID : ${folderId}`);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive",
    ],
  });

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
