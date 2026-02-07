# Capture Hub — Universal Task Ingestion for FocusBoard

**Date:** 2026-02-07
**Status:** Design approved
**Goal:** Let users send tasks to FocusBoard from anywhere — Slack, email, WhatsApp, browser, Shortcuts — with AI-powered parsing that turns messy input into structured, categorised cards.

---

## Mental Model

One rule for every channel: **send it to FocusBoard, it figures out the rest.**

No formatting rules. No special syntax. No thinking about how to structure it. Raw text in, clean cards out.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  INTAKE CHANNELS                                │
│  Slack · Email · WhatsApp · Browser · Shortcuts │
└──────────────────┬──────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  SMART INGESTION API  (Vercel serverless)        │
│  POST /api/capture                               │
│  - Auth via per-user API tokens                  │
│  - Accepts raw content + source metadata         │
│  - Rate-limited, validates payload               │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  AI PROCESSING PIPELINE  (Claude Haiku)          │
│  - Parse raw input → structured card(s)          │
│  - Fetch existing board for context              │
│  - Detect duplicates, suggest relationships      │
│  - Assign confidence score (0-1)                 │
│  - Batch: one input can produce multiple cards   │
└──────────┬───────────────┬───────────────────────┘
           ▼               ▼
   confidence >= 0.8   confidence < 0.8
           │               │
     Auto-add to      Land in Capture
     board + toast     Inbox for review
```

---

## Data Model

### New table: `capture_queue`

```sql
CREATE TABLE capture_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id),
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

-- RLS: users can only see their own captures
ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own captures" ON capture_queue
  FOR ALL USING (auth.uid() = user_id);

-- Enable real-time
ALTER PUBLICATION supabase_realtime ADD TABLE capture_queue;
```

### `parsed_cards` schema

Each item in the array:

```json
{
  "title": "Review Q3 budget spreadsheet",
  "notes": "From email thread with finance team",
  "tags": ["work", "high"],
  "swimlane": "work",
  "suggestedColumn": "todo",
  "dueDate": "2026-02-14",
  "confidence": 0.92,
  "duplicateOf": null,
  "relatedTo": ["card-id-123"]
}
```

### Why a separate table (not `app_state`)

The current `app_state` table stores the entire board as a single JSONB blob per user. Writing to it from the capture API would create a read-modify-write race condition with the client's debounced saves. The separate `capture_queue` table avoids this entirely — the client subscribes to it and promotes items into local state through the existing reducer, which then syncs normally.

---

## AI Processing Pipeline

### Step 1: Normalize raw input

Strip source-specific noise before hitting the AI:

| Source | Normalization |
|--------|--------------|
| Email | Extract subject + body, strip signatures and reply chains |
| Slack | Extract message text + channel name + thread context |
| Browser | Extract selected text + page title + URL |
| Shortcut | Pass through raw text |
| In-app | Pass through raw text |

### Step 2: Fetch board context

Pull the user's current `app_state` from Supabase to give the AI:

- Existing card titles (duplicate detection)
- Existing tags (pick from real tags, don't invent)
- Column names (suggest the right column)
- Swimlane names
- Recent patterns (learning from user behavior)

### Step 3: Claude Haiku structured extraction

Single prompt returning structured JSON:

- One or more cards with all fields
- Confidence score per card
- Duplicate flags
- Relationship suggestions
- Cost: ~0.1 cent per capture (~2-3K tokens)

---

## Intake Channels

All channels do one thing: get raw content to `POST /api/capture` with an auth token.

### Email (Gmail + Zapier)

- User forwards emails to `themselves+focusboard@gmail.com`
- Gmail filter labels them `FocusBoard`
- Zapier watches that label, fires webhook with subject + body + sender
- Handles multi-email threads: AI extracts multiple tasks

### Slack (Zapier)

- User adds `:focusboard:` emoji reaction to any message
- Zapier triggers on the reaction, grabs message + channel + thread
- Fires webhook to `/api/capture`

### iOS/Mac Shortcuts

- Downloadable Shortcut accepts Share Sheet input (text, URLs)
- Sends POST to `/api/capture` with user token
- Works from WhatsApp, iMessage, Safari, Notes, anywhere with Share Sheet
- Pin to home screen for one-tap access

### Browser Extension (Chrome)

- Lightweight popup: highlight text → click capture
- Right-click context menu: "Send to FocusBoard"
- Sends selected text + page title + URL

### In-App Quick Capture

- `Cmd+Shift+C` opens minimal capture input
- Same AI pipeline as external channels
- Keeps parity across all capture methods

---

## Capture Inbox UI

### Panel

Slide-over panel (consistent with Settings, Archive, Metrics). Lazy-loaded.

### TopStrip Badge

Inbox icon with emerald `rounded-full bg-emerald-500 text-white text-xs` pill showing unread count. Gentle scale-in animation.

### Inbox Item Cards

Left border accent by source for instant scan-ability:

| Source | Border Color |
|--------|-------------|
| Slack | Emerald (emerald-500) |
| Email | Blue (blue-500) |
| Browser | Teal (teal-500) |
| Shortcut | Amber (amber-500) |
| In-app | Gray (gray-400) |

Each card shows:
- Source badge + relative timestamp
- AI-generated title (editable)
- Tag chips + suggested column + swimlane
- Missing fields as actionable nudges ("No due date detected — add one?" with inline `+ Add date` chip)

### Actions

- **Primary** (emerald checkmark): Add as-is — one tap
- **Secondary** (ghost pencil): Expand inline editor to tweak before adding
- **Dismiss**: Swipe on mobile, subtle X on hover for desktop
- **Batch**: "Add all" button when multiple items pending

### Sections

1. **Pending review** (confidence < 0.8) — items needing decisions
2. **Recently auto-added** (collapsible) — last 24h of high-confidence items with "Undo" option

### Empty State

Illustration showing channels flowing in. "Set up channels" CTA button. Doubles as onboarding and portfolio screenshot moment.

### Dark Mode

- Left-border accents use `/400` variants for contrast on `gray-800` backgrounds
- Cards: `bg-gray-800 border-gray-700`

---

## Components to Build

| Component | Type | Description |
|-----------|------|-------------|
| `POST /api/capture` | Vercel serverless | Universal ingestion endpoint, auth via per-user tokens |
| `POST /api/capture/process` | Vercel serverless | AI pipeline, called async after ingestion |
| `capture_queue` table | Supabase migration | Queue with RLS, real-time enabled |
| `CaptureInbox` | React (lazy-loaded) | Slide-over panel for reviewing pending items |
| `CaptureInboxBadge` | React | TopStrip icon with emerald unread count |
| `CaptureSettings` | React | Token management + channel setup guides |
| `useCaptureQueue` hook | React | Real-time subscription to `capture_queue` table |
| Chrome Extension | Standalone | Minimal popup + context menu |
| iOS Shortcut | Downloadable | Share sheet action |
| Zapier templates | Config | Pre-built zaps for Slack + Gmail |

---

## Security

- Per-user API tokens, stored hashed in Supabase
- Token generation + revocation in CaptureSettings UI
- Rate limiting on `/api/capture` (e.g. 60 requests/min per user)
- RLS on `capture_queue` — users only see their own rows
- Input sanitization before rendering raw content
- Validate payload structure before processing

---

## Portfolio Showcase Value

This feature demonstrates:

- **API design**: Universal endpoint, token auth, rate limiting
- **AI orchestration**: Context-aware structured extraction, confidence scoring, batch processing
- **Real-time systems**: Supabase subscriptions, live inbox updates
- **Multi-platform thinking**: 5 channels, one pipeline
- **UX polish**: Hybrid auto-add, inline editing, swipe dismiss, calm stream aesthetic
- **Systems architecture**: Queue table avoids race conditions, preserves offline-first model
