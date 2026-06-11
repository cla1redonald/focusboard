/**
 * api/index.ts — the single Hono entry point (Node runtime).
 *
 * Routing: this was api/[...path].ts, but Vercel's filesystem router only matched it
 * for SINGLE-segment paths (/api/capture reached it; /api/capture/:id/snooze got the
 * platform 404 — the function was never invoked). The fix is the documented
 * Hono-on-Vercel pattern: this file is api/index.ts and vercel.json rewrites
 * /api/(.*) → /api, which invokes this function for every /api path that no literal
 * function file matches. The rewrite only selects the function — req.url keeps the
 * ORIGINAL path, which is what the Hono router matches on.
 *
 * All route logic lives in api/_lib/hono-app.ts (importable by tests via app.fetch).
 * This file bridges Vercel's Node (req, res) model ↔ Hono's Web Request/Response:
 * `hono/vercel`'s handle() returns a WEB handler, which Vercel's Node runtime never
 * invokes correctly (it calls (req, res)) → the response is never sent → 504 timeout.
 * We stay on the Node runtime deliberately because PAT hashing uses node:crypto
 * (createHash / timingSafeEqual), which the Edge runtime does not provide.
 *
 * Legacy functions (api/capture/process.ts, api/ai/*, api/feedback/submit.ts,
 * api/webhook/add-card.ts) remain untouched — Vercel matches literal function files
 * BEFORE rewrites, so they keep working unchanged.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { app, server } from "./_lib/hono-app.js";

// Re-export both: `server` is the composed well-known+app handler (used by the
// Vercel function entry point); `app` is the /api basePath app (used by tests
// that import api/_lib/hono-app.ts directly — those keep working unchanged).
export { app, server };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = req.headers.host ?? "localhost";
  const url = `${proto}://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (typeof value === "string") headers.set(key, value);
  }

  const method = (req.method ?? "GET").toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && req.body != null) {
    // Vercel's Node runtime pre-parses JSON bodies into req.body (an object).
    // Re-serialize so the Hono handlers can read them via c.req.json().
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (typeof req.body !== "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  // Use `server.fetch` (the composed well-known + app handler) so that
  // /.well-known/* requests are handled correctly. `app.fetch` is also
  // re-exported for tests that import api/_lib/hono-app.ts directly.
  const response = await server.fetch(new Request(url, { method, headers, body }));

  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return; // let Vercel set it
    res.setHeader(key, value);
  });
  res.send(await response.text());
}
