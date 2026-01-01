import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

type Subtask = {
  text: string;
  estimatedEffort?: "quick" | "medium" | "large";
};

type BreakdownResponse = {
  subtasks: Subtask[];
  suggestion?: string;
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
    const { title, notes, tags, existingChecklist } = req.body || {};

    if (!title?.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    const client = new Anthropic({ apiKey });

    // Build context from tags
    const tagContext = tags?.length
      ? `Task type hints from tags: ${tags.join(", ")}`
      : "";

    // Build context from notes
    const notesContext = notes?.trim()
      ? `Additional context: ${notes}`
      : "";

    // Build context from existing checklist
    const existingContext = existingChecklist?.length
      ? `Already has these subtasks (don't duplicate): ${existingChecklist.join(", ")}`
      : "";

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Break down this task into actionable subtasks for a kanban board.

Task: "${title}"
${tagContext}
${notesContext}
${existingContext}

Guidelines:
- Generate 3-8 specific, actionable subtasks
- Order them in logical sequence (what to do first → last)
- Each subtask should be completable in less than a day
- For bugs: include reproduce, investigate, fix, test steps
- For features: include design, implement, test, document steps
- Keep subtask text concise (under 50 characters ideally)
- If the task is too big, suggest splitting into multiple cards

Return ONLY valid JSON in this format:
{
  "subtasks": [
    { "text": "Subtask description", "estimatedEffort": "quick|medium|large" }
  ],
  "suggestion": "Optional suggestion if task should be split"
}

estimatedEffort:
- "quick" = under 1 hour
- "medium" = 1-4 hours
- "large" = 4+ hours`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let result: BreakdownResponse = { subtasks: [] };
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      result = JSON.parse(cleaned);
    } catch {
      // If parsing fails, try to extract subtasks from text
      const lines = text.split("\n").filter(line => line.trim().startsWith("-") || line.trim().match(/^\d+\./));
      result = {
        subtasks: lines.slice(0, 8).map(line => ({
          text: line.replace(/^[-\d.)\s]+/, "").trim(),
          estimatedEffort: "medium" as const
        }))
      };
    }

    // Ensure we have subtasks
    if (!result.subtasks || result.subtasks.length === 0) {
      result.subtasks = [
        { text: "Plan approach", estimatedEffort: "quick" },
        { text: "Implement solution", estimatedEffort: "medium" },
        { text: "Test and verify", estimatedEffort: "quick" }
      ];
    }

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("AI breakdown error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
