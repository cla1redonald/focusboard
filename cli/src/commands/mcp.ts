import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FocusboardClient } from "../client.js";
import { MCP_TOOLS } from "../mcp-tools.js";

/**
 * The Focusboard MCP server (local stdio).
 *
 * Tool definitions live in cli/src/mcp-tools.ts. This file is just wiring:
 * build the server, register tools from the registry, connect the transport.
 *
 * The Tier-3 confirmation gate is now DURABLE — tokens are stored server-side
 * in the mcp_confirmations table (Phase 6.1). The old in-process pendingOps Map
 * is gone. A future stateless hosted MCP server uses the identical gate.
 *
 * Run: `fb mcp` — e.g. `claude mcp add focusboard -- fb mcp`.
 * Auth: FOCUSBOARD_TOKEN env var, or the CLI credentials file (`fb auth login`).
 */

export async function mcpCommand() {
  const client = new FocusboardClient();
  const server = new McpServer({ name: "focusboard", version: "0.1.0" });

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      (args: Parameters<typeof tool.handler>[1]) => tool.handler(client, args)
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio server runs until the client disconnects — keep the process alive.
  await new Promise(() => {});
}
