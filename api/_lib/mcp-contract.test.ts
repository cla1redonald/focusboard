/**
 * MCP surface contract test — runs locally only.
 *
 * Asserts that the hosted MCP tool names (api/_lib/mcp-server.ts HOSTED_TOOLS)
 * exactly match the CLI stdio server tool names (cli/src/mcp-tools.ts MCP_TOOLS)
 * so the two surfaces cannot drift.
 *
 * This test intentionally imports cli/src/mcp-tools.ts — the no-cli-import rule
 * applies to api/ RUNTIME code only; tests are explicitly allowed to cross the
 * boundary for contract verification.
 *
 * Note: the cli/src/mcp-tools.ts import uses Zod (a cli-only dep). Vitest runs
 * this in Node so the import works fine locally; the api Vercel build excludes
 * test files.
 */

import { describe, it, expect } from "vitest";
import { HOSTED_TOOLS } from "./mcp-server.js";
// CLI imports are allowed in tests.
 
// @ts-expect-error — cli/ is not in the api tsconfig; the import works at runtime.
import { MCP_TOOLS } from "../../cli/src/mcp-tools.js";

describe("MCP surface contract: hosted tools mirror CLI tools", () => {
  it("hosted tool names == CLI tool names (same set, order may differ)", () => {
    const hostedNames = new Set(HOSTED_TOOLS.map((t: { name: string }) => t.name));
    const cliNames = new Set(
      (MCP_TOOLS as { name: string }[]).map((t) => t.name)
    );

    // Tools in CLI but missing from hosted surface.
    const missingFromHosted = [...cliNames].filter((n) => !hostedNames.has(n));
    // Tools in hosted surface but not in CLI.
    const missingFromCli = [...hostedNames].filter((n) => !cliNames.has(n));

    expect(
      missingFromHosted,
      `CLI tools missing from hosted MCP surface: ${missingFromHosted.join(", ")}`
    ).toEqual([]);

    expect(
      missingFromCli,
      `Hosted MCP tools not in CLI registry: ${missingFromCli.join(", ")}`
    ).toEqual([]);
  });

  it("total tool count matches", () => {
    expect(HOSTED_TOOLS.length).toBe((MCP_TOOLS as unknown[]).length);
  });
});
