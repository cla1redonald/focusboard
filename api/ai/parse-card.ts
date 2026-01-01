import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

type ParsedCard = {
  title: string;
  column?: string;
  tags?: string[];
  dueDate?: string;
  swimlane?: "work" | "personal";
  notes?: string;
};

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
    const { input, availableColumns, availableTags } = req.body || {};

    if (!input?.trim()) {
      return res.status(400).json({ error: "Input is required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    const client = new Anthropic({ apiKey });

    // Format available options for the prompt
    const columnList = availableColumns?.length
      ? availableColumns.map((c: { id: string; title: string }) => `${c.id} (${c.title})`).join(", ")
      : "backlog, design, todo, doing, blocked, done";

    const tagList = availableTags?.length
      ? availableTags.map((t: { id: string; name: string }) => `${t.id} (${t.name})`).join(", ")
      : "high (High), medium (Medium), low (Low), bug (Bug), feature (Feature), chore (Chore)";

    const today = new Date().toISOString().split("T")[0];

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Parse this natural language task request into structured card data.

Input: "${input}"

Available columns: ${columnList}
Available tags: ${tagList}
Today's date: ${today}

Extract:
1. title: The core task description (required, clean and concise)
2. column: Which column to add to (use ID, default "backlog")
3. tags: Array of tag IDs that apply (based on priority/type hints)
4. dueDate: ISO date string if mentioned (e.g., "tomorrow" = next day, "friday" = this/next friday)
5. swimlane: "work" or "personal" (default "work", use "personal" for home/family tasks)
6. notes: Any additional context

Examples:
- "urgent bug fix login page" → { title: "Fix login page", tags: ["high", "bug"], column: "todo" }
- "add dark mode feature by friday" → { title: "Add dark mode feature", tags: ["feature"], dueDate: "2024-01-05" }
- "personal: buy groceries tomorrow" → { title: "Buy groceries", swimlane: "personal", dueDate: "2024-01-02" }

Return ONLY valid JSON, no markdown or explanation.`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let parsedCard: ParsedCard = { title: input };
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      parsedCard = JSON.parse(cleaned);
    } catch {
      // If parsing fails, use the input as title
      parsedCard = { title: input };
    }

    // Ensure title exists
    if (!parsedCard.title) {
      parsedCard.title = input;
    }

    return res.status(200).json({
      success: true,
      card: parsedCard,
    });
  } catch (err) {
    console.error("AI parse error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
