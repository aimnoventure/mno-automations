/**
 * get-monday-columns.js
 *
 * Fetches and prints all column IDs, titles, and types for a Monday.com board.
 * Run with: node scripts/get-monday-columns.js
 *
 * Reads MONDAY_API_KEY_MAPLE and MONDAY_BOARD_ID_MAPLE from .env
 */

import "dotenv/config";
import axios from "axios";

const API_KEY = process.env.MONDAY_API_KEY_MAPLE;
const BOARD_ID = process.env.MONDAY_BOARD_ID_MAPLE;

if (!API_KEY) {
  console.error("Error: MONDAY_API_KEY_MAPLE is not set in .env");
  process.exit(1);
}

if (!BOARD_ID) {
  console.error("Error: MONDAY_BOARD_ID_MAPLE is not set in .env");
  process.exit(1);
}

const query = `
  query {
    boards(ids: [${BOARD_ID}]) {
      name
      columns {
        id
        title
        type
      }
    }
  }
`;

try {
  const response = await axios.post(
    "https://api.monday.com/v2",
    { query },
    {
      headers: {
        Authorization: API_KEY,
        "Content-Type": "application/json",
        "API-Version": "2024-01",
      },
    }
  );

  const errors = response.data.errors;
  if (errors?.length) {
    console.error("Monday API errors:", JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  const board = response.data.data.boards[0];
  if (!board) {
    console.error(`Board ${BOARD_ID} not found or not accessible.`);
    process.exit(1);
  }

  console.log(`\nBoard: ${board.name} (ID: ${BOARD_ID})\n`);
  console.log("Columns:");
  console.log("─".repeat(60));

  for (const col of board.columns) {
    console.log(`  id: "${col.id}"  |  title: "${col.title}"  |  type: ${col.type}`);
  }

  console.log("\nConfig snippet for maple.config.js:");
  console.log("─".repeat(60));
  console.log("columns: {");
  console.log("  aiModelSelector: 0,  // index into column_values array (check order above)");
  console.log('  status: "status",');
  for (const col of board.columns) {
    if (col.type !== "name") {
      console.log(`  // "${col.title}" → "${col.id}"`);
    }
  }
  console.log("}");
} catch (err) {
  console.error("Request failed:", err.message);
  process.exit(1);
}
