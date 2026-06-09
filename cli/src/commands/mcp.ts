import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FocusboardClient, ApiError } from "../client.js";
import { saveAliases } from "../aliases.js";

/**
 * The Focusboard MCP server (local stdio) — Tier 1 capture-safe tools only.
 *
 * Naming convention (from the design review): read tools are focusboard_<noun>,
 * write tools are focusboard_<verb>_<noun> — the read/write split is visible in
 * the name. All tools go through the same FocusboardClient as the CLI; the agent
 * never touches Supabase. Tier 2 (read-board) arrives with Phase 2, Tier 3
 * (board mutation + confirmation gate) with Phase 4.
 *
 * Run: `fb mcp` — e.g. `claude mcp add focusboard -- fb mcp`.
 * Auth: FOCUSBOARD_TOKEN env var, or the CLI credentials file (`fb auth login`).
 */

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function okResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }] };
}

function errResult(err: unknown): ToolResult {
  const error =
    err instanceof ApiError
      ? { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
      : { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
    isError: true,
  };
}

export async function mcpCommand() {
  const client = new FocusboardClient();
  const server = new McpServer({ name: "focusboard", version: "0.1.0" });

  server.registerTool(
    "focusboard_capture",
    {
      title: "Capture to Focusboard",
      description:
        "Capture a raw thought, task, or note into the Focusboard inbox. Append-only and safe: " +
        "nothing is added to the board automatically — Claire triages captures in the Capture Inbox. " +
        "Use one call per distinct item.",
      inputSchema: {
        content: z.string().min(1).max(10000).describe("The raw text to capture"),
      },
    },
    async ({ content }) => {
      try {
        const result = await client.capture(content, { source: "in_app" });
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_inbox",
    {
      title: "List the Focusboard capture inbox",
      description:
        "List pending captures in the Focusboard inbox (snoozed items are hidden until due). " +
        "Returns each capture's id, raw content, AI-parsed title (if processed), source, and timestamps. " +
        "Use the id with focusboard_snooze_capture.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.inbox();
        saveAliases(result.items.map((i) => i.id)); // keep CLI aliases in sync
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_snooze_capture",
    {
      title: "Snooze a Focusboard capture",
      description:
        "Hide a capture from the inbox until a later time (it returns automatically when due). " +
        "Get capture ids from focusboard_inbox first.",
      inputSchema: {
        capture_id: z.string().uuid().describe("The capture id (a UUID, from focusboard_inbox)"),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(43200)
          .default(60)
          .describe("How long to snooze, in minutes (max 30 days)"),
      },
    },
    async ({ capture_id, minutes }) => {
      try {
        const result = await client.snooze(capture_id, minutes);
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio server runs until the client disconnects — keep the process alive.
  await new Promise(() => {});
}
