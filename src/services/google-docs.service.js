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

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const docs  = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  // Create the doc directly inside the target folder — no move step needed
  const createResponse = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    },
    fields: "id",
  });

  const documentId = createResponse.data.id;

  // Insert the plain-text content
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

  return `https://docs.google.com/document/d/${documentId}/edit`;
}
