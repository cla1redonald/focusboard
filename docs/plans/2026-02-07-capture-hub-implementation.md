# Capture Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a universal task capture system that ingests raw content from any channel (Slack, email, browser, Shortcuts), AI-processes it into structured cards, and routes them to the board via a confidence-based hybrid flow.

**Architecture:** A `capture_queue` Supabase table (separate from `app_state` to avoid race conditions) receives items via a `/api/capture` serverless endpoint. A `/api/capture/process` endpoint uses Claude Haiku to parse raw content into structured cards using board context. The client subscribes to `capture_queue` in real-time and displays items in a lazy-loaded CaptureInbox panel with a TopStrip badge.

**Tech Stack:** Vercel serverless (TypeScript), Supabase (PostgreSQL + RLS + Realtime), Claude Haiku (AI parsing), React 19, Tailwind CSS, Lucide icons

---

## Task 1: Supabase Migration — `capture_queue` Table

**Files:**
- Create: `supabase/migrations/capture_queue.sql`

**Step 1: Write the migration SQL**

```sql
-- Capture Hub: queue table for universal task ingestion
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

-- RLS: users can only access their own captures
ALTER TABLE capture_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own captures" ON capture_queue
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own captures" ON capture_queue
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own captures" ON capture_queue
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own captures" ON capture_queue
  FOR DELETE USING (auth.uid() = user_id);

-- Service role needs full access for the API endpoints
CREATE POLICY "Service role full access" ON capture_queue
  FOR ALL USING (true) WITH CHECK (true);

-- Index for faster queries
CREATE INDEX idx_capture_queue_user_status ON capture_queue(user_id, status, created_at DESC);

-- Enable real-time subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE capture_queue;
```

**Step 2: Commit**

```bash
git add supabase/migrations/capture_queue.sql
git commit -m "feat(capture): add capture_queue table migration"
```

**Note:** This migration needs to be run manually in the Supabase SQL Editor. The file serves as documentation and version control.

---

## Task 2: Capture Types — Shared Type Definitions

**Files:**
- Create: `src/app/captureTypes.ts`

**Step 1: Write the type definitions**

```typescript
// Capture Hub types — shared between client and referenced by API endpoints

export type CaptureSource = 'email' | 'slack' | 'shortcut' | 'browser' | 'whatsapp' | 'in_app';

export type CaptureStatus = 'pending' | 'processing' | 'ready' | 'auto_added' | 'dismissed';

export type ParsedCaptureCard = {
  title: string;
  notes?: string;
  tags?: string[];        // Tag IDs from existing board tags
  swimlane?: 'work' | 'personal';
  suggestedColumn?: string; // Column ID
  dueDate?: string;        // ISO date
  confidence: number;      // 0.0 - 1.0
  duplicateOf?: string;    // Card ID if duplicate detected
  relatedTo?: string[];    // Card IDs for relationship suggestions
};

export type CaptureQueueItem = {
  id: string;
  user_id: string;
  status: CaptureStatus;
  confidence: number | null;
  source: CaptureSource;
  raw_content: string;
  raw_metadata: Record<string, unknown>;
  parsed_cards: ParsedCaptureCard[] | null;
  created_at: string;
  processed_at: string | null;
};

// Source display config for the UI
export const SOURCE_CONFIG: Record<CaptureSource, { label: string; borderColor: string; darkBorderColor: string; icon: string }> = {
  slack:    { label: 'Slack',    borderColor: 'border-l-emerald-500', darkBorderColor: 'dark:border-l-emerald-400', icon: '💬' },
  email:    { label: 'Email',    borderColor: 'border-l-blue-500',    darkBorderColor: 'dark:border-l-blue-400',    icon: '📧' },
  browser:  { label: 'Browser',  borderColor: 'border-l-teal-500',    darkBorderColor: 'dark:border-l-teal-400',    icon: '🌐' },
  shortcut: { label: 'Shortcut', borderColor: 'border-l-amber-500',   darkBorderColor: 'dark:border-l-amber-400',   icon: '⚡' },
  whatsapp: { label: 'WhatsApp', borderColor: 'border-l-green-500',   darkBorderColor: 'dark:border-l-green-400',   icon: '📱' },
  in_app:   { label: 'In-App',   borderColor: 'border-l-gray-400',    darkBorderColor: 'dark:border-l-gray-500',    icon: '📋' },
};
```

**Step 2: Commit**

```bash
git add src/app/captureTypes.ts
git commit -m "feat(capture): add shared type definitions"
```

---

## Task 3: API Endpoint — `POST /api/capture`

Universal ingestion endpoint. Accepts raw content from any channel, inserts into `capture_queue`, then triggers async AI processing.

**Files:**
- Create: `api/capture/index.ts`

**Step 1: Write the endpoint**

Follow exact patterns from `api/webhook/add-card.ts` for structure, and `api/_lib/auth.ts` + `api/_lib/cors.ts` for helpers.

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content, source = "in_app", metadata = {}, secret, user_id } = req.body || {};

    // Auth: either webhook secret (external channels) or will use session auth
    const expectedSecret = process.env.WEBHOOK_SECRET;

    // For external channels: validate secret + require user_id
    // For in-app: validate session token
    let userId: string | null = null;

    if (secret) {
      if (!expectedSecret || secret !== expectedSecret) {
        return res.status(401).json({ error: "Invalid secret" });
      }
      userId = user_id || process.env.FOCUSBOARD_USER_ID;
    } else {
      // Session-based auth for in-app capture
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace("Bearer ", "");
      if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const supabaseUrl = process.env.SUPABASE_URL!;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const authClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user }, error } = await authClient.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      userId = user.id;
    }

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    if (!content?.trim()) {
      return res.status(400).json({ error: "Content is required" });
    }

    // Validate source
    const validSources = ['email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app'];
    const safeSource = validSources.includes(source) ? source : 'in_app';

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert into capture_queue
    const { data, error: insertError } = await supabase
      .from("capture_queue")
      .insert({
        user_id: userId,
        status: "pending",
        source: safeSource,
        raw_content: content.trim().substring(0, 10000), // Limit content size
        raw_metadata: metadata,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Capture insert error:", insertError.message);
      return res.status(500).json({ error: "Failed to save capture" });
    }

    // Trigger async processing (fire and forget)
    const processUrl = `https://${req.headers.host}/api/capture/process`;
    void fetch(processUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capture_id: data.id, user_id: userId }),
    }).catch((err) => console.error("Process trigger failed:", err));

    return res.status(200).json({
      success: true,
      message: `Captured from ${safeSource}`,
      captureId: data.id,
    });
  } catch (err) {
    console.error("Capture unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
```

**Step 2: Write tests for the endpoint**

Create `api/capture/__tests__/index.test.ts` with unit tests covering:
- Missing content returns 400
- Invalid secret returns 401
- Valid request inserts into capture_queue
- Source validation defaults to 'in_app'

**Step 3: Commit**

```bash
git add api/capture/index.ts api/capture/__tests__/index.test.ts
git commit -m "feat(capture): add universal ingestion endpoint POST /api/capture"
```

---

## Task 4: API Endpoint — `POST /api/capture/process`

AI processing pipeline. Fetches board context, calls Claude Haiku for structured extraction, updates `capture_queue` with results.

**Files:**
- Create: `api/capture/process.ts`

**Step 1: Write the processing endpoint**

Follow patterns from `api/ai/parse-card.ts` for Anthropic client usage.

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import type { AppState } from "../../src/app/types";

const CONFIDENCE_THRESHOLD = 0.8;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { capture_id, user_id } = req.body || {};

    if (!capture_id || !user_id) {
      return res.status(400).json({ error: "capture_id and user_id required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Mark as processing
    await supabase
      .from("capture_queue")
      .update({ status: "processing" })
      .eq("id", capture_id);

    // Fetch the capture item
    const { data: capture, error: fetchError } = await supabase
      .from("capture_queue")
      .select("*")
      .eq("id", capture_id)
      .single();

    if (fetchError || !capture) {
      return res.status(404).json({ error: "Capture item not found" });
    }

    // Fetch board context for AI
    const { data: stateData } = await supabase
      .from("app_state")
      .select("state")
      .eq("user_id", user_id)
      .single();

    const appState: AppState | null = stateData?.state ?? null;

    // Build context strings
    const existingTitles = appState?.cards
      ?.filter((c) => !c.archivedAt)
      .map((c) => c.title)
      .slice(0, 50) // Limit for token budget
      .join("\n") ?? "No existing cards";

    const existingTags = appState?.tags
      ?.map((t) => `${t.id} (${t.name})`)
      .join(", ") ?? "high (High), medium (Medium), low (Low), bug (Bug), feature (Feature), chore (Chore)";

    const columnList = appState?.columns
      ?.map((c) => `${c.id} (${c.title})`)
      .join(", ") ?? "backlog, design, todo, doing, blocked, done";

    const today = new Date().toISOString().split("T")[0];

    // Source-specific context
    const sourceContext = capture.raw_metadata
      ? `Source metadata: ${JSON.stringify(capture.raw_metadata)}`
      : "";

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a task extraction assistant for a Kanban board app called FocusBoard.

Parse the following raw captured content into one or more structured task cards.

RAW CONTENT (from ${capture.source}):
"""
${capture.raw_content}
"""
${sourceContext}

BOARD CONTEXT:
- Available columns: ${columnList}
- Available tags: ${existingTags}
- Today's date: ${today}
- Existing card titles (for duplicate detection):
${existingTitles}

EXTRACTION RULES:
1. Extract one or more distinct tasks from the content
2. For each task, provide:
   - title: Clean, actionable task title (imperative form, max 80 chars)
   - notes: Brief context summary if useful (max 200 chars)
   - tags: Array of tag IDs from the available tags
   - swimlane: "work" or "personal" (default "work")
   - suggestedColumn: Column ID (default "backlog", use "todo" for urgent/clear tasks)
   - dueDate: ISO date if mentioned or implied (relative to today: ${today})
   - confidence: 0.0-1.0 how confident you are in this extraction
   - duplicateOf: If it closely matches an existing card title, put that title here. Otherwise null.
   - relatedTo: Array of existing card titles that seem related. Otherwise empty array.
3. A single email thread might contain multiple tasks — extract each one
4. Confidence scoring:
   - 0.9+: Clear, unambiguous single task
   - 0.7-0.9: Reasonable extraction but some ambiguity
   - Below 0.7: Vague content, unclear action items

Return ONLY valid JSON array. No markdown, no explanation.
Example: [{"title":"Review Q3 budget","notes":"From finance team email","tags":["high"],"swimlane":"work","suggestedColumn":"todo","dueDate":"2026-02-14","confidence":0.92,"duplicateOf":null,"relatedTo":[]}]`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";

    let parsedCards;
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      parsedCards = JSON.parse(cleaned);
      if (!Array.isArray(parsedCards)) {
        parsedCards = [parsedCards];
      }
    } catch {
      // Fallback: create a basic card from the raw content
      const title = capture.raw_content.substring(0, 80).trim();
      parsedCards = [{
        title: title || "Captured item",
        confidence: 0.3,
        tags: [],
        swimlane: "work",
        suggestedColumn: "backlog",
        duplicateOf: null,
        relatedTo: [],
      }];
    }

    // Calculate overall confidence (average)
    const avgConfidence = parsedCards.reduce((sum: number, c: { confidence?: number }) => sum + (c.confidence ?? 0.5), 0) / parsedCards.length;

    // Determine status based on confidence
    const status = avgConfidence >= CONFIDENCE_THRESHOLD ? "auto_added" : "ready";

    // Update capture_queue with results
    await supabase
      .from("capture_queue")
      .update({
        status,
        confidence: avgConfidence,
        parsed_cards: parsedCards,
        processed_at: new Date().toISOString(),
      })
      .eq("id", capture_id);

    // If high confidence, auto-add cards to board
    if (status === "auto_added" && appState) {
      const { nanoid } = await import("nanoid");
      const now = new Date().toISOString();

      const newCards = parsedCards.map((parsed: any) => ({
        id: nanoid(),
        column: parsed.suggestedColumn || "backlog",
        swimlane: parsed.swimlane || "work",
        title: parsed.title,
        order: 0,
        notes: parsed.notes || `Captured from ${capture.source}`,
        tags: parsed.tags || [],
        dueDate: parsed.dueDate || undefined,
        checklist: [],
        createdAt: now,
        updatedAt: now,
        columnHistory: [{ from: null, to: parsed.suggestedColumn || "backlog", at: now }],
      }));

      // Shift existing card orders and add new cards
      const updatedCards = appState.cards.map((c) => {
        const hasNewCardInColumn = newCards.some(
          (nc: any) => nc.column === c.column && (nc.swimlane || "work") === (c.swimlane || "work")
        );
        return hasNewCardInColumn ? { ...c, order: c.order + newCards.filter((nc: any) => nc.column === c.column).length } : c;
      });

      const finalState = {
        ...appState,
        cards: [...newCards, ...updatedCards],
      };

      await supabase.from("app_state").upsert({
        user_id: user_id,
        state: finalState,
        updated_at: now,
      }, { onConflict: "user_id" });
    }

    return res.status(200).json({
      success: true,
      status,
      confidence: avgConfidence,
      cardCount: parsedCards.length,
    });
  } catch (err) {
    console.error("Capture process error:", err);
    return res.status(500).json({ error: "Processing failed" });
  }
}
```

**Step 2: Commit**

```bash
git add api/capture/process.ts
git commit -m "feat(capture): add AI processing pipeline POST /api/capture/process"
```

---

## Task 5: Client Hook — `useCaptureQueue`

Real-time subscription to `capture_queue` table + CRUD operations.

**Files:**
- Create: `src/app/useCaptureQueue.ts`
- Test: `src/app/useCaptureQueue.test.ts`

**Step 1: Write the hook**

Follow patterns from `src/app/sync.ts` for Supabase subscription and `src/app/useAI.ts` for hook structure.

```typescript
import React from "react";
import { supabase } from "./supabase";
import type { CaptureQueueItem, CaptureStatus } from "./captureTypes";

export function useCaptureQueue(userId: string | null) {
  const [items, setItems] = React.useState<CaptureQueueItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Fetch items with status 'ready' or 'auto_added' (last 24h for auto_added)
  const fetchItems = React.useCallback(async () => {
    if (!supabase || !userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("capture_queue")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["pending", "processing", "ready", "auto_added"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setItems(data as CaptureQueueItem[]);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Real-time subscription
  React.useEffect(() => {
    if (!supabase || !userId) return;

    // Initial fetch
    void fetchItems();

    // Subscribe to changes
    const channel = supabase
      .channel(`capture_queue:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "public",
          table: "capture_queue",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Refetch on any change
          void fetchItems();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, fetchItems]);

  // Dismiss an item
  const dismissItem = React.useCallback(async (captureId: string) => {
    if (!supabase) return;
    await supabase
      .from("capture_queue")
      .update({ status: "dismissed" as CaptureStatus })
      .eq("id", captureId);
    setItems((prev) => prev.filter((i) => i.id !== captureId));
  }, []);

  // Delete an item
  const deleteItem = React.useCallback(async (captureId: string) => {
    if (!supabase) return;
    await supabase
      .from("capture_queue")
      .delete()
      .eq("id", captureId);
    setItems((prev) => prev.filter((i) => i.id !== captureId));
  }, []);

  // Count of items needing attention (ready status)
  const pendingCount = React.useMemo(
    () => items.filter((i) => i.status === "ready" || i.status === "pending" || i.status === "processing").length,
    [items]
  );

  // Split items by section
  const reviewItems = React.useMemo(
    () => items.filter((i) => i.status === "ready"),
    [items]
  );

  const processingItems = React.useMemo(
    () => items.filter((i) => i.status === "pending" || i.status === "processing"),
    [items]
  );

  const autoAddedItems = React.useMemo(
    () => items.filter((i) => i.status === "auto_added"),
    [items]
  );

  return {
    items,
    reviewItems,
    processingItems,
    autoAddedItems,
    pendingCount,
    loading,
    fetchItems,
    dismissItem,
    deleteItem,
  };
}
```

**Step 2: Write tests**

Test the hook's memoized calculations and state management. Mock supabase.

**Step 3: Commit**

```bash
git add src/app/useCaptureQueue.ts src/app/useCaptureQueue.test.ts
git commit -m "feat(capture): add useCaptureQueue hook with real-time subscription"
```

---

## Task 6: CaptureInbox Panel Component

Lazy-loaded slide-over panel showing pending captures with review/approve/dismiss actions.

**Files:**
- Create: `src/components/CaptureInbox.tsx`
- Test: `src/components/CaptureInbox.test.tsx`

**Step 1: Write the component**

Follow patterns from `src/components/ArchivePanel.tsx` for panel layout, escape key handling, and styling.

The panel should have:
- Header with "Capture Inbox" title + item count
- Three sections: "Processing" (pending/processing), "Review" (ready), "Recently Auto-Added" (auto_added, collapsible)
- Each item card shows: source badge (left border accent), AI-generated title, tag chips, suggested column, confidence indicator, action buttons
- Actions: Add as-is (emerald checkmark), Edit & Add (ghost pencil expanding inline editor), Dismiss (X on hover)
- Empty state with channel setup illustration
- Dark mode support using existing patterns

Key UI details:
- Left border color by source (using `SOURCE_CONFIG` from captureTypes)
- Missing fields shown as actionable nudges: "No due date — add one?" with inline chip
- Primary button (emerald): Add card to board as-is
- Secondary button (ghost): Expand inline editor to tweak before adding
- Dismiss: subtle X on hover, swipe intent (CSS only) on mobile
- "Add all" batch button when multiple review items

The "Add as-is" action should dispatch `ADD_CARD_WITH_DATA` to the reducer (same pattern as AI card creation in Board.tsx) and then update the capture_queue item status to 'dismissed'.

The "Edit & Add" action should expand an inline editor with editable title, tag picker, column selector, swimlane toggle, and due date input. On confirm, dispatches `ADD_CARD_WITH_DATA` and dismisses.

**Step 2: Write tests**

Cover:
- Renders nothing when closed
- Shows empty state when no items
- Renders review items with correct source badges
- Add as-is calls onAddCard with correct data
- Dismiss removes item from list
- Escape key closes panel
- Dark mode class variants

**Step 3: Commit**

```bash
git add src/components/CaptureInbox.tsx src/components/CaptureInbox.test.tsx
git commit -m "feat(capture): add CaptureInbox panel component"
```

---

## Task 7: TopStrip Integration — Capture Badge

Add the Capture Inbox button with unread badge to TopStrip.

**Files:**
- Modify: `src/components/TopStrip.tsx`
- Modify: `src/components/Board.tsx` (pass through props)

**Step 1: Add props to TopStrip**

Add `onOpenCapture?: () => void` and `captureCount?: number` to TopStrip props. Add the `Inbox` icon import from lucide-react.

Add a new button between Archive and Feedback buttons (after line 138 in TopStrip.tsx):

```tsx
{onOpenCapture && (
  <button
    onClick={onOpenCapture}
    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
    title="Capture Inbox"
    aria-label="Capture Inbox"
  >
    <Inbox size={16} />
    <span className="text-sm">Capture</span>
    {(captureCount ?? 0) > 0 && (
      <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {captureCount}
      </span>
    )}
  </button>
)}
```

**Step 2: Add props to Board**

Add `onOpenCapture?: () => void` and `captureCount?: number` to Board props and pass through to TopStrip.

**Step 3: Run existing tests**

Run: `npx vitest run src/components/TopStrip src/components/Board --reporter=verbose`
Expected: All existing tests still pass.

**Step 4: Commit**

```bash
git add src/components/TopStrip.tsx src/components/Board.tsx
git commit -m "feat(capture): add Capture Inbox button with badge to TopStrip"
```

---

## Task 8: App.tsx Integration — Wire Everything Together

Connect the CaptureInbox panel, useCaptureQueue hook, and Board props in App.tsx.

**Files:**
- Modify: `src/app/App.tsx`

**Step 1: Add lazy import**

After line 30 (ArchivePanel lazy import), add:
```typescript
const CaptureInbox = React.lazy(() => import("../components/CaptureInbox").then(m => ({ default: m.CaptureInbox })));
```

**Step 2: Add state and hook**

In AppContent, after line 60 (archivePanelOpen state), add:
```typescript
const [captureInboxOpen, setCaptureInboxOpen] = React.useState(false);
```

Import and call useCaptureQueue:
```typescript
import { useCaptureQueue } from "./useCaptureQueue";
// Inside AppContent:
const { reviewItems, processingItems, autoAddedItems, pendingCount, dismissItem, deleteItem } = useCaptureQueue(user?.id ?? null);
```

**Step 3: Add stable callback**

After line 79 (handleOpenArchive), add:
```typescript
const handleOpenCapture = React.useCallback(() => setCaptureInboxOpen(true), []);
```

**Step 4: Add handler for adding cards from capture**

After handleAddWithData, add a handler that creates a card from parsed capture data:
```typescript
const handleAddCaptureCard = React.useCallback(
  (parsedCard: ParsedCaptureCard, captureId: string) => {
    dispatch({
      type: "ADD_CARD_WITH_DATA",
      column: parsedCard.suggestedColumn || "backlog",
      title: parsedCard.title,
      swimlane: parsedCard.swimlane || "work",
      data: {
        tags: parsedCard.tags,
        dueDate: parsedCard.dueDate,
        notes: parsedCard.notes,
      },
    });
    showToast({ type: "success", message: `Added "${parsedCard.title}" from capture` });
    void dismissItem(captureId);
  },
  [dispatch, showToast, dismissItem]
);
```

**Step 5: Pass props to Board**

Add to the Board component call:
```typescript
onOpenCapture={handleOpenCapture}
captureCount={pendingCount}
```

**Step 6: Add lazy-loaded panel**

After the ArchivePanel Suspense block (after line 546), add:
```typescript
{captureInboxOpen && (
  <Suspense fallback={<PanelLoadingFallback />}>
    <ErrorBoundary>
      <CaptureInbox
        open={captureInboxOpen}
        reviewItems={reviewItems}
        processingItems={processingItems}
        autoAddedItems={autoAddedItems}
        columns={state.columns}
        tags={state.tags}
        onClose={() => setCaptureInboxOpen(false)}
        onAddCard={handleAddCaptureCard}
        onDismiss={dismissItem}
        onDelete={deleteItem}
      />
    </ErrorBoundary>
  </Suspense>
)}
```

**Step 7: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(capture): wire CaptureInbox panel into App.tsx"
```

---

## Task 9: In-App Quick Capture — Keyboard Shortcut

Add `Cmd+Shift+C` keyboard shortcut for quick capture input.

**Files:**
- Modify: `src/app/App.tsx` (add keyboard handler)
- Modify: `src/components/CaptureInbox.tsx` (add quick capture input mode)
- Modify: `src/components/KeyboardShortcutsModal.tsx` (document shortcut)

**Step 1: Add keyboard shortcut**

In the existing `handleKeyDown` effect in App.tsx (around line 190), add before the `?` handler:

```typescript
if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
  e.preventDefault();
  setCaptureInboxOpen(true);
  // Could set a flag to auto-focus the quick capture input
  return;
}
```

**Step 2: Add shortcut to KeyboardShortcutsModal**

Add a new entry in the shortcuts list for "Quick Capture" with `Cmd+Shift+C`.

**Step 3: Add to CommandPalette**

Add "Open Capture Inbox" command to CommandPalette component.

**Step 4: Commit**

```bash
git add src/app/App.tsx src/components/KeyboardShortcutsModal.tsx src/components/CommandPalette.tsx
git commit -m "feat(capture): add Cmd+Shift+C quick capture shortcut"
```

---

## Task 10: Integration Testing & Polish

End-to-end verification and polish.

**Files:**
- All modified files
- Create: `src/components/CaptureInbox.test.tsx` (if not already done in Task 6)

**Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Fix any failures.

**Step 2: Test capture API with curl**

```bash
# Test capture endpoint
curl -X POST https://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content": "Review PR #123 by friday", "source": "slack", "secret": "YOUR_SECRET"}'

# Test with email-like content
curl -X POST https://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -d '{"content": "Subject: Q3 Budget Review\n\nHi team,\nPlease review the Q3 budget spreadsheet and provide comments by next Tuesday.\nAlso, book the team offsite venue for March.", "source": "email", "secret": "YOUR_SECRET"}'
```

**Step 3: Verify UI**

- Open Capture Inbox — should show empty state
- Trigger a capture via curl — badge should update in real-time
- Review item should show with correct source badge and parsed card data
- "Add as-is" should create card on board
- "Dismiss" should remove from inbox
- Dark mode should work correctly
- Escape key should close panel

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(capture): polish and integration testing"
```
