# Supabase Setup

This document covers the Supabase configuration for Focusboard, including database schema, RLS policies, and environment setup.

## Overview

Supabase provides:
- **Authentication** - Email/password and magic link login
- **Database** - PostgreSQL for storing user state, cards, captures, focus sessions, tokens, and OAuth state
- **Real-time** - Live sync between devices (publication includes `app_state`, `cards`, and `capture_queue`)

### Schema at a glance

| Table | Purpose | Source |
|-------|---------|--------|
| `app_state` | Per-user board blob: columns, settings, tags, daily plan (cards array **removed**) | Pre-migrations (see Complete SQL Setup) |
| `metrics` | Per-user analytics blob (focus history **extracted** to `focus_sessions`) | Pre-migrations (see Complete SQL Setup) |
| `cards` | Per-card rows — **sole source of truth for cards** | `20260609230000_cards_mirror.sql`, `20260610100000_web_row_writes.sql`, `20260610130000_retire_blob_cards.sql` |
| `capture_queue` | Universal task ingestion queue for the Capture Hub | `20260207170000_capture_queue.sql` (+ later) |
| `focus_sessions` | Append-only focus session events; one active per user | `20260609220000_focus_sessions.sql` |
| `api_tokens` | Hashed personal access tokens for CLI/MCP | `20260609090000_api_tokens.sql` |
| `mcp_confirmations` | Durable Tier-3 MCP confirmation gate | `20260612090000_mcp_confirmations.sql` |
| `oauth_clients` / `oauth_codes` / `oauth_tokens` / `oauth_login_attempts` | OAuth 2.1 (DCR + PKCE) stub for single-principal MCP auth | `20260612120000_oauth_stub.sql` |

**RPC functions:** `fb_add_card`, `fb_mutate_card` (atomic card writes — see [Card Mutation Functions](#card-mutation-functions)).

> **Migration note:** `app_state` and `metrics` predate the `supabase/migrations/` directory and have no migration file — they are defined in [Complete SQL Setup](#complete-sql-setup). Every other table is defined by a migration; the SQL below is verified against those files. Some migrations (`mcp_confirmations`, `oauth_stub`) are **not applied by CI** and are applied manually per the migration policy in HANDOFF.md.

## Database Schema

### Tables

#### `app_state`

Stores per-user board state: columns, settings, tags, templates, and the daily plan.

> **Cards no longer live here.** The blob's `cards` array was projected to the `cards` table (Phase 4a) and then **stripped entirely** by `20260610130000_retire_blob_cards.sql`. The `cards` table is now the sole source of truth for cards. Readers (web + API) take cards from rows; `app_state` carries only non-card board state.

```sql
CREATE TABLE app_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Primary key, references auth.users |
| `state` | JSONB | Board state (columns, settings, tags, templates, daily plan) — **no `cards` array** |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

#### `metrics`

Stores analytics data for each user.

> **Focus history no longer lives here.** Focus sessions were extracted out of `metrics.focusSessions` into the `focus_sessions` table (Phase 3, `20260609220000_focus_sessions.sql`), which backfilled completed sessions from this blob. New session writes go to `focus_sessions`, not the blob.

```sql
CREATE TABLE metrics (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Primary key, references auth.users |
| `metrics` | JSONB | MetricsState object (focus history extracted to `focus_sessions`) |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

#### `cards`

Per-card rows. **The sole source of truth for cards.** The web client and the API/CLI/MCP both write here directly. Generated columns surface common query keys (`column_id`, `archived`) without re-parsing `card_json`, and `version` powers per-card optimistic locking.

```sql
CREATE TABLE cards (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  card_json  JSONB NOT NULL,
  column_id  TEXT GENERATED ALWAYS AS (card_json->>'column') STORED,
  archived   BOOLEAN GENERATED ALWAYS AS ((card_json ? 'archivedAt')) STORED,
  version    BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX cards_user_column_idx ON cards (user_id, column_id);
```

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | References auth.users; part of composite PK |
| `id` | TEXT | Card id (matches the `id` inside `card_json`); part of composite PK |
| `card_json` | JSONB | The full card object (see [Card Structure](#card-structure)) |
| `column_id` | TEXT | **Generated/stored** from `card_json->>'column'` |
| `archived` | BOOLEAN | **Generated/stored** — true when `card_json` has an `archivedAt` key |
| `version` | BIGINT | Per-card optimistic-lock counter, starts at 1, bumped on every write |
| `updated_at` | TIMESTAMPTZ | Last write timestamp |

Composite primary key is `(user_id, id)`. Replica identity stays at the default (the primary key), so realtime DELETE events carry `(user_id, id)` in their old record — exactly what the web's delete handler needs.

**History:** introduced in `20260609230000_cards_mirror.sql` as a trigger-maintained mirror of the blob's cards. `20260610100000_web_row_writes.sql` made the mutation functions write rows directly and made the trigger conditional. `20260610130000_retire_blob_cards.sql` **dropped the trigger and the `sync_cards_from_app_state` function**, and stripped the cards array from `app_state` — so card rows are now authoritative, not trigger-synced.

#### `capture_queue`

Queue for the Capture Hub feature. Incoming tasks from external channels land here for AI processing before being added to the board.

```sql
CREATE TABLE capture_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'auto_added', 'dismissed')),
  confidence      FLOAT,
  source          TEXT NOT NULL
                  CHECK (source IN ('email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app')),
  raw_content     TEXT NOT NULL,
  raw_metadata    JSONB DEFAULT '{}',
  parsed_cards    JSONB,
  snoozed_until   TIMESTAMPTZ,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, auto-generated |
| `user_id` | UUID | References auth.users |
| `status` | TEXT | Lifecycle state: `pending` > `processing` > `ready` or `auto_added` or `dismissed` |
| `confidence` | FLOAT | AI confidence score (0.0--1.0), set after processing |
| `source` | TEXT | Intake channel identifier |
| `raw_content` | TEXT | Original captured text (max 10,000 chars) |
| `raw_metadata` | JSONB | Source-specific context (channel name, URL, sender, etc.) |
| `parsed_cards` | JSONB | Array of structured card objects produced by the AI pipeline |
| `snoozed_until` | TIMESTAMPTZ | Optional user snooze expiry; hidden from Capture Inbox until this time |
| `idempotency_key` | TEXT | Optional dedup key; a CLI/MCP retry with the same key must not double-insert |
| `created_at` | TIMESTAMPTZ | Row creation timestamp |
| `processed_at` | TIMESTAMPTZ | When AI processing completed |

**Status lifecycle:**

| Status | Meaning |
|--------|---------|
| `pending` | Just captured, waiting for AI processing |
| `processing` | AI pipeline is currently running |
| `ready` | Processed, confidence < 0.8 -- waiting for user review in Capture Inbox |
| `auto_added` | Processed, confidence >= 0.8 -- cards added directly to the board |
| `dismissed` | User dismissed the item from the Capture Inbox |

Snoozing keeps the item in its current lifecycle state and sets `snoozed_until`; the client hides the item until the timestamp has passed.

**Indexes:**

```sql
-- Primary query path
CREATE INDEX idx_capture_queue_user_status
  ON capture_queue(user_id, status, created_at DESC);

-- Snooze lookups
CREATE INDEX idx_capture_queue_user_snoozed_until
  ON capture_queue(user_id, snoozed_until);

-- Idempotency: a retry with the same key must not double-insert (partial unique)
CREATE UNIQUE INDEX capture_queue_idem_idx
  ON capture_queue(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Migration files:** `20260207170000_capture_queue.sql`, `20260207180000_drop_service_role_policy.sql`, `20260608121500_capture_queue_snoozed_until.sql`, and `20260609090000_api_tokens.sql` (which adds the `idempotency_key` column + `capture_queue_idem_idx`).

#### `focus_sessions`

Append-only, event-shaped focus session log. Replaced the focus history that used to live in the `metrics.focusSessions` blob — inserts are append-only, stop is a single-row update, and an active session is simply a row with `ended_at IS NULL`. This gives the CLI/MCP a **persisted in-progress session**, which the web blob never had.

```sql
CREATE TABLE focus_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id         TEXT,
  card_title      TEXT,
  planned_minutes INT NOT NULL DEFAULT 25 CHECK (planned_minutes BETWEEN 1 AND 480),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  outcome         TEXT CHECK (outcome IN ('progressed', 'blocked', 'completed', 'abandoned')),
  note            TEXT,
  source          TEXT NOT NULL DEFAULT 'web',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT focus_sessions_closed_shape CHECK (
    (ended_at IS NULL AND outcome IS NULL) OR (ended_at IS NOT NULL AND outcome IS NOT NULL)
  )
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, auto-generated |
| `user_id` | UUID | References auth.users |
| `card_id` | TEXT | Optional card the session was focused on |
| `card_title` | TEXT | Card title snapshot at session start |
| `planned_minutes` | INT | Planned duration, default 25, `CHECK BETWEEN 1 AND 480` |
| `started_at` | TIMESTAMPTZ | Session start |
| `ended_at` | TIMESTAMPTZ | Session end; `NULL` while active |
| `outcome` | TEXT | `CHECK IN ('progressed','blocked','completed','abandoned')`; `NULL` while active |
| `note` | TEXT | Optional reflection note |
| `source` | TEXT | Origin (`'web'`, CLI, etc.), default `'web'` |
| `created_at` | TIMESTAMPTZ | Row creation timestamp |

**Constraints & indexes:**

```sql
-- A closed session has an outcome; an open one has neither end nor outcome.
CONSTRAINT focus_sessions_closed_shape CHECK (
  (ended_at IS NULL AND outcome IS NULL) OR (ended_at IS NOT NULL AND outcome IS NOT NULL)
)

-- ONE active session per user — enforced by the database, not app code.
CREATE UNIQUE INDEX focus_sessions_one_active_idx
  ON focus_sessions (user_id)
  WHERE ended_at IS NULL;

CREATE INDEX focus_sessions_user_started_idx
  ON focus_sessions (user_id, started_at DESC);
```

The migration also backfilled completed sessions from `metrics.focusSessions` (legacy non-UUID ids get fresh ids; idempotent via `ON CONFLICT (id) DO NOTHING`).

#### `api_tokens`

Personal access tokens (PAT) for the CLI + MCP operating layer. The CLI/MCP authenticate with `Authorization: Bearer fb_pat_...`. **Only the SHA-256 hash of the token is stored** — the plaintext is shown once at creation and never again. Per-token scopes gate what a token may do.

```sql
CREATE TABLE api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['capture:read', 'capture:write'],
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX api_tokens_token_hash_idx ON api_tokens (token_hash);
CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | References auth.users |
| `token_hash` | TEXT | **SHA-256 hash only**, `UNIQUE` — plaintext never stored |
| `name` | TEXT | Human label for the token |
| `scopes` | TEXT[] | Granted scopes, default `['capture:read','capture:write']` |
| `last_used_at` | TIMESTAMPTZ | Last time the token authenticated |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `revoked_at` | TIMESTAMPTZ | Set when revoked; `NULL` = active |

The web settings page manages a user's own tokens via their session (own-row RLS); the settings UI selects `id/name/scopes/timestamps` only and never receives `token_hash`. The API resolver looks tokens up by hash with the **service-role key** (bypasses RLS).

#### `mcp_confirmations`

Durable Tier-3 MCP confirmation gate (Phase 6.1). Moves the confirmation gate from the stdio process's in-memory Map to a server-side table so a stateless hosted MCP server can use the identical gate.

```sql
CREATE TABLE mcp_confirmations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  tool        TEXT        NOT NULL,
  args        JSONB       NOT NULL,
  preview     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Confirming principal; references auth.users |
| `token_hash` | TEXT | SHA-256 hash of the confirmation token (never plaintext), `UNIQUE` |
| `tool` | TEXT | Tool name the confirmation guards |
| `args` | JSONB | Tool arguments captured at gate time |
| `preview` | TEXT | Human-readable preview shown before confirmation |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `expires_at` | TIMESTAMPTZ | Expiry — claim only valid before this |
| `used_at` | TIMESTAMPTZ | Set on single-use claim; `NULL` = unused |

The atomic claim — `UPDATE … WHERE used_at IS NULL AND expires_at > now() AND user_id = <principal>` — is the single-use + cross-principal guard. **RLS is enabled with NO user policies (service-role only)** — see [Service-Role-Only RLS Pattern](#service-role-only-rls-pattern). Expired rows can be pruned on a schedule; `ON DELETE CASCADE` cleans up on user deletion.

#### `oauth_clients` / `oauth_codes` / `oauth_tokens` / `oauth_login_attempts`

OAuth 2.1 stub (Phase 6.2) for single-principal MCP auth — a minimal Authorization Server (Dynamic Client Registration + PKCE) that issues short-lived access tokens scoped to a Supabase user principal. **All four tables use service-role-only RLS** (no user policies); the Hono API is the sole writer.

```sql
-- DCR registrations (e.g. claude.ai connector)
CREATE TABLE oauth_clients (
  client_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name   TEXT,
  redirect_uris JSONB       NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Short-lived PKCE authorization codes (single-use via used_at)
CREATE TABLE oauth_codes (
  code_hash      TEXT        PRIMARY KEY,
  client_id      UUID        NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  redirect_uri   TEXT        NOT NULL,
  code_challenge TEXT        NOT NULL,
  scope          TEXT        NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);

-- Access + refresh token pairs (hashes only)
CREATE TABLE oauth_tokens (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID        NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  user_id            UUID        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token_hash  TEXT        NOT NULL UNIQUE,
  refresh_token_hash TEXT        NOT NULL UNIQUE,
  scope              TEXT        NOT NULL,
  access_expires_at  TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  created_at         TIMESTAMPTZ DEFAULT now(),
  revoked_at         TIMESTAMPTZ
);

-- Per-IP throttle for the credential form (POST /api/oauth/authorize)
CREATE TABLE oauth_login_attempts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip           TEXT        NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX oauth_login_attempts_ip_time_idx
  ON oauth_login_attempts (ip, attempted_at);
```

Notes:
- `oauth_codes` are single-use (claimed via `used_at`) with a short expiry window.
- `oauth_tokens` rotation: revoke the old row (`revoked_at`), insert a new pair; access expires via `access_expires_at`, refresh defaults to a 30-day window.
- `oauth_login_attempts` is defense in depth over Supabase Auth's own sign-in rate limit (OWASP A04/A07): one row per POST, counted per-IP in a short window. Prune old rows on a schedule.

---

## Card Structure

Each `cards.card_json` holds the full card object:

```typescript
type Card = {
  id: string;
  column: string;
  swimlane?: "work" | "personal"; // Defaults to "work"
  title: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  icon?: string;
  notes?: string;
  link?: string;          // @deprecated - use links array instead
  links?: Array<{ id: string; url: string; label?: string }>;
  dueDate?: string;
  tags?: string[];
  checklist?: Array<{ id: string; text: string; done: boolean }>;
  columnHistory?: Array<{ from: string | null; to: string; at: string }>;
  relations?: Array<{ id: string; type: string; targetCardId: string }>;
  blockedReason?: string;
  lastOverrideReason?: string;
  lastOverrideAt?: string;
  completedAt?: string;   // ISO date when moved to terminal column
  archivedAt?: string;    // ISO date when card was archived (undefined = not archived)
  backgroundImage?: string;
  attachments?: Array<{ id: string; name: string; size: number; type: string; storagePath: string; createdAt: string }>;
};
```

## State Structure

The `app_state.state` column holds non-card board state (the `cards` array was removed):

```typescript
type AppState = {
  columns: Column[];
  templates: CardTemplate[];
  settings: Settings;
  tagCategories: TagCategory[];
  tags: Tag[];
  // cards are NOT here — they live in the `cards` table
};

type Column = {
  id: string;
  title: string;
  icon: string;
  color: string;
  wipLimit: number | null;
  isTerminal: boolean;
  order: number;
};

type Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean;
  backgroundImage: string | null;
  showAgingIndicators: boolean;
  staleCardThreshold: 3 | 7 | 14;
  autoPriorityFromDueDate: boolean;   // Auto-assign priority tags based on due dates
  staleBacklogThreshold: 3 | 7 | 14;  // Days before backlog cards show warning
  collapsedSwimlanes: string[];        // Which swimlanes are collapsed
  theme: "light" | "dark" | "system";  // Dark/light/system theme preference
  autoArchive: boolean;                // Whether auto-archive runs on month boundary
};
```

---

## Card Mutation Functions

External writes (CLI / MCP / API) go through two `SECURITY DEFINER` RPC functions, called with the **service-role key** (the API layer owns auth + validation). After Phase 4b they operate on the `cards` table directly.

### `fb_add_card(p_user uuid, p_card jsonb) → jsonb`

Inserts a new card row. Requires the user to have an `app_state` row (a board); a board = an app_state row (columns/settings live there), and card rows without a board would be invisible to every consumer. Raises `BOARD_NOT_FOUND` if no board exists. Returns the inserted card.

### `fb_mutate_card(p_user uuid, p_card_id text, p_expected_version bigint, p_patch jsonb, p_move_to text DEFAULT NULL) → jsonb`

Per-row, per-card compare-and-swap:

1. `SELECT … FOR UPDATE` the card row (serializes concurrent mutations). Raises `CARD_NOT_FOUND` if absent.
2. **Optimistic lock:** if `p_expected_version` is non-null and differs from the row's `version`, raises **`STALE_STATE`** → the API maps this to HTTP **409**.
3. If `p_move_to` differs from the current column, sets the new column and appends a `columnHistory` entry.
4. Applies `p_patch`, stamps `updatedAt`.
5. Writes `card_json`, bumps `version` by 1, updates `updated_at`. Returns the new card.

> **Sync model:** cards use **per-row, per-card `version` optimistic locking** (STALE_STATE → 409), **not** full-blob last-write-wins. The `sync_cards_from_app_state` trigger that once projected the blob → rows (Phase 4a) was **retired** by `20260610130000_retire_blob_cards.sql`; card rows are authoritative and are not trigger-synced.

---

## Row Level Security (RLS)

RLS is enabled on every table. Two patterns are used:

1. **Own-row RLS** (`auth.uid() = user_id`) — `app_state`, `metrics`, `cards`, `capture_queue`, `focus_sessions`, `api_tokens`. Clients reach these through the anon/authenticated key scoped to their own rows.
2. **Service-role-only RLS** — `mcp_confirmations`, `oauth_clients`, `oauth_codes`, `oauth_tokens`, `oauth_login_attempts`. See below.

> **Service role bypasses RLS inherently.** The Vercel serverless functions use the service-role key, which is not subject to RLS at all. There is **no** permissive "Service role full access" policy — adding `USING(true)` would nullify per-user isolation for the anon/authenticated roles. (An early `USING(true)` policy on `capture_queue` was removed by `20260207180000_drop_service_role_policy.sql`.)

### Service-Role-Only RLS Pattern

`mcp_confirmations` and the four `oauth_*` tables enable RLS **with zero user policies**. With RLS on and no policy granting access, the anon and authenticated roles can read/write **nothing**. Only the service-role key — which bypasses RLS — can touch these tables. Agents never hit Supabase directly; they go through the API layer (Hono), which uses the service-role key exclusively. This is the intended contract for a future hosted-MCP endpoint.

```sql
ALTER TABLE mcp_confirmations ENABLE ROW LEVEL SECURITY;
-- No CREATE POLICY statements — service-role only.
```

### Own-row policies

Each own-row table follows the same shape (SELECT/INSERT/UPDATE, plus DELETE where applicable). Example for `app_state`:

```sql
CREATE POLICY "Users can read own state"   ON app_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own state" ON app_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own state" ON app_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own state" ON app_state FOR DELETE USING (auth.uid() = user_id);
```

`metrics` has SELECT/INSERT/UPDATE (no DELETE). `cards`, `capture_queue`, `focus_sessions`, and `api_tokens` each have all four (SELECT/INSERT/UPDATE/DELETE), all gated on `auth.uid() = user_id`.

---

## Service Role Access

The webhook/API layer uses the **service-role key** to bypass RLS and write data on behalf of users. This is necessary because webhook and CLI/MCP requests are not authenticated via a Supabase Auth session.

**Security:** The service-role key must only be used server-side (Vercel functions) and never exposed to the client. The card mutation RPCs (`fb_add_card`, `fb_mutate_card`) and the service-role-only tables all rely on this.

---

## Real-time Subscriptions

The `supabase_realtime` publication includes **`app_state`, `cards`, and `capture_queue`**.

> **History / gotcha:** `app_state` was **never** in the publication until `20260610120000_app_state_realtime_publication.sql`. Before that fix, every `postgres_changes` subscription on `app_state` was **silently rejected** by the realtime server ("Unable to subscribe to changes with given parameters"). Consequences: the pre-4b board realtime sync **never actually worked in prod** (only `capture_queue` realtime did), so the Phase 4a "residual race bounded by realtime convergence" assumption was false in practice. The fix also hardened the web client to subscribe to `cards` and `app_state` on **separate channels** (a single failing binding can no longer take down card sync) and to log subscription-status errors instead of swallowing them.

What each table delivers:
- **`cards`** — per-card INSERT/UPDATE/DELETE events. DELETE events carry `(user_id, id)` via the default replica identity (the PK).
- **`app_state`** — non-card board state (settings, columns, tags, daily plan).
- **`capture_queue`** — new/updated captures push to the Capture Inbox.

```typescript
// Cards and app_state on SEPARATE channels (one failing binding must not kill the other)
supabase
  .channel("cards_changes")
  .on("postgres_changes",
    { event: "*", schema: "public", table: "cards", filter: `user_id=eq.${userId}` },
    (payload) => { /* apply per-card change */ })
  .subscribe();

supabase
  .channel("app_state_changes")
  .on("postgres_changes",
    { event: "*", schema: "public", table: "app_state", filter: `user_id=eq.${userId}` },
    (payload) => { /* apply non-card board state */ })
  .subscribe();

supabase
  .channel("capture_queue_changes")
  .on("postgres_changes",
    { event: "*", schema: "public", table: "capture_queue", filter: `user_id=eq.${userId}` },
    (payload) => { /* handle new/updated capture item */ })
  .subscribe();
```

### Enabling Real-time (SQL)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE capture_queue; -- 20260207170000
ALTER PUBLICATION supabase_realtime ADD TABLE cards;         -- 20260610100000
ALTER PUBLICATION supabase_realtime ADD TABLE app_state;     -- 20260610120000
```

---

## Environment Variables

### Client-side (Vite)

Set in `.env.local` for local development:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The anon key is safe for client-side use with RLS enabled.

### Server-side (Vercel)

Set in Vercel environment variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
FOCUSBOARD_USER_ID=your-user-uuid
```

The service-role key bypasses RLS - keep it secret.

---

## Finding Your User ID

To find your Supabase user UUID:

### Option 1: Supabase Dashboard
1. Go to **Authentication > Users**
2. Find your email
3. Copy the UUID

### Option 2: Browser Console
```javascript
const { data } = await supabase.auth.getUser();
console.log(data.user.id);
```

### Option 3: Local Storage
1. Open DevTools > Application > Local Storage
2. Look for `sb-*-auth-token`
3. Parse the JSON and find `user.id`

---

## Complete SQL Setup

`app_state` and `metrics` predate the migrations directory; the rest is created by the migrations in `supabase/migrations/`. Run the migrations to provision everything; the SQL below shows the pre-migration tables plus a consolidated reference. **Do not** add a `USING(true)` "service role full access" policy to any table — the service role bypasses RLS already.

```sql
-- ── Pre-migration tables (no migration file) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS app_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}',   -- non-card board state; no `cards` array
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL DEFAULT '{}', -- focus history extracted to focus_sessions
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics   ENABLE ROW LEVEL SECURITY;

-- app_state policies (own-row)
CREATE POLICY "Users can read own state"   ON app_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own state" ON app_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own state" ON app_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own state" ON app_state FOR DELETE USING (auth.uid() = user_id);

-- metrics policies (own-row, no DELETE)
CREATE POLICY "Users can read own metrics"   ON metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own metrics" ON metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own metrics" ON metrics FOR UPDATE USING (auth.uid() = user_id);

-- Realtime for app_state (added by 20260610120000 — previously missing!)
ALTER PUBLICATION supabase_realtime ADD TABLE app_state;

-- ── Everything else: apply the migrations in supabase/migrations/ ──────────────
--   cards, capture_queue, focus_sessions, api_tokens, mcp_confirmations,
--   oauth_clients/oauth_codes/oauth_tokens/oauth_login_attempts,
--   fb_add_card / fb_mutate_card, and the realtime additions for
--   capture_queue + cards are all defined there.
```

---

## Sync Behavior

### Cards (per-row, optimistic-locked)
- The web client and the API/CLI/MCP write **card rows** directly.
- External mutations go through `fb_mutate_card` with a `p_expected_version`; a version mismatch raises `STALE_STATE` → **HTTP 409** (no silent last-write-wins).
- Realtime on `cards` delivers per-card INSERT/UPDATE/DELETE to open tabs.

### Non-card board state (app_state blob)
- Columns, settings, tags, and the daily plan are saved as a blob, debounced (~1 second).
- Realtime on `app_state` propagates these changes to other devices (functional only since `20260610120000`).

### Captures & focus sessions
- `capture_queue` changes push to the Capture Inbox via realtime.
- `focus_sessions` is append-only: insert on start, single-row update on stop; `focus_sessions_one_active_idx` enforces one active session per user at the database level.

### Conflict resolution
- **Cards:** per-card optimistic lock (`version` compare-and-swap → 409 on stale).
- **app_state blob:** last-write-wins for the non-card fields it still carries.
- Service-role writes (webhook/CLI/MCP) bypass RLS; user-scoped writes are gated by own-row policies.
