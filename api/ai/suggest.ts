import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { verifySession } from "../_lib/auth.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

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
    const { title, availableTags } = req.body || {};

    if (!title?.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    const client = new Anthropic({ apiKey });

    // Format available tags for the prompt
    const tagList = availableTags?.length
      ? availableTags.map((t: { id: string; name: string }) => t.name).join(", ")
      : "High, Medium, Low, Bug, Feature, Chore, Quick win";

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `Given this task title: "${title}"

Available tags: ${tagList}

Suggest 1-3 appropriate tags that best describe this task. Consider:
- Priority (High/Medium/Low) based on urgency words
- Type (Bug/Feature/Chore) based on task nature
- Effort (Quick win) if it seems simple

Return ONLY a JSON array of tag names, nothing else. Example: ["High", "Bug"]`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    let suggestedTags: string[] = [];
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      suggestedTags = JSON.parse(cleaned);
    } catch {
      // If parsing fails, try to extract tag names
      const matches = text.match(/"([^"]+)"/g);
      if (matches) {
        suggestedTags = matches.map(m => m.replace(/"/g, ""));
      }
    }

    return res.status(200).json({
      success: true,
      suggestedTags,
    });
  } catch (err) {
    console.error("AI suggest error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
