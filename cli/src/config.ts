import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Credential + config storage for the fb CLI and MCP server.
 *
 * The PAT lives at ~/.config/focusboard/credentials.json with 0600 perms — never
 * in the repo, never printed. Env vars override the file (useful for MCP configs
 * and CI): FOCUSBOARD_TOKEN, FOCUSBOARD_API_URL.
 */

export const DEFAULT_API_URL = "https://focusboard-claire-donalds-projects.vercel.app";

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), ".config"), "focusboard");
}

function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export type Credentials = { token: string; apiUrl?: string };

export function loadCredentials(): Credentials | null {
  const envToken = process.env.FOCUSBOARD_TOKEN;
  if (envToken && envToken.trim()) {
    return { token: envToken.trim(), apiUrl: process.env.FOCUSBOARD_API_URL };
  }
  try {
    const raw = readFileSync(credentialsPath(), "utf8");
    const parsed = JSON.parse(raw) as Credentials;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync mode is ignored if the file already exists
  return path;
}

export function clearCredentials(): boolean {
  const path = credentialsPath();
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function apiUrl(creds: Credentials | null): string {
  return (
    process.env.FOCUSBOARD_API_URL?.trim() ||
    creds?.apiUrl?.trim() ||
    DEFAULT_API_URL
  );
}
