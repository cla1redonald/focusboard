# Supabase Setup

This document covers the Supabase configuration for Focusboard, including database schema, RLS policies, and environment setup.

## Overview

Supabase provides:
- **Authentication** - Email/password and magic link login
- **Database** - PostgreSQL for storing user state
- **Real-time** - Live sync between devices

## Database Schema

### Tables

#### `app_state`

Stores the complete application state for each user.

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
| `state` | JSONB | Complete AppState object |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

#### `metrics`

Stores analytics data for each user.

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
| `metrics` | JSONB | MetricsState object |
| `updated_at` | TIMESTAMPTZ | Last modification timestamp |

#### `capture_queue`

Queue for the Capture Hub feature. Incoming tasks from external channels land here for AI processing before being added to the board.

```sql
CREATE TABLE capture_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'ready', 'auto_added', 'dismissed')),
  confidence    FLOAT,
  source        TEXT NOT NULL
                CHECK (source IN ('email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app')),
  raw_content   TEXT NOT NULL,
  raw_metadata  JSONB DEFAULT '{}',
  parsed_cards  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  processed_at  TIMESTAMPTZ
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

**Migration file:** `supabase/migrations/20260207170000_capture_queue.sql`

---

## State Structure

The `state` column contains the complete app state:

```typescript
type AppState = {
  cards: Card[];
  columns: Column[];
  templates: CardTemplate[];
  settings: Settings;
  tagCategories: TagCategory[];
  tags: Tag[];
};

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

## Row Level Security (RLS)

RLS ensures users can only access their own data.

### Enable RLS

```sql
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;
```

### Policies for `app_state`

```sql
-- Users can read their own state
CREATE POLICY "Users can read own state"
  ON app_state FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own state
CREATE POLICY "Users can insert own state"
  ON app_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own state
CREATE POLICY "Users can update own state"
  ON app_state FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own state
CREATE POLICY "Users can delete own state"
  ON app_state FOR DELETE
  USING (auth.uid() = user_id);
```

### Policies for `metrics`

```sql
-- Users can read their own metrics
CREATE POLICY "Users can read own metrics"
  ON metrics FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own metrics
CREATE POLICY "Users can insert own metrics"
  ON metrics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own metrics
CREATE POLICY "Users can update own metrics"
  ON metrics FOR UPDATE
  USING (auth.uid() = user_id);
```

### Policies for `capture_queue`

```sql
-- Users can view their own captures
CREATE POLICY "Users can view own captures"
  ON capture_queue FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own captures
CREATE POLICY "Users can insert own captures"
  ON capture_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own captures
CREATE POLICY "Users can update own captures"
  ON capture_queue FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own captures
CREATE POLICY "Users can delete own captures"
  ON capture_queue FOR DELETE
  USING (auth.uid() = user_id);

-- Service role needs full access for the API endpoints
CREATE POLICY "Service role full access"
  ON capture_queue FOR ALL
  USING (true) WITH CHECK (true);
```

**Note:** The "Service role full access" policy allows the Vercel serverless functions (which use the service role key) to insert and update rows on behalf of any user. Client-side queries through the anon key are still restricted by the per-user policies.

---

## Service Role Access

The webhook API uses the **service role key** to bypass RLS and write data on behalf of users. This is necessary because webhook requests are not authenticated via Supabase Auth.

**Security:** The service role key should only be used server-side (Vercel functions) and never exposed to the client.

---

## Real-time Subscriptions

The app subscribes to state changes for multi-device sync:

```typescript
supabase
  .channel("app_state_changes")
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "app_state",
    },
    (payload) => {
      // Handle state update
    }
  )
  .subscribe();
```

The Capture Hub subscribes to the `capture_queue` table so new captures appear in the Capture Inbox in real time:

```typescript
supabase
  .channel("capture_queue_changes")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "capture_queue",
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      // Handle new/updated capture item
    }
  )
  .subscribe();
```

### Enable Real-time

In Supabase Dashboard:
1. Go to **Database > Replication**
2. Enable replication for `app_state` table -- select `UPDATE` events
3. Enable replication for `capture_queue` table -- select `INSERT` and `UPDATE` events

Or via SQL:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE capture_queue;
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

The service role key bypasses RLS - keep it secret.

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

Run this SQL in the Supabase SQL Editor to set up everything:

```sql
-- Create tables
CREATE TABLE IF NOT EXISTS app_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capture_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'ready', 'auto_added', 'dismissed')),
  confidence    FLOAT,
  source        TEXT NOT NULL
                CHECK (source IN ('email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app')),
  raw_content   TEXT NOT NULL,
  raw_metadata  JSONB DEFAULT '{}',
  parsed_cards  JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;

-- app_state policies
CREATE POLICY "Users can read own state"
  ON app_state FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own state"
  ON app_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own state"
  ON app_state FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own state"
  ON app_state FOR DELETE
  USING (auth.uid() = user_id);

-- metrics policies
CREATE POLICY "Users can read own metrics"
  ON metrics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own metrics"
  ON metrics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own metrics"
  ON metrics FOR UPDATE
  USING (auth.uid() = user_id);

-- capture_queue policies
CREATE POLICY "Users can view own captures"
  ON capture_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own captures"
  ON capture_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own captures"
  ON capture_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own captures"
  ON capture_queue FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access"
  ON capture_queue FOR ALL
  USING (true) WITH CHECK (true);

-- Index for capture_queue queries
CREATE INDEX idx_capture_queue_user_status
  ON capture_queue(user_id, status, created_at DESC);

-- Enable real-time for capture_queue
ALTER PUBLICATION supabase_realtime ADD TABLE capture_queue;
```

---

## Sync Behavior

### Client → Cloud
- State changes are debounced (1 second delay)
- Full state replacement (last-write-wins)
- Saves on every meaningful state change

### Cloud → Client
- State loaded on app startup
- Real-time subscription for external updates
- External updates (e.g., from webhook) sync automatically
- `capture_queue` changes push to the Capture Inbox via real-time subscription

### Conflict Resolution
- Last-write-wins strategy
- No merge logic for concurrent edits
- Webhook writes use service role to bypass auth
