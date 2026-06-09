import { createInterface } from "node:readline";
import { FocusboardClient, NotAuthenticatedError } from "../client.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  apiUrl,
  DEFAULT_API_URL,
} from "../config.js";
import { info, isJson, printJson, paint, warn } from "../output.js";

/** Prompt for the token without echoing it to the terminal. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const write = (rl as unknown as { _writeToOutput?: (s: string) => void });
    process.stderr.write(question);
    write._writeToOutput = () => {}; // swallow echo — never show the token
    rl.question("", (answer) => {
      write._writeToOutput = undefined as never;
      process.stderr.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function loginCommand(opts: { token?: string; apiUrl?: string }) {
  let token = opts.token?.trim();
  if (!token) {
    if (!process.stdin.isTTY) {
      throw new Error(
        "No token provided — pass --token <fb_pat_…>, or run interactively. Create one in Focusboard → Settings → API Tokens."
      );
    }
    info("Create a token in Focusboard → Settings → API Tokens, then paste it below.");
    token = await promptHidden("Token (input hidden): ");
  }
  if (!token.startsWith("fb_pat_")) {
    throw new Error('That does not look like a Focusboard token (expected the "fb_pat_" prefix)');
  }

  const base = opts.apiUrl?.trim() || process.env.FOCUSBOARD_API_URL?.trim() || DEFAULT_API_URL;
  const client = new FocusboardClient({ token }, base);
  const me = await client.me(); // validates before saving

  const path = saveCredentials({
    token,
    ...(base !== DEFAULT_API_URL ? { apiUrl: base } : {}),
  });

  if (isJson()) {
    printJson({ userId: me.userId, scopes: me.scopes, credentialsPath: path });
    return;
  }
  info(`${paint("✓", "green")} Logged in (scopes: ${me.scopes.join(", ")})`);
  info(paint(`Token stored at ${path} (0600)`, "dim"));
}

export async function statusCommand() {
  const creds = loadCredentials();
  const fromEnv = Boolean(process.env.FOCUSBOARD_TOKEN?.trim());
  if (!creds) {
    throw new NotAuthenticatedError(401, {
      code: "NOT_AUTHENTICATED",
      message: "Not logged in",
      hint: "Run `fb auth login` (create a token in Focusboard Settings → API Tokens)",
    });
  }

  const client = new FocusboardClient(creds);
  try {
    const me = await client.me();
    if (isJson()) {
      printJson({ ...me, source: fromEnv ? "env" : "file", apiUrl: apiUrl(creds) });
      return;
    }
    info(`${paint("✓", "green")} Authenticated (${fromEnv ? "FOCUSBOARD_TOKEN env" : "credentials file"})`);
    info(`  scopes: ${me.scopes.join(", ")}`);
    info(`  api:    ${apiUrl(creds)}`);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      err.hint = "The stored token was rejected — it may be revoked. Run `fb auth login` with a fresh token.";
    }
    throw err;
  }
}

export function logoutCommand() {
  const removed = clearCredentials();
  if (process.env.FOCUSBOARD_TOKEN?.trim()) {
    warn("FOCUSBOARD_TOKEN is set in your environment — unset it too, or it will still be used.");
  }
  if (isJson()) {
    printJson({ removed });
    return;
  }
  info(removed ? `${paint("✓", "green")} Logged out — credentials removed` : "Nothing to remove — not logged in.");
}
