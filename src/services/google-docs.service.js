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

  // Create an empty Google Doc
  const createResponse = await docs.documents.create({
    requestBody: { title },
  });

  const documentId = createResponse.data.documentId;

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

  // Move the doc into the target Drive folder
  const file = await drive.files.get({
    fileId: documentId,
    fields: "parents",
  });

  const previousParents = file.data.parents.join(",");

  await drive.files.update({
    fileId: documentId,
    addParents: folderId,
    removeParents: previousParents,
    fields: "id, parents",
  });

  return `https://docs.google.com/document/d/${documentId}/edit`;
}
