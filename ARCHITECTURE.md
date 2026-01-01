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
│   ├── utils.ts           # Helper functions
│   ├── exportImport.ts    # JSON/CSV export and import
│   ├── supabase.ts        # Supabase client initialization
│   ├── useKeyboardNav.ts  # Keyboard navigation hook
│   ├── useAI.ts           # AI feature API calls
│   └── useNotionCalendar.ts # Notion calendar integration
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
└── notion/                 # Notion calendar integration (optional)
    ├── databases.ts       # List accessible Notion databases
    └── events.ts          # Fetch calendar events

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
| Cards | `ADD_CARD`, `UPDATE_CARD`, `DELETE_CARD`, `MOVE_CARD`, `REORDER_CARDS` |
| Columns | `ADD_COLUMN`, `UPDATE_COLUMN`, `DELETE_COLUMN`, `REORDER_COLUMNS` |
| Tags | `ADD_TAG`, `UPDATE_TAG`, `DELETE_TAG` |
| Tag Categories | `ADD_TAG_CATEGORY`, `UPDATE_TAG_CATEGORY`, `DELETE_TAG_CATEGORY` |
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
├── LoginPage (if not authenticated)
└── (authenticated)
    ├── Board
    │   ├── TopStrip
    │   │   └── PomodoroTimer
    │   ├── FilterBar
    │   ├── Swimlane (Work, Personal)
    │   │   └── Column (×n)
    │   │       └── CardItem (×n)
    │   ├── WipModal
    │   └── ConfettiBurst
    ├── CardModal
    ├── SettingsPanel
    │   └── ExportImportPanel
    ├── MetricsDashboard
    ├── TimelinePanel
    ├── FocusSuggestionPanel
    └── WeeklyPlanPanel
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

### Notion Calendar Integration

Optional integration to show calendar events in Weekly Plan view.

- Requires `NOTION_API_KEY` and `NOTION_CALENDAR_DATABASE_ID`
- Fetches events from a Notion database with date properties
- Events displayed in day cells with time and title
- Note: Notion Calendar app data is NOT accessible (only Notion databases)

## Performance Considerations

1. **Memoization** - Key components use React.memo where beneficial
2. **Virtualization** - Not currently implemented (suitable for <1000 cards)
3. **State Updates** - Immutable updates via spread operators
4. **Storage Writes** - Debounced/throttled via useEffect dependencies

## Security

- No sensitive data stored (except optional Supabase credentials in env)
- XSS protection via React's default escaping
- localStorage data is user-scoped when authenticated
- Supabase RLS policies enforce complete user data isolation
- User ID set synchronously before state initialization (prevents race conditions)

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
