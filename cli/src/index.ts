#!/usr/bin/env node
import { Command } from "commander";
import { configureOutput, printError } from "./output.js";
import { captureCommand } from "./commands/capture.js";
import { inboxCommand, dismissCommand } from "./commands/inbox.js";
import { snoozeCommand } from "./commands/snooze.js";
import { loginCommand, statusCommand, logoutCommand } from "./commands/auth.js";
import { mcpCommand } from "./commands/mcp.js";

/**
 * fb — the Focusboard CLI.
 *
 * Phase 1 (capture-first): capture / inbox / snooze / auth, plus `fb mcp` which
 * serves the same operations to AI agents over stdio. Everything calls the
 * Focusboard API through the shared client — never Supabase directly.
 */

const program = new Command();

program
  .name("fb")
  .description("Focusboard from the command line — capture fast, triage later")
  .version("0.1.0")
  .option("--json", "machine-readable output (full IDs, no truncation)")
  .option("-q, --quiet", "minimal output (IDs only)")
  .option("--no-color", "disable colour (also respects NO_COLOR and non-TTY)")
  .hook("preAction", (cmd) => {
    const opts = cmd.opts<{ json?: boolean; quiet?: boolean; color?: boolean }>();
    configureOutput({ json: opts.json, quiet: opts.quiet, noColor: opts.color === false });
  });

function run(action: (...args: never[]) => Promise<void> | void) {
  return async (...args: unknown[]) => {
    try {
      await action(...(args as never[]));
    } catch (err) {
      process.exitCode = printError(err);
    }
  };
}

program
  .command("capture")
  .description("capture a raw thought into the Focusboard inbox")
  .argument("<text...>", "the thing to capture (quotes optional)")
  .option("--source <source>", "capture source", "in_app")
  .action(run(captureCommand));

const inbox = program
  .command("inbox")
  .description("list pending captures (snoozed items hidden until due)")
  .action(run(inboxCommand));

inbox
  .command("dismiss")
  .description("dismiss a capture (it will not become a card)")
  .argument("<id>", "capture id or cap-N alias from fb inbox")
  .action(run(dismissCommand));

program
  .command("snooze")
  .description("snooze a capture — it returns to the inbox when due")
  .argument("<id>", "capture id or cap-N alias from fb inbox")
  .option("--for <duration>", "how long: 90, 90m, 2h, 3d (default 60m)")
  .option("--minutes <minutes>", "alias for --for, in minutes")
  .action(run(snoozeCommand));

const auth = program.command("auth").description("manage CLI authentication");

auth
  .command("login")
  .description("store an API token (create one in Settings → API Tokens)")
  .option("--token <token>", "the fb_pat_… token (omit to paste interactively, hidden)")
  .option("--api-url <url>", "override the Focusboard API base URL")
  .action(run(loginCommand));

auth
  .command("status")
  .description("show whether the stored token works (never prints the token)")
  .action(run(statusCommand));

auth
  .command("logout")
  .description("remove the stored credentials")
  .action(run(logoutCommand));

program
  .command("mcp")
  .description("serve Focusboard tools to AI agents over stdio (MCP)")
  .action(run(mcpCommand));

program.parseAsync().catch((err) => {
  process.exitCode = printError(err);
});
