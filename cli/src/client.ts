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

// ── Phase 5a: focus history, review digests, batch capture ─────────────────────

export type FocusAggregates = {
  sessionCount: number;
  totalMinutes: number;
  byOutcome: Record<string, number>;
};

export type FocusHistoryData = FocusAggregates & {
  days: number;
  byDay: Record<string, { sessionCount: number; minutes: number }>;
  sessions: {
    id: string;
    cardId: string | null;
    cardTitle: string;
    plannedMinutes: number;
    startedAt: string;
    endedAt: string;
    outcome: FocusOutcome;
    note?: string;
  }[];
};

export type DigestCard = SlimCard & { version: number | null };

export type CompletedCardMetric = {
  cardId: string;
  title: string;
  completedAt: string;
  leadTimeMs: number;
  cycleTimeMs: number;
};

export type ReviewDailyData = {
  date: string;
  isComplete: boolean;
  completedToday: CompletedCardMetric[];
  focus: FocusAggregates;
  slipped: DigestCard[];
  blocked: DigestCard[];
  stale: DigestCard[];
  tomorrowCandidates: DigestCard[];
};

export type ReviewWeeklyData = {
  weekKey: string;
  isComplete: boolean;
  completedThisWeek: CompletedCardMetric[];
  focus: FocusAggregates;
  blocked: DigestCard[];
  staleBacklog: DigestCard[];
  proposedCommitments: DigestCard[];
};

export type BatchCaptureData = {
  total: number;
  captured: number;
  results: { index: number; ok: boolean; captureId?: string; duplicate?: boolean; error?: string }[];
};

export type BatchMoveData = {
  total: number;
  moved: number;
  results: { id: string; title: string; to: string; ok: boolean; version?: number | null; error?: string }[];
};

// ── Phase 6.1: durable confirmation gate ───────────────────────────────────────

export type ConfirmationCreateData = {
  confirm_token: string;
  expires_in_seconds: number;
  preview: string;
};

export type ConfirmationPayload = {
  status: "confirmation_required";
  confirm_token: string;
  expires_in_seconds: number;
  preview: string;
  hint: string;
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

  cardGet(id: string): Promise<{ card: SlimCard & { version: number | null; archived?: boolean } }> {
    return this.request("GET", `/api/cards/${encodeURIComponent(id)}`);
  }

  cardAdd(fields: {
    title: string;
    column?: string;
    swimlane?: string;
    dueDate?: string;
    tags?: string[];
    notes?: string;
  }): Promise<{ card: SlimCard & { version: number } }> {
    return this.request("POST", "/api/cards", fields);
  }

  /** version: a number = compare-and-swap; null = deliberately skip the check. */
  cardPatch(
    id: string,
    version: number | null,
    fields: { title?: string; notes?: string | null; dueDate?: string | null; tags?: string[]; blockedReason?: string | null }
  ): Promise<{ card: SlimCard & { version: number | null } }> {
    return this.request("PATCH", `/api/cards/${encodeURIComponent(id)}`, { version, ...fields });
  }

  cardMove(id: string, version: number | null, column: string): Promise<{ card: SlimCard & { version: number | null } }> {
    return this.request("POST", `/api/cards/${encodeURIComponent(id)}/move`, { version, column });
  }

  cardDone(id: string, version: number | null): Promise<{ card: SlimCard & { version: number | null } }> {
    return this.request("POST", `/api/cards/${encodeURIComponent(id)}/done`, { version });
  }

  /**
   * Batch move (Phase 5b): up to 20 moves, validated together server-side,
   * executed as sequential per-card CAS with honest partial results.
   */
  cardBatchMove(moves: { id: string; to: string }[]): Promise<BatchMoveData> {
    return this.request("POST", "/api/cards/batch-move", { moves });
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

  focusHistory(days?: number): Promise<FocusHistoryData> {
    const qs = days ? `?days=${days}` : "";
    return this.request("GET", `/api/focus/history${qs}`);
  }

  reviewDaily(): Promise<ReviewDailyData> {
    return this.request("GET", "/api/review/daily");
  }

  reviewWeekly(): Promise<ReviewWeeklyData> {
    return this.request("GET", "/api/review/weekly");
  }

  /**
   * Batch capture (Phase 5a). One Idempotency-Key covers the batch — the
   * server derives per-item keys from it, so a network retry with the SAME
   * key re-inserts nothing.
   */
  async captureBatch(
    items: string[],
    opts: { source?: string } = {}
  ): Promise<BatchCaptureData> {
    const idempotencyKey = randomUUID();
    const body = { items: items.map((content) => ({ content, source: opts.source ?? "in_app" })) };
    try {
      return await this.request("POST", "/api/capture/batch", body, {
        "Idempotency-Key": idempotencyKey,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "NETWORK") {
        return await this.request("POST", "/api/capture/batch", body, {
          "Idempotency-Key": idempotencyKey,
        });
      }
      throw err;
    }
  }

  // ── Phase 6.1: durable confirmation gate ─────────────────────────────────────

  /**
   * Propose a Tier-3 operation. Returns the confirm token and preview so the
   * caller can display the confirmation_required payload to the agent.
   */
  async confirmationCreate(
    tool: string,
    args: Record<string, unknown>,
    preview: string
  ): Promise<ConfirmationCreateData> {
    return this.request("POST", "/api/confirmations", { tool, args, preview });
  }

  /**
   * Claim and execute a previously proposed operation.
   * Returns the executed route's response data on success.
   */
  async confirmationExecute(confirmToken: string): Promise<unknown> {
    return this.request("POST", "/api/confirmations/confirm", { confirm_token: confirmToken });
  }

  snooze(captureId: string, minutes: number): Promise<{ captureId: string; snoozedUntil: string }> {
    return this.request("POST", `/api/capture/${encodeURIComponent(captureId)}/snooze`, { minutes });
  }

  dismiss(captureId: string): Promise<{ captureId: string }> {
    return this.request("POST", `/api/capture/${encodeURIComponent(captureId)}/dismiss`);
  }
}
