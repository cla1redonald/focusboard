import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

type CardInput = {
  id: string;
  title: string;
  column: string;
  dueDate?: string;
  tags: string[];
  urgencyLevel: string;
  createdAt: string;
  blockedReason?: string;
};

type FocusSuggestion = {
  cardId: string;
  reason: string;
  priority: 1 | 2 | 3;
};

type DailyFocusResponse = {
  suggestions: FocusSuggestion[];
  insight?: string;
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
    const { cards, completedToday, avgCycleTime, wipLimit } = req.body || {};

    if (!cards || !Array.isArray(cards)) {
      return res.status(400).json({ error: "Cards array is required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    // Filter out blocked and completed cards
    const availableCards = (cards as CardInput[]).filter(
      (c) => c.column !== "blocked" && c.column !== "done" && !c.blockedReason
    );

    if (availableCards.length === 0) {
      return res.status(200).json({
        success: true,
        suggestions: [],
        insight: "No tasks available. Great job clearing your board!",
      });
    }

    const client = new Anthropic({ apiKey });

    const today = new Date().toISOString().split("T")[0];

    // Format cards for the prompt
    const cardList = availableCards
      .map((c) => {
        const parts = [`- ID: ${c.id}`, `Title: "${c.title}"`, `Column: ${c.column}`];
        if (c.dueDate) parts.push(`Due: ${c.dueDate}`);
        if (c.urgencyLevel && c.urgencyLevel !== "none") parts.push(`Urgency: ${c.urgencyLevel}`);
        if (c.tags?.length) parts.push(`Tags: ${c.tags.join(", ")}`);
        return parts.join(" | ");
      })
      .join("\n");

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a productivity coach helping prioritize tasks for today.

Today's date: ${today}
WIP limit (max concurrent tasks): ${wipLimit ?? 3}
Tasks completed today: ${completedToday ?? 0}
Average task completion time: ${avgCycleTime ? `${Math.round(avgCycleTime / 86400000)} days` : "unknown"}

Available tasks:
${cardList}

Select the top 3-5 tasks to focus on today. Consider:
1. OVERDUE tasks (due date < today) - highest priority
2. DUE TODAY tasks - high priority
3. HIGH URGENCY tasks - important
4. Tasks in "doing" column - already started
5. Quick wins (tasks likely to be fast) - good for momentum

Return ONLY valid JSON:
{
  "suggestions": [
    { "cardId": "id", "reason": "Brief reason (e.g., 'Overdue by 2 days', 'Due today', 'Quick win')", "priority": 1 }
  ],
  "insight": "Optional helpful insight about today's workload"
}

Priority: 1 = do first, 2 = do second, 3 = do third
Limit to ${wipLimit ?? 3}-5 suggestions max.`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let result: DailyFocusResponse = { suggestions: [] };
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      result = JSON.parse(cleaned);
    } catch {
      // Fallback: return top cards by urgency
      const sorted = availableCards.sort((a, b) => {
        const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
        return (urgencyOrder[a.urgencyLevel as keyof typeof urgencyOrder] ?? 4) -
               (urgencyOrder[b.urgencyLevel as keyof typeof urgencyOrder] ?? 4);
      });
      result = {
        suggestions: sorted.slice(0, 3).map((c, i) => ({
          cardId: c.id,
          reason: c.urgencyLevel !== "none" ? `${c.urgencyLevel} priority` : "Available task",
          priority: (i + 1) as 1 | 2 | 3,
        })),
      };
    }

    // Validate suggestions reference real cards
    result.suggestions = result.suggestions.filter((s) =>
      availableCards.some((c) => c.id === s.cardId)
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("AI daily-focus error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
