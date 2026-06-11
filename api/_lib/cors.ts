import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Allowed origins for CORS
 * Includes production, preview, and local development
 */
const ALLOWED_ORIGINS = [
  "https://focusboard.vercel.app",
  "https://focusboard-alpha.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

// Account-scoped suffix (Claire's Vercel team slug — globally unique, not
// attacker-registrable). The earlier `.endsWith(".vercel.app")` admitted any
// focusboard-*.vercel.app an attacker could register (OWASP A05).
const FOCUSBOARD_VERCEL_SUFFIX = "-claire-donalds-projects.vercel.app";

// Hostname-parsed, not substring-matched — a substring check admits
// https://focusboard.vercel.app.evil.com.
function isFocusboardVercelOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" &&
      hostname.startsWith("focusboard") &&
      hostname.endsWith(FOCUSBOARD_VERCEL_SUFFIX)
    );
  } catch {
    return false;
  }
}

/**
 * Set CORS headers with proper origin validation
 * Only allows requests from known origins
 */
export function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers.origin as string | undefined;

  // Check if origin is allowed (exact match or Vercel preview deploy)
  const isAllowed = origin && (ALLOWED_ORIGINS.includes(origin) || isFocusboardVercelOrigin(origin));

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

/**
 * Handle preflight OPTIONS request
 * Returns true if this was a preflight request (caller should return early)
 */
export function handlePreflight(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}
