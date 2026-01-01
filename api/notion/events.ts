import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "@notionhq/client";
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

type NotionEvent = {
  id: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  isAllDay: boolean;
  url?: string;
};

/**
 * Fetch calendar events from Notion database for a date range
 *
 * POST /api/notion/events
 * Body: { startDate: string, endDate: string, databaseId?: string }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  setCorsHeaders(req, res);

  if (handlePreflight(req, res)) {
    return;
  }

  if (req.method !== "POST") {
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
        error: "NOTION_API_KEY not configured"
      });
    }

    const { startDate, endDate, databaseId } = req.body || {};

    // Use provided databaseId or fall back to env var
    const dbId = databaseId || process.env.NOTION_CALENDAR_DATABASE_ID;
    if (!dbId) {
      return res.status(400).json({
        error: "No database ID provided",
        help: "Either pass databaseId in body or set NOTION_CALENDAR_DATABASE_ID env var"
      });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "startDate and endDate are required"
      });
    }

    const notion = new Client({ auth: apiKey });

    // First, get the database schema to find the date property
    const database = await notion.databases.retrieve({ database_id: dbId });

    // Find the first date property
    const datePropertyName = Object.entries(database.properties)
      .find(([_, prop]) => prop.type === "date")?.[0];

    if (!datePropertyName) {
      return res.status(400).json({
        error: "No date property found in database",
        help: "Make sure your Notion database has a Date property"
      });
    }

    // Query the database for events in the date range
    const response = await notion.databases.query({
      database_id: dbId,
      filter: {
        and: [
          {
            property: datePropertyName,
            date: {
              on_or_after: startDate
            }
          },
          {
            property: datePropertyName,
            date: {
              on_or_before: endDate
            }
          }
        ]
      },
      sorts: [
        {
          property: datePropertyName,
          direction: "ascending"
        }
      ],
      page_size: 100
    });

    // Extract event data from results
    const events: NotionEvent[] = response.results
      .filter((result): result is Extract<typeof result, { object: "page" }> =>
        result.object === "page"
      )
      .map((page) => {
        // Get title from Name or Title property
        let title = "Untitled";
        const properties = page.properties as Record<string, unknown>;

        for (const [propName, prop] of Object.entries(properties)) {
          const propObj = prop as { type: string; title?: Array<{ plain_text: string }>; rich_text?: Array<{ plain_text: string }> };
          if (propObj.type === "title" && propObj.title?.[0]) {
            title = propObj.title[0].plain_text;
            break;
          }
        }

        // Get date info
        const dateProp = properties[datePropertyName] as { type: string; date?: { start?: string; end?: string } };
        const dateInfo = dateProp?.date;
        const startDateStr = dateInfo?.start || "";
        const endDateStr = dateInfo?.end;

        // Parse date - check if it includes time
        const hasTime = startDateStr.includes("T");
        const dateOnly = startDateStr.split("T")[0];

        return {
          id: page.id,
          title,
          date: dateOnly,
          startTime: hasTime ? startDateStr.split("T")[1]?.substring(0, 5) : undefined,
          endTime: endDateStr && endDateStr.includes("T")
            ? endDateStr.split("T")[1]?.substring(0, 5)
            : undefined,
          isAllDay: !hasTime,
          url: page.url
        };
      })
      .filter((event) => event.date); // Filter out events without dates

    return res.status(200).json({
      success: true,
      events,
      count: events.length,
      dateRange: { startDate, endDate },
      databaseId: dbId
    });
  } catch (err) {
    console.error("Notion events error:", err);

    if (err instanceof Error) {
      if (err.message.includes("Could not find database")) {
        return res.status(404).json({
          error: "Database not found",
          help: "Make sure the database is shared with your Notion integration"
        });
      }
    }

    return res.status(500).json({ error: String(err) });
  }
}
