import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "@notionhq/client";
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

/**
 * List Notion databases shared with the integration
 * Used to discover which database contains calendar/events
 *
 * GET /api/notion/databases
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  setCorsHeaders(req, res);

  if (handlePreflight(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify authentication
  const user = await verifySession(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "NOTION_API_KEY not configured",
        help: "Add NOTION_API_KEY to your Vercel environment variables"
      });
    }

    const notion = new Client({ auth: apiKey });

    // Search for all databases shared with the integration
    const response = await notion.search({
      filter: {
        property: "object",
        value: "database"
      },
      page_size: 50
    });

    // Extract useful info about each database
    const databases = response.results
      .filter((result): result is Extract<typeof result, { object: "database" }> =>
        result.object === "database"
      )
      .map((db) => {
        // Get the title
        const titleProp = db.title?.[0];
        const title = titleProp?.type === "text" ? titleProp.plain_text : "Untitled";

        // Get properties with date type (potential calendar fields)
        const dateProperties = Object.entries(db.properties)
          .filter(([_, prop]) => prop.type === "date")
          .map(([name]) => name);

        // Get all property names and types for debugging
        const allProperties = Object.entries(db.properties).map(([name, prop]) => ({
          name,
          type: prop.type
        }));

        return {
          id: db.id,
          title,
          dateProperties,
          allProperties,
          url: db.url
        };
      });

    return res.status(200).json({
      success: true,
      databases,
      count: databases.length,
      hint: "Look for a database with date properties that could be your calendar"
    });
  } catch (err) {
    console.error("Notion databases error:", err);

    // Handle specific Notion API errors
    if (err instanceof Error && err.message.includes("unauthorized")) {
      return res.status(401).json({
        error: "Invalid Notion API key",
        help: "Check that your NOTION_API_KEY is correct"
      });
    }

    return res.status(500).json({ error: String(err) });
  }
}
