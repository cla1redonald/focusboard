/**
 * Adapter body-reserialization (api/index.ts). The Vercel (req,res)→app.fetch
 * adapter is NEVER exercised by the route tests — they call app.request()
 * directly with a real Web Request, bypassing this layer. That blind spot let
 * a form-body bug reach prod: Vercel pre-parses x-www-form-urlencoded into an
 * object, the adapter re-serialized it as JSON while keeping the form
 * content-type, and every OAuth login/token POST parsed to empty fields. These
 * unit tests pin the reserialization so that can't regress.
 */
import { describe, it, expect } from "vitest";
import { reserializeBody } from "./index.js";

describe("reserializeBody — Vercel pre-parsed body → declared content-type", () => {
  it("form-urlencoded object → urlencoded string (NOT JSON)", () => {
    const r = reserializeBody(
      { client_id: "abc", redirect_uri: "https://x.com/cb", grant_type: "authorization_code" },
      "application/x-www-form-urlencoded"
    );
    expect(r.setContentType).toBeUndefined();
    const parsed = new URLSearchParams(r.body);
    expect(parsed.get("client_id")).toBe("abc");
    expect(parsed.get("redirect_uri")).toBe("https://x.com/cb");
    expect(parsed.get("grant_type")).toBe("authorization_code");
    // Must NOT be JSON — the original bug produced a JSON string under a form CT.
    expect(r.body.startsWith("{")).toBe(false);
  });

  it("form-urlencoded with charset suffix is still treated as form", () => {
    const r = reserializeBody({ a: "1" }, "application/x-www-form-urlencoded; charset=UTF-8");
    expect(new URLSearchParams(r.body).get("a")).toBe("1");
  });

  it("json object → JSON string, content-type preserved", () => {
    const r = reserializeBody({ content: "hi" }, "application/json");
    expect(JSON.parse(r.body)).toEqual({ content: "hi" });
    expect(r.setContentType).toBeUndefined();
  });

  it("object with no content-type → JSON + sets application/json", () => {
    const r = reserializeBody({ x: 1 }, null);
    expect(JSON.parse(r.body)).toEqual({ x: 1 });
    expect(r.setContentType).toBe("application/json");
  });

  it("string body passes through untouched", () => {
    const r = reserializeBody("already-a-string", "text/plain");
    expect(r.body).toBe("already-a-string");
    expect(r.setContentType).toBeUndefined();
  });

  it("coerces non-string form values", () => {
    const r = reserializeBody({ n: 42, b: true }, "application/x-www-form-urlencoded");
    const p = new URLSearchParams(r.body);
    expect(p.get("n")).toBe("42");
    expect(p.get("b")).toBe("true");
  });
});
