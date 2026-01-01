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
  swimlane: string;
};

type PlanSuggestion = {
  cardId: string;
  suggestedDate: string;
  reason: string;
};

type WeeklyPlanResponse = {
  suggestions: PlanSuggestion[];
  weeklyGoal?: string;
  capacityWarning?: string;
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
    const { cards, weekStart, avgThroughput, existingCommitments } = req.body || {};

    if (!cards || !Array.isArray(cards)) {
      return res.status(400).json({ error: "Cards array is required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    // Filter to unscheduled cards (no due date, not blocked, not done)
    const unscheduledCards = (cards as CardInput[]).filter(
      (c) => !c.dueDate && c.column !== "blocked" && c.column !== "done"
    );

    // Filter to scheduled cards for context
    const scheduledCards = (cards as CardInput[]).filter(
      (c) => c.dueDate && c.column !== "done"
    );

    if (unscheduledCards.length === 0) {
      return res.status(200).json({
        success: true,
        suggestions: [],
        weeklyGoal: "All tasks are already scheduled!",
      });
    }

    const client = new Anthropic({ apiKey });

    // Calculate week dates
    const weekStartDate = weekStart ? new Date(weekStart) : getMonday(new Date());
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + i);
      weekDays.push(date.toISOString().split("T")[0]);
    }

    // Format existing commitments
    const commitmentsByDay: Record<string, number> = {};
    for (const day of weekDays) {
      commitmentsByDay[day] = scheduledCards.filter((c) => c.dueDate === day).length;
    }
    if (existingCommitments) {
      for (const c of existingCommitments) {
        if (commitmentsByDay[c.date] !== undefined) {
          commitmentsByDay[c.date] += c.count;
        }
      }
    }

    // Format cards for the prompt
    const unscheduledList = unscheduledCards
      .map((c) => `- ID: ${c.id} | Title: "${c.title}" | Column: ${c.column} | Swimlane: ${c.swimlane}`)
      .join("\n");

    const commitmentsList = weekDays
      .map((day) => `${day}: ${commitmentsByDay[day]} tasks`)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `You are a productivity coach helping plan the week ahead.

Week: ${weekDays[0]} to ${weekDays[6]}
Average weekly throughput: ${avgThroughput ?? 5} tasks/week

Current scheduled commitments by day:
${commitmentsList}

Unscheduled tasks to plan:
${unscheduledList}

Assign due dates to the unscheduled tasks for this week. Consider:
1. Balance workload across days (aim for ${Math.ceil((avgThroughput ?? 5) / 5)} tasks/day max)
2. Don't overload days with existing commitments
3. Leave buffer for urgent work (don't fill every day)
4. Work tasks (swimlane: work) should be weekdays, personal on any day
5. Spread similar tasks across different days

Return ONLY valid JSON:
{
  "suggestions": [
    { "cardId": "id", "suggestedDate": "YYYY-MM-DD", "reason": "Brief reason" }
  ],
  "weeklyGoal": "Complete X tasks focusing on [main theme]",
  "capacityWarning": "Only include if a day has 4+ tasks scheduled"
}

Suggest dates for up to 7 tasks. Prioritize based on column (doing > todo > backlog).`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let result: WeeklyPlanResponse = { suggestions: [] };
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      result = JSON.parse(cleaned);
    } catch {
      // Fallback: distribute tasks evenly across weekdays
      const weekdays = weekDays.slice(0, 5); // Mon-Fri
      result = {
        suggestions: unscheduledCards.slice(0, 5).map((c, i) => ({
          cardId: c.id,
          suggestedDate: weekdays[i % weekdays.length],
          reason: "Evenly distributed",
        })),
        weeklyGoal: `Complete ${Math.min(unscheduledCards.length, 5)} tasks this week`,
      };
    }

    // Validate suggestions reference real cards and valid dates
    result.suggestions = result.suggestions.filter((s) =>
      unscheduledCards.some((c) => c.id === s.cardId) &&
      weekDays.includes(s.suggestedDate)
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("AI weekly-plan error:", err);
    return res.status(500).json({ error: String(err) });
  }
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
