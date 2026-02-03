# Focusboard Architecture

## Overview

Focusboard is a React-based Kanban board application built with TypeScript, Vite, and Tailwind CSS. It uses a client-side architecture with optional cloud sync via Supabase.

## Directory Structure

```
src/
├── app/                    # Core application logic
│   ├── App.tsx            # Root component, authentication, state orchestration
│   ├── types.ts           # TypeScript type definitions
│   ├── constants.ts       # Default values, color palettes, icons
│   ├── state.ts           # Reducer and state management hook
│   ├── storage.ts         # localStorage persistence and migrations
│   ├── sync.ts            # Cloud sync with Supabase
│   ├── filters.ts         # Card filtering logic
│   ├── metrics.ts         # Analytics and metrics calculations
│   ├── urgency.ts         # Due date urgency calculations
│   ├── theme.ts           # Dark mode hook and theme application
│   ├── utils.ts           # Helper functions (URL validation, date utils, grouping)
│   ├── exportImport.ts    # JSON/CSV export and import
│   ├── supabase.ts        # Supabase client initialization
│   ├── useKeyboardNav.ts  # Keyboard navigation hook
│   └── useAI.ts           # AI feature API calls
├── components/            # React components
│   ├── Board.tsx          # Main board with swimlanes and drag-drop
│   ├── Swimlane.tsx       # Work/Personal swimlane row
│   ├── Column.tsx         # Single column with cards
│   ├── CardItem.tsx       # Card display in column
│   ├── CardModal.tsx      # Card edit modal
│   ├── TopStrip.tsx       # Header with current task and stats
│   ├── FilterBar.tsx      # Search and filter controls
│   ├── SettingsPanel.tsx  # Settings modal
│   ├── MetricsDashboard.tsx # Analytics dashboard
│   ├── TimelinePanel.tsx  # Gantt-style timeline view
│   ├── FocusSuggestionPanel.tsx # AI daily focus suggestions
│   ├── WeeklyPlanPanel.tsx # Weekly planning with AI suggestions
│   ├── PomodoroTimer.tsx  # Focus timer with breaks
│   ├── WipModal.tsx       # WIP limit override dialog
│   ├── ConfettiBurst.tsx  # Celebration animation
│   ├── ErrorBoundary.tsx  # Error boundary for graceful error handling
│   ├── LoginPage.tsx      # Authentication UI
│   └── ...
├── test/                  # Test utilities and security tests
└── main.tsx              # Application entry point

api/                        # Vercel serverless functions
├── webhook/
│   └── add-card.ts        # POST /api/webhook/add-card
├── ai/                     # AI-powered features (requires ANTHROPIC_API_KEY)
│   ├── parse-card.ts      # Natural language card parsing
│   ├── suggest.ts         # Tag/emoji suggestions
│   ├── breakdown.ts       # Task breakdown into subtasks
│   ├── daily-focus.ts     # AI daily focus recommendations
│   └── weekly-plan.ts     # AI weekly scheduling suggestions

docs/                       # Documentation
├── API.md                 # Webhook API reference
└── SUPABASE.md           # Database schema and setup
```

## Data Model

### Core Types

```typescript
// Swimlane - Work vs Personal separation
type SwimlaneId = "work" | "personal";

// Card - The primary data unit
type Card = {
  id: string;
  column: ColumnId;
  swimlane: SwimlaneId;       // Work or Personal
  title: string;
  order: number;              // Position within column/swimlane
  icon?: string;
  notes?: string;
  link?: string;
  dueDate?: string;
  tags?: string[];            // Array of Tag IDs
  checklist?: ChecklistItem[];
  relations?: CardRelation[];
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
};

// Column - Kanban column definition
type Column = {
  id: string;
  title: string;
  icon: string;
  color: string;
  wipLimit: number | null;
  isTerminal: boolean;
  order: number;
};

// Tag - Colored label
type Tag = {
  id: string;
  name: string;
  color: string;
  categoryId: string;
};

// TagCategory - Tag grouping
type TagCategory = {
  id: string;
  name: string;
  order: number;
};

// ThemeMode - Light/dark preference
type ThemeMode = "light" | "dark" | "system";

// Settings - User preferences
type Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean;
  backgroundImage: string | null;
  showAgingIndicators: boolean;
  staleCardThreshold: 3 | 7 | 14;
  autoPriorityFromDueDate: boolean;
  staleBacklogThreshold: 3 | 7 | 14;
  collapsedSwimlanes: SwimlaneId[];  // Track collapsed swimlanes
  theme: ThemeMode;                   // Color theme preference
};

// UrgencyLevel - Due date proximity
type UrgencyLevel = "none" | "low" | "medium" | "high" | "critical";

// AppState - Complete application state
type AppState = {
  cards: Card[];
  columns: Column[];
  templates: CardTemplate[];
  settings: Settings;
  tagCategories: TagCategory[];
  tags: Tag[];
};
```

## State Management

### Reducer Pattern

The app uses React's `useReducer` with a custom wrapper for undo/redo support:

```
┌─────────────────────────────────────────────────────┐
│                   HistoryState                       │
├─────────────────────────────────────────────────────┤
│  past: AppState[]     (max 50 states)               │
│  present: AppState    (current state)               │
│  future: AppState[]   (redo stack)                  │
└─────────────────────────────────────────────────────┘
```

### Action Types

| Category | Actions |
|----------|---------|
| Cards | `ADD_CARD`, `ADD_CARD_WITH_DATA`, `ADD_CARD_FROM_TEMPLATE`, `UPDATE_CARD`, `DELETE_CARD`, `MOVE_CARD`, `REORDER_CARDS` |
| Archive | `ARCHIVE_CARD`, `UNARCHIVE_CARD`, `AUTO_ARCHIVE_CARDS` |
| Columns | `ADD_COLUMN`, `UPDATE_COLUMN`, `DELETE_COLUMN`, `REORDER_COLUMNS` |
| Templates | `ADD_TEMPLATE`, `UPDATE_TEMPLATE`, `DELETE_TEMPLATE` |
| Tags | `ADD_TAG`, `UPDATE_TAG`, `DELETE_TAG` |
| Tag Categories | `ADD_TAG_CATEGORY`, `UPDATE_TAG_CATEGORY`, `DELETE_TAG_CATEGORY`, `REORDER_TAG_CATEGORIES` |
| Relations | `ADD_RELATION`, `REMOVE_RELATION` |
| Swimlanes | `TOGGLE_SWIMLANE_COLLAPSE` |
| Settings | `SET_SETTINGS` |
| History | `UNDO`, `REDO` |
| Bulk | `IMPORT_STATE`, `APPLY_AUTO_PRIORITIES` |

### State Flow

```
User Action
    │
    ▼
dispatch({ type, payload })
    │
    ▼
┌─────────────────┐
│    Reducer      │ ─────► New AppState
└─────────────────┘
    │
    ▼
┌─────────────────┐
│  useEffect      │ ─────► localStorage.setItem()
└─────────────────┘        (and Supabase sync if enabled)
```

## Storage & Persistence

### Local Storage

Data is persisted to localStorage with versioned, user-scoped keys:

| Version | Key Pattern | Description |
|---------|-------------|-------------|
| v1 | `focusboard:v1` | Original format (legacy) |
| v2 | `focusboard:v2` | Added dynamic columns |
| v3 | `focusboard:v3` | Added tag categories and tags |
| v4 | `focusboard:v4:{userId}` | Added swimlanes, user-scoped keys |

When a user is logged in, storage keys include their user ID to ensure data isolation.
Local-only mode (no auth) uses global keys without userId suffix.

### Migration System

```typescript
loadState() {
  // Try v4 first (current)
  // Fall back to v3, migrate to v4
  // Fall back to v2, migrate through v3 to v4
  // Fall back to v1, migrate through v2, v3 to v4
  // Return default state if nothing found
}
```

### Cloud Sync (Supabase)

When Supabase is configured:

1. **Authentication** - Email/password or magic link via Supabase Auth
2. **Storage** - State stored in `app_state` table, metrics in `metrics` table
3. **Data Isolation** - Row Level Security (RLS) ensures users only access their own data
4. **Sync Strategy** - Full state replacement (last-write-wins), debounced saves

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Local   │ ◄─► │  React   │ ◄─► │ Supabase │
│ Storage  │     │  State   │     │    DB    │
│ (scoped) │     │          │     │  (RLS)   │
└──────────┘     └──────────┘     └──────────┘
```

**Multi-User Architecture:**
- Each user has isolated localStorage (`focusboard:v4:{userId}`)
- Supabase RLS policies enforce `user_id = auth.uid()` on all queries
- New users start with empty state (no data leakage between users)
- Real-time subscriptions sync changes across devices

## Component Architecture

### Component Hierarchy

```
App
├── ErrorBoundary (catches React errors gracefully)
│   ├── LoginPage (if not authenticated)
│   └── (authenticated)
│       ├── Board
│       │   ├── TopStrip
│       │   │   └── PomodoroTimer
│       │   ├── FilterBar
│       │   ├── Swimlane (Work, Personal)
│       │   │   └── Column (×n)
│       │   │       └── CardItem (×n)
│       │   ├── WipModal
│       │   └── ConfettiBurst
│       ├── CardModal
│       ├── SettingsPanel
│       │   └── ExportImportPanel
│       ├── MetricsDashboard (lazy-loaded)
│       ├── TimelinePanel (lazy-loaded)
│       ├── FocusSuggestionPanel (lazy-loaded)
│       └── WeeklyPlanPanel (lazy-loaded)
```

### Props Flow

Props flow down from App, which holds:
- `state` (AppState)
- `dispatch` (reducer dispatch function)
- `metrics` (computed from state)

### Drag and Drop

Uses `@dnd-kit` library:

```
DndContext (Board.tsx)
├── useDroppable (Column.tsx) - Drop targets
└── useDraggable (CardItem.tsx) - Draggable cards
```

**Performance:** Drag-and-drop is the most render-intensive path in the application. Moving a card triggers a state update that flows through the entire component tree: `App -> Board -> Swimlane -> Column -> CardItem`. The optimizations described in the [Performance](#performance) section below were specifically designed to minimize re-renders along this path. Key points:

- `CardItem` and `Column` are wrapped in `React.memo` so only cards/columns whose props actually changed re-render
- The `MOVE_CARD` reducer preserves object references for unchanged cards, enabling `React.memo` to bail out
- Callback references passed from `Swimlane` to `Column` are stabilized with `useCallback`/`useMemo`
- Framer Motion's `layout` prop is intentionally omitted from `CardItem` to avoid GPU layout recalculation on every sibling

## Key Features Implementation

### Filtering

```typescript
filterCards(cards, filter) {
  return cards.filter(card =>
    matchesSearch(card, filter.search) &&
    matchesColumns(card, filter.columns) &&
    matchesTags(card, filter.tags) &&
    matchesDueDate(card, filter.dueDate) &&
    matchesBlocker(card, filter.hasBlocker)
  );
}
```

### WIP Limits

- Checked on card move (`MOVE_CARD` action)
- If limit exceeded, `WipModal` prompts for override reason
- Override reason stored on card

### Celebrations

- Triggered when card moves to terminal column
- Uses `ConfettiBurst` component with canvas animation
- Respects `prefers-reduced-motion` and settings

### Keyboard Navigation

- Implemented in `useKeyboardNav` hook
- Tracks focused column and card index
- Arrow keys navigate, Enter opens, Delete removes

### Timeline View

- Gantt-style SVG chart in `TimelinePanel.tsx`
- Groups cards by Column, Urgency, or Flat view
- Date range options: Week, Month, Quarter
- Shows creation date to due date as horizontal bars
- Color-coded by urgency level

### Smart Urgency

- Calculated in `urgency.ts` based on due date proximity
- Levels: `critical` (overdue), `high` (≤3 days), `medium` (≤7 days), `low` (≤14 days)
- Visual indicators shown on cards via `CardItem.tsx`
- Optional auto-priority: automatically tags cards based on urgency

### Stale Backlog Detection

- Cards in backlog without due dates tracked for staleness
- Configurable threshold (3, 7, or 14 days since last update)
- Warning indicator shown on stale cards

### Smart Card Creation

- `suggestEmojiForTitle()` in `utils.ts` maps keywords to emojis
- `suggestTagsForTitle()` auto-assigns tags based on title keywords
- Applied automatically in `ADD_CARD` reducer action
- Examples: "Fix bug" → 🐛 + bug tag, "Meeting" → 📞, "Deploy" → 🚀

### Swimlanes

- Two fixed swimlanes: Work (💼) and Personal (🏠)
- Cards grouped by swimlane, then by column
- Each swimlane is independently collapsible
- Drag-and-drop between swimlanes supported

### Dark Mode

- Three theme modes: Light, Dark, System (follows OS preference)
- Implemented via Tailwind's `darkMode: "class"` strategy
- Theme applied via `useTheme` hook in `theme.ts`
- CSS variables in `index.css` define dark color palette
- FOUC prevention: inline script in `index.html` applies theme before render
- Respects `prefers-reduced-motion` for color transitions
- Persisted in Settings and synced with Supabase

### AI Features

Requires `ANTHROPIC_API_KEY` environment variable. Uses Claude Haiku for fast, low-cost processing.

| Feature | API Route | Description |
|---------|-----------|-------------|
| Natural Language Cards | `/api/ai/parse-card` | Parses "urgent bug fix by friday" → title, tags, due date |
| Daily Focus | `/api/ai/daily-focus` | Recommends top 3-5 tasks based on due dates and priorities |
| Weekly Planning | `/api/ai/weekly-plan` | Suggests optimal task scheduling across 7 days |
| Task Breakdown | `/api/ai/breakdown` | Generates 3-8 subtasks for complex cards |

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│  Vercel API │────▶│  Claude AI  │
│  useAI.ts   │     │  /api/ai/*  │     │  (Haiku)    │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Pomodoro Timer

- 25-minute focus sessions with 5/15 minute breaks
- Visual progress ring with countdown display
- Tracks completed pomodoros and total focus time
- Sound notification when timer completes
- Compact view in TopStrip, expands on click
- Stats persisted to localStorage

## Performance

### General Strategies

1. **Code Splitting** - Heavy panels (Metrics, Timeline, Focus, Weekly, Archive) are lazy-loaded with `React.lazy()` and `Suspense` to reduce initial bundle size
2. **Memoization** - Key components use `React.memo`; expensive derivations use `useMemo`
3. **Virtualization** - Not currently implemented (suitable for <1000 cards)
4. **State Updates** - Immutable updates via spread operators; unchanged objects returned by reference
5. **Storage Writes** - Debounced/throttled via useEffect dependencies

### Drag-and-Drop Render Optimizations

Drag-and-drop is the most render-sensitive code path. Moving a card dispatches `MOVE_CARD`, which updates state and re-renders the board. Without care, every card on the board re-renders even if only one card moved. The following optimizations minimize this:

#### 1. Component Memoization (`CardItem.tsx`, `Column.tsx`)

Both `CardItem` and `Column` are wrapped in `React.memo`:

```typescript
// CardItem.tsx
export const CardItem = React.memo(function CardItem({ card, ... }) { ... });

// Column.tsx
export const Column = React.memo(function Column({ id, cards, ... }) { ... });
```

`React.memo` performs a shallow comparison of props. If a card's object reference has not changed, the component skips re-rendering entirely. This is why reference stability in the reducer matters (see below).

#### 2. Reference-Preserving Reducer (`state.ts` -- `MOVE_CARD`)

The `MOVE_CARD` reducer uses a single-pass `.map()` that returns unchanged card objects by reference:

```typescript
case "MOVE_CARD": {
  const newCards = state.cards.map((c) => {
    if (c.id === action.id) {
      return { ...c, column: action.to, order: 0, ... }; // New object for moved card
    }
    if (c.column === action.to && ...) {
      return { ...c, order: (c.order ?? 0) + 1 };        // New object for shifted siblings
    }
    return c; // Same reference -- React.memo skips re-render
  });
  return { ...state, cards: newCards };
}
```

Cards in unaffected columns are returned as the same object reference (`return c`). When `React.memo` compares `prevProps.card === nextProps.card`, the check succeeds and the component bails out. This means moving a card between two columns only re-renders cards in those two columns, not the entire board.

**Previous implementation** used a two-pass approach (remove from source, insert at destination) that created new object references for every card in both columns. The single-pass approach reduces unnecessary allocations and enables downstream memo bailouts.

#### 3. Stable Callback References (`Swimlane.tsx`)

`Swimlane` creates wrapper callbacks for `onAdd` and `onAIAdd` that bind the swimlane ID. Without memoization, these would be new function references on every render, defeating `Column`'s `React.memo`:

```typescript
// Swimlane.tsx
const handleAdd = React.useCallback(
  (colId: ColumnId, cardTitle: string) => onAdd(colId, cardTitle, swimlaneId),
  [onAdd, swimlaneId]
);
const handleAIAdd = React.useMemo(
  () => onAIAdd ? (colId: ColumnId, input: string) => onAIAdd(colId, input, swimlaneId) : undefined,
  [onAIAdd, swimlaneId]
);
```

`handleAdd` uses `useCallback` for a stable reference. `handleAIAdd` uses `useMemo` because it may be `undefined` (AI features are optional), and `useCallback` cannot return `undefined`.

#### 4. Framer Motion Layout Prop Removed (`CardItem.tsx`)

Framer Motion's `layout` prop triggers GPU layout recalculation on every sibling card whenever any card in the same `AnimatePresence` group changes position. During drag-and-drop, this caused visible jank as every card in the column re-measured its layout. The `layout` prop was removed from `CardItem`'s `<motion.div>`, and `AnimatePresence` in `Column.tsx` was changed from `mode="popLayout"` to the default mode. Cards still animate on enter/exit via `initial`/`animate`/`exit` props, but sibling cards no longer trigger expensive layout recalculations.

#### 5. Metrics Completion Tracking (`App.tsx`)

The `useEffect` that detects newly completed cards (moved to a terminal column) previously used an O(n^2) pattern:

```typescript
// Before: O(n^2) -- prevCards.find() inside a loop over state.cards
for (const card of state.cards) {
  const prevCard = prevCards.find((c) => c.id === card.id);
  ...
}
```

This was replaced with an O(n) Map-based lookup:

```typescript
// After: O(n) -- build Map once, look up by ID
const prevCardMap = new Map(prevCards.map((c) => [c.id, c]));
for (const card of state.cards) {
  const prevCard = prevCardMap.get(card.id);
  ...
}
```

For boards with hundreds of cards, this eliminates a meaningful amount of per-render work.

### Optimization Summary

| File | Optimization | Effect |
|------|-------------|--------|
| `CardItem.tsx` | `React.memo` wrapper; removed Framer Motion `layout` prop | Cards skip re-render when their props are unchanged; no GPU layout recalc on siblings |
| `Column.tsx` | `React.memo` wrapper; `AnimatePresence` default mode | Columns skip re-render when their cards array reference is stable |
| `Swimlane.tsx` | `useCallback` for `handleAdd`; `useMemo` for `handleAIAdd` | Stable callback references prevent `Column` memo invalidation |
| `state.ts` | Single-pass `MOVE_CARD` preserving object references | Unchanged cards keep the same identity, enabling memo bailouts |
| `App.tsx` | Map-based lookup for completion tracking | O(n) instead of O(n^2) per state change |

## Security

- No sensitive data stored (except optional Supabase credentials in env)
- XSS protection via React's default escaping
- **URL sanitization** - Card links are validated with `isSafeUrl()` to block `javascript:`, `data:`, and other dangerous protocols
- localStorage data is user-scoped when authenticated
- Supabase RLS policies enforce complete user data isolation
- User ID set synchronously before state initialization (prevents race conditions)

## Error Handling

- **ErrorBoundary** component wraps the entire app and individual lazy-loaded panels
- Catches React rendering errors gracefully instead of crashing the entire app
- Displays user-friendly error message with "Try Again" recovery option
- Errors are logged to console for debugging (could be extended to error tracking services)

## Webhook API

The `/api/webhook/add-card` endpoint allows external tools to add cards.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  External Tool  │────▶│  Vercel API     │────▶│    Supabase     │
│  (Shortcuts,    │     │  /api/webhook/  │     │   app_state     │
│   Zapier, etc)  │     │  add-card       │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼ (real-time)
                                                ┌─────────────────┐
                                                │   Focusboard    │
                                                │   (auto-sync)   │
                                                └─────────────────┘
```

**Key Design Decisions:**

1. **Self-contained functions** - API routes inline all types to avoid bundling issues with Vercel
2. **Service role key** - Webhook uses service role to bypass RLS for server-side writes
3. **Shared secret auth** - Simple authentication suitable for personal use
4. **Real-time sync** - Cards added via webhook appear in app via Supabase subscriptions

See [docs/API.md](docs/API.md) for full API documentation.

## Strengths

| Strength | Why It Matters |
|----------|----------------|
| **Offline-first** | Works without internet. localStorage is instant, Supabase syncs in background. |
| **Simple state management** | Single `useReducer` with undo/redo. Easy to understand, debug, and extend. |
| **Type safety** | Full TypeScript coverage catches bugs at compile time, not runtime. |
| **Zero backend code** | Supabase handles auth, DB, and real-time. Vercel hosts static files. No servers to maintain. |
| **Migration system** | Storage versions (v1→v4) let you evolve the data model without breaking existing users. |
| **User isolation** | RLS + scoped localStorage = bulletproof multi-user separation. |
| **Fast builds** | Vite is 10-100x faster than Webpack. Sub-second hot reload. |
| **Portable data** | JSON/CSV export means users own their data. No lock-in. |
| **High test coverage** | 357 tests = confidence to refactor and add features. |
| **Low cost** | Supabase free tier + Vercel free tier = $0/month for small scale. |

## Limitations

| Limitation | Impact | Potential Fix |
|------------|--------|---------------|
| **Last-write-wins sync** | Simultaneous edits on two devices = one change lost | Implement CRDT or operational transforms |
| **Full state replacement** | Every save sends entire state (~50KB) | Switch to granular updates (patch individual cards) |
| **No virtualization** | 1000+ cards will slow down rendering | Add `react-window` or `@tanstack/virtual` |
| **Fixed swimlanes** | Only Work/Personal, can't add custom | Make swimlanes dynamic like columns |
| **No real-time collaboration** | Can't see other users editing live | Add Supabase Realtime presence |
| **localStorage limits** | ~5MB per origin | Compress state or move more to Supabase |
| **Single-tenant webhook** | Webhook adds cards for one hardcoded user | Add user identification to webhook |
| **Undo history in memory** | Refresh = lose undo stack | Persist history to localStorage |

## Scale Limits

```
Current architecture works well for:
├── Users: 1-100 (Supabase free tier)
├── Cards per user: <1,000 (no virtualization)
├── State size: <5MB (localStorage limit)
└── Concurrent editors: 1 per board (no collaboration)

Would need changes for:
├── Users: 1,000+ → Supabase paid tier
├── Cards: 10,000+ → Virtualization + pagination
├── Real-time collab → Presence + conflict resolution
└── Mobile → Native app or better PWA
```

## Architecture Trade-offs

| Choice | Alternative | Trade-off |
|--------|-------------|-----------|
| Client-side state | Server-side | Faster UX, but sync complexity |
| Full state sync | Granular patches | Simpler code, but more bandwidth |
| localStorage first | Cloud first | Works offline, but potential conflicts |
| useReducer | Redux/Zustand | Less boilerplate, but no middleware |
| Tailwind | CSS Modules | Faster styling, but larger HTML |
| Supabase | Firebase/AWS | Better DX + SQL, but smaller ecosystem |
