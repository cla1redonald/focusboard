import { randomUUID } from "node:crypto";
import { loadCredentials, apiUrl, type Credentials } from "./config.js";

/**
 * The shared Focusboard API client — the ONE place that knows endpoints, the
 * Authorization header, the response envelope, and error mapping. Both the CLI
 * commands and the MCP tools call through here; neither touches Supabase.
 *
 * Server contract (api/_lib/envelope.ts):
 *   success: { ok: true,  data }
 *   failure: { ok: false, error: { code, message, hint? } }
 */

export type ApiErrorBody = { code: string; message: string; hint?: string };

export class ApiError extends Error {
  code: string;
  hint?: string;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.hint = body.hint;
  }
}

export class NotAuthenticatedError extends ApiError {}

export type CaptureItem = {
  id: string;
  raw_content: string;
  source: string;
  status: string;
  created_at: string;
  snoozed_until: string | null;
  confidence: number | null;
  parsed_cards: { title?: string }[] | null;
  processed_at: string | null;
};

export type Me = { userId: string; kind: string; scopes: string[] };

export type SlimCard = {
  id: string;
  title: string;
  column: string;
  swimlane: string;
  order: number;
  dueDate?: string;
  tags: string[];
  blockedReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type TodayData = {
  date: string;
  activeCount: number;
  dailyPlan: {
    main: SlimCard | null;
    support: SlimCard[];
    completedCount: number;
    plannedCount: number;
  };
  recommendations: { card: SlimCard; reasons: string[]; score: number }[];
  attention: {
    overdue: SlimCard[];
    dueToday: SlimCard[];
    blocked: SlimCard[];
    stale: SlimCard[];
  };
  wipPressure: { column: string; columnTitle: string; count: number; limit: number }[];
};

export type CardsData = {
  total: number;
  items: SlimCard[];
  columns: { id: string; title: string; wipLimit: number | null; isTerminal: boolean }[];
};

export type FocusOutcome = "progressed" | "blocked" | "completed" | "abandoned";

export type ActiveFocusSession = {
  id: string;
  cardId: string | null;
  cardTitle: string | null;
  plannedMinutes: number;
  startedAt: string;
  source?: string;
};

export type FocusStatusData = {
  active: ActiveFocusSession | null;
  today: { sessions: number; focusedMinutes: number };
};

export type StoppedFocusSession = ActiveFocusSession & {
  actualMinutes: number;
  endedAt: string;
  outcome: FocusOutcome;
};

export type WipData = {
  columns: {
    id: string;
    title: string;
    count: number;
    limit: number | null;
    atLimit: boolean;
    isTerminal: boolean;
  }[];
  activeCount: number;
};

export class FocusboardClient {
  private baseUrl: string;
  private token: string | null;

  constructor(creds?: Credentials | null, baseUrlOverride?: string) {
    const resolved = creds === undefined ? loadCredentials() : creds;
    this.token = resolved?.token ?? null;
    this.baseUrl = (baseUrlOverride ?? apiUrl(resolved)).replace(/\/+$/, "");
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    if (!this.token) {
      throw new NotAuthenticatedError(401, {
        code: "NOT_AUTHENTICATED",
        message: "No API token configured",
        hint: "Run `fb auth login` (create a token in Focusboard Settings → API Tokens)",
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...extraHeaders,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError(0, {
        code: "NETWORK",
        message: `Could not reach Focusboard at ${this.baseUrl}`,
        hint: err instanceof Error ? err.message : "Check your connection and FOCUSBOARD_API_URL",
      });
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new ApiError(res.status, {
        code: "BAD_RESPONSE",
        message: `Unexpected non-JSON response (HTTP ${res.status})`,
        hint: "The API URL may be pointing at the web app, not the API",
      });
    }

    const envelope = parsed as { ok?: boolean; data?: T; error?: ApiErrorBody };
    if (res.ok && envelope.ok === true && envelope.data !== undefined) {
      return envelope.data;
    }

    const errBody: ApiErrorBody = envelope.error ?? {
      code: "BAD_RESPONSE",
      message: `Unexpected response shape (HTTP ${res.status})`,
    };
    if (res.status === 401) {
      throw new NotAuthenticatedError(res.status, {
        ...errBody,
        hint:
          errBody.hint ??
          "Token rejected (revoked or mistyped) — run `fb auth login` with a fresh token from Settings → API Tokens",
      });
    }
    throw new ApiError(res.status, errBody);
  }

  me(): Promise<Me> {
    return this.request<Me>("GET", "/api/me");
  }

  /**
   * Capture raw text. Sends an Idempotency-Key and retries once on a network
   * failure with the SAME key, so a flaky connection can't double-capture.
   */
  async capture(
    content: string,
    opts: { source?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<{ captureId: string; duplicate?: boolean; source?: string }> {
    const idempotencyKey = randomUUID();
    const body = {
      content,
      source: opts.source ?? "in_app",
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    };
    try {
      return await this.request("POST", "/api/capture", body, {
        "Idempotency-Key": idempotencyKey,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "NETWORK") {
        return await this.request("POST", "/api/capture", body, {
          "Idempotency-Key": idempotencyKey,
        });
      }
      throw err;
    }
  }

  async inbox(): Promise<{ items: CaptureItem[]; total: number }> {
    return this.request("GET", "/api/capture");
  }

  today(): Promise<TodayData> {
    return this.request("GET", "/api/today");
  }

  cards(opts: { column?: string; q?: string; swimlane?: string; limit?: number } = {}): Promise<CardsData> {
    const params = new URLSearchParams();
    if (opts.column) params.set("column", opts.column);
    if (opts.q) params.set("q", opts.q);
    if (opts.swimlane) params.set("swimlane", opts.swimlane);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request("GET", `/api/cards${qs ? `?${qs}` : ""}`);
  }

  wip(): Promise<WipData> {
    return this.request("GET", "/api/wip");
  }

  focusStatus(): Promise<FocusStatusData> {
    return this.request("GET", "/api/focus/status");
  }

  focusStart(opts: { cardId?: string; plannedMinutes?: number } = {}): Promise<ActiveFocusSession> {
    return this.request("POST", "/api/focus/start", {
      ...(opts.cardId ? { cardId: opts.cardId } : {}),
      ...(opts.plannedMinutes ? { plannedMinutes: opts.plannedMinutes } : {}),
    });
  }

  focusStop(opts: { outcome?: FocusOutcome; note?: string } = {}): Promise<StoppedFocusSession> {
    return this.request("POST", "/api/focus/stop", {
      outcome: opts.outcome ?? "progressed",
      ...(opts.note ? { note: opts.note } : {}),
    });
  }

  snooze(captureId: string, minutes: number): Promise<{ captureId: string; snoozedUntil: string }> {
    return this.request("POST", `/api/capture/${encodeURIComponent(captureId)}/snooze`, { minutes });
  }

  dismiss(captureId: string): Promise<{ captureId: string }> {
    return this.request("POST", `/api/capture/${encodeURIComponent(captureId)}/dismiss`);
  }
}
