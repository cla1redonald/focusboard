/**
 * Guards for the route→scope enforcement layer.
 *
 * 1. Coverage: every concrete route registered on the app MUST have a ROUTE_SCOPES
 *    entry — a new route without a declared policy fails here, in CI, before it can
 *    fail (closed) in production.
 * 2. Fail-closed: a matched route that is missing from the table is DENIED, not
 *    allowed through.
 * 3. CORS: the origin check is hostname-based, not substring-based.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { app, isAllowedOrigin } from "./hono-app.js";
import { ROUTE_SCOPES, enforceRouteScopes, type AuthEnv } from "./auth-middleware.js";

describe("ROUTE_SCOPES coverage", () => {
  it("every registered route has a policy entry (deny-by-default would 403 it otherwise)", () => {
    const concrete = app.routes.filter(
      (r) => r.method !== "ALL" && !r.path.includes("*")
    );
    expect(concrete.length).toBeGreaterThan(0);
    for (const r of concrete) {
      expect(
        ROUTE_SCOPES[`${r.method} ${r.path}`],
        `Route "${r.method} ${r.path}" is missing from ROUTE_SCOPES — add a policy entry`
      ).toBeDefined();
    }
  });

  it("every ROUTE_SCOPES entry corresponds to a registered route (no stale entries)", () => {
    const registered = new Set(
      app.routes
        .filter((r) => r.method !== "ALL" && !r.path.includes("*"))
        .map((r) => `${r.method} ${r.path}`)
    );
    for (const key of Object.keys(ROUTE_SCOPES)) {
      expect(registered.has(key), `ROUTE_SCOPES entry "${key}" matches no registered route`).toBe(true);
    }
  });
});

describe("enforceRouteScopes — fail-closed", () => {
  it("denies a matched route that has no ROUTE_SCOPES entry (403, not open)", async () => {
    const testApp = new Hono<AuthEnv>().basePath("/api");
    testApp.use("*", enforceRouteScopes);
    testApp.get("/not-in-the-table", (c) => c.text("should never be reached"));

    const res = await testApp.request("/api/not-in-the-table");
    expect(res.status).toBe(403);
    const body = await res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("lets unmatched paths fall through to the router's 404", async () => {
    const testApp = new Hono<AuthEnv>().basePath("/api");
    testApp.use("*", enforceRouteScopes);

    const res = await testApp.request("/api/no-such-route");
    expect(res.status).toBe(404);
  });
});

describe("isAllowedOrigin — hostname-based CORS check", () => {
  it.each([
    "https://focusboard.vercel.app",
    "https://focusboard-alpha.vercel.app",
    "https://focusboard-claire-donalds-projects.vercel.app",
    "https://focusboard-git-some-branch-claire-donalds-projects.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ])("allows %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it.each([
    "https://focusboard.vercel.app.evil.com", // substring-check bypass
    "https://evil.com/focusboard.vercel.app",
    "https://notfocusboard.vercel.app",
    "http://focusboard.vercel.app", // not https
    "https://focusboard.evil.app",
    "not-a-url",
  ])("rejects %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});
