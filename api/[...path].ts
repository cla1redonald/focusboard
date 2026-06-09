/**
 * api/[...path].ts — Hono catch-all Vercel entry point.
 *
 * All route logic lives in api/_lib/hono-app.ts (importable by tests).
 * This file is the Vercel serverless function entry: it calls handle(app)
 * to bridge Hono ↔ Vercel's req/res model.
 *
 * Legacy functions (api/capture/process.ts, api/ai/*, api/feedback/submit.ts,
 * api/webhook/add-card.ts) remain untouched. Vercel routes specific function
 * files BEFORE the catch-all, so they continue to work unchanged.
 */

import { handle } from "hono/vercel";
import { app } from "./_lib/hono-app.js";

export { app };
export default handle(app);
