import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FocusboardClient, ApiError, NotAuthenticatedError } from "./client.js";

const BASE = "https://fb.test";

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("FocusboardClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the Bearer token and unwraps the success envelope", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, data: { items: [], total: 0 } });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FocusboardClient({ token: "fb_pat_test" }, BASE);
    const result = await client.inbox();

    expect(result).toEqual({ items: [], total: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/capture`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fb_pat_test");
  });

  it("throws NotAuthenticatedError with the server hint on 401", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(401, {
        ok: false,
        error: { code: "NOT_AUTHENTICATED", message: "Missing or invalid credentials" },
      })
    );

    const client = new FocusboardClient({ token: "fb_pat_revoked" }, BASE);
    await expect(client.me()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it("maps error envelopes to ApiError with code + hint", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(429, {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Rate limit exceeded", hint: "Retry in 60 seconds" },
      })
    );

    const client = new FocusboardClient({ token: "fb_pat_test" }, BASE);
    const err = await client.capture("hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("RATE_LIMITED");
    expect((err as ApiError).hint).toBe("Retry in 60 seconds");
  });

  it("throws NOT_AUTHENTICATED locally when no token is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new FocusboardClient(null, BASE);
    const err = await client.inbox().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotAuthenticatedError);
    expect((err as ApiError).hint).toContain("fb auth login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("capture sends an Idempotency-Key and retries ONCE with the same key on network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: { captureId: "cap-uuid" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FocusboardClient({ token: "fb_pat_test" }, BASE);
    const result = await client.capture("retry me");

    expect(result.captureId).toBe("cap-uuid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const key1 = (fetchMock.mock.calls[0]![1].headers as Record<string, string>)["Idempotency-Key"];
    const key2 = (fetchMock.mock.calls[1]![1].headers as Record<string, string>)["Idempotency-Key"];
    expect(key1).toBeTruthy();
    expect(key1).toBe(key2);
  });

  it("snooze posts minutes to the REST path with the encoded id", async () => {
    const fetchMock = mockFetchOnce(200, {
      ok: true,
      data: { captureId: "abc", snoozedUntil: "2026-06-09T20:00:00Z" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FocusboardClient({ token: "fb_pat_test" }, BASE);
    await client.snooze("abc", 90);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/capture/abc/snooze`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ minutes: 90 });
  });

  it("surfaces a BAD_RESPONSE error on non-JSON bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => {
          throw new Error("not json");
        },
      })
    );

    const client = new FocusboardClient({ token: "fb_pat_test" }, BASE);
    const err = await client.inbox().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("BAD_RESPONSE");
  });
});
