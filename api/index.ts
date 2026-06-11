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

/**
 * Re-serialize Vercel's pre-parsed `req.body` to match its DECLARED content-type.
 * Vercel parses BOTH application/json and application/x-www-form-urlencoded into
 * an object; serializing a form object as JSON (but keeping the form
 * content-type) makes the downstream parser read empty fields. Exported for the
 * adapter regression test — the adapter itself is never hit by route tests
 * (they call app.request directly), which is exactly how the form-body bug
 * reached prod undetected.
 *
 * Returns the body string to send and (possibly) a content-type to set.
 */
export function reserializeBody(
  reqBody: unknown,
  contentType: string | null
): { body: string; setContentType?: string } {
  if (typeof reqBody === "string") return { body: reqBody };
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(reqBody as Record<string, unknown>)) {
      params.set(k, typeof v === "string" ? v : String(v));
    }
    return { body: params.toString() };
  }
  return {
    body: JSON.stringify(reqBody),
    ...(contentType ? {} : { setContentType: "application/json" }),
  };
}

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
    // Vercel's Node runtime PRE-PARSES the body into req.body: a JSON object
    // for application/json, AND a plain object for application/x-www-form-
    // urlencoded. We must re-serialize to match the DECLARED content-type, or
    // the Hono handler's parser reads the wrong format. (A form body
    // re-serialized as JSON but still labelled form-urlencoded parses to empty
    // fields — which silently broke every OAuth login/token POST in prod, while
    // tests that call app.request() directly bypass this adapter and pass.)
    const r = reserializeBody(req.body, headers.get("content-type"));
    body = r.body;
    if (r.setContentType) headers.set("content-type", r.setContentType);
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
