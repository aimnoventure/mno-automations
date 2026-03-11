import axios from "axios";

const MONDAY_API_URL = "https://api.monday.com/v2";
const TIMEOUT_MS = 30_000;

/**
 * Fetches a Monday.com board item by its pulse ID, including all column values.
 * Used to retrieve the AI model selector column before generating content.
 *
 * @param {string|number} pulseId - The Monday item ID (from webhook event.pulseId)
 * @param {string} apiKey - Monday.com API token (from brand.monday.apiKey)
 * @returns {Promise<Object>} The item object: { id, name, column_values: [{ id, text, value }] }
 * @throws {Error} If the API call fails, returns GraphQL errors, or the item is not found
 */
export async function getItemById(pulseId, apiKey) {
  const query = `
    query {
      items(ids: [${pulseId}]) {
        id
        name
        column_values {
          id
          text
          value
        }
      }
    }
  `;

  const response = await axios.post(
    MONDAY_API_URL,
    { query },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      timeout: TIMEOUT_MS,
    }
  );

  if (response.data.errors) {
    throw new Error(
      `Monday API errors in getItemById: ${JSON.stringify(response.data.errors)}`
    );
  }

  const items = response.data?.data?.items;
  if (!items || items.length === 0) {
    throw new Error(`Monday item not found: pulseId=${pulseId}`);
  }

  return items[0];
}

/**
 * Updates multiple column values on a Monday.com board item in a single mutation.
 * Used to write the generated content, SEO data, WordPress post ID, and status back
 * to the board item after the pipeline completes.
 *
 * Column value shapes:
 *   - Status column:  { label: "Content Generated" }
 *   - Text column:    "some string value"
 *   - Numeric column: "12345"  (string representation of the number)
 *
 * @param {string|number} boardId - The Monday board ID
 * @param {string|number} itemId - The Monday item ID to update
 * @param {Object} columnValues - Map of column IDs to their new values
 * @param {string} apiKey - Monday.com API token (from brand.monday.apiKey)
 * @returns {Promise<Object>} The updated item: { id, name }
 * @throws {Error} If the API call fails or returns GraphQL errors
 */
export async function updateItemColumns(boardId, itemId, columnValues, apiKey) {
  // Monday requires column_values to be a JSON string embedded as a GraphQL string literal.
  // JSON.stringify(columnValues) → JSON string
  // JSON.stringify(that string) → escaped GraphQL string literal (double-encoded)
  const columnValuesLiteral = JSON.stringify(JSON.stringify(columnValues));

  const mutation = `
    mutation {
      change_multiple_column_values(
        board_id: ${boardId},
        item_id: ${itemId},
        column_values: ${columnValuesLiteral}
      ) {
        id
        name
      }
    }
  `;

  const response = await axios.post(
    MONDAY_API_URL,
    { query: mutation },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      timeout: TIMEOUT_MS,
    }
  );

  if (response.data.errors) {
    throw new Error(
      `Monday API errors in updateItemColumns: ${JSON.stringify(response.data.errors)}`
    );
  }

  return response.data?.data?.change_multiple_column_values;
}
