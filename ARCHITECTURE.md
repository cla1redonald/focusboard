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
│   ├── utils.ts           # Helper functions
│   ├── exportImport.ts    # JSON/CSV export and import
│   ├── supabase.ts        # Supabase client initialization
│   └── useKeyboardNav.ts  # Keyboard navigation hook
├── components/            # React components
│   ├── Board.tsx          # Main board with columns and drag-drop
│   ├── Column.tsx         # Single column with cards
│   ├── CardItem.tsx       # Card display in column
│   ├── CardModal.tsx      # Card edit modal
│   ├── TopStrip.tsx       # Header with current task and stats
│   ├── FilterBar.tsx      # Search and filter controls
│   ├── SettingsPanel.tsx  # Settings modal
│   ├── MetricsDashboard.tsx # Analytics dashboard
│   ├── TimelinePanel.tsx  # Gantt-style timeline view
│   ├── WipModal.tsx       # WIP limit override dialog
│   ├── ConfettiBurst.tsx  # Celebration animation
│   ├── LoginPage.tsx      # Authentication UI
│   └── ...
├── test/                  # Test utilities and security tests
└── main.tsx              # Application entry point

api/                        # Vercel serverless functions
└── webhook/
    └── add-card.ts        # POST /api/webhook/add-card

docs/                       # Documentation
├── API.md                 # Webhook API reference
└── SUPABASE.md           # Database schema and setup
```

## Data Model

### Core Types

```typescript
// Card - The primary data unit
type Card = {
  id: string;
  column: ColumnId;
  title: string;
  icon?: string;
  notes?: string;
  link?: string;
  dueDate?: string;
  tags?: string[];           // Array of Tag IDs
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

// Settings - User preferences
type Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean;
  backgroundImage: string | null;
  showAgingIndicators: boolean;
  staleCardThreshold: 3 | 7 | 14;
  autoPriorityFromDueDate: boolean;
  staleBacklogThreshold: 3 | 7 | 14;
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
| Cards | `ADD_CARD`, `UPDATE_CARD`, `DELETE_CARD`, `MOVE_CARD` |
| Columns | `ADD_COLUMN`, `UPDATE_COLUMN`, `DELETE_COLUMN`, `REORDER_COLUMNS` |
| Tags | `ADD_TAG`, `UPDATE_TAG`, `DELETE_TAG` |
| Tag Categories | `ADD_TAG_CATEGORY`, `UPDATE_TAG_CATEGORY`, `DELETE_TAG_CATEGORY` |
| Relations | `ADD_RELATION`, `REMOVE_RELATION` |
| Settings | `SET_SETTINGS` |
| History | `UNDO`, `REDO` |
| Bulk | `IMPORT_STATE` |

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

Data is persisted to localStorage with versioned keys:

| Version | Key | Description |
|---------|-----|-------------|
| v1 | `focusboard:v1` | Original format (legacy) |
| v2 | `focusboard:v2` | Added dynamic columns |
| v3 | `focusboard:v3` | Added tag categories and tags |

### Migration System

```typescript
loadState() {
  // Try v3 first (current)
  // Fall back to v2, migrate to v3
  // Fall back to v1, migrate through v2 to v3
  // Return default state if nothing found
}
```

### Cloud Sync (Supabase)

When Supabase is configured:

1. **Authentication** - Email/password or magic link
2. **Storage** - State stored in `user_data` table keyed by user ID
3. **Sync Strategy** - Full state replacement (last-write-wins)

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Local   │ ◄─► │  React   │ ◄─► │ Supabase │
│ Storage  │     │  State   │     │    DB    │
└──────────┘     └──────────┘     └──────────┘
```

## Component Architecture

### Component Hierarchy

```
App
├── LoginPage (if not authenticated)
└── (authenticated)
    ├── Board
    │   ├── TopStrip
    │   ├── FilterBar
    │   ├── Column (×n)
    │   │   └── CardItem (×n)
    │   ├── WipModal
    │   └── ConfettiBurst
    ├── CardModal
    ├── SettingsPanel
    │   └── ExportImportPanel
    └── MetricsDashboard
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

## Performance Considerations

1. **Memoization** - Key components use React.memo where beneficial
2. **Virtualization** - Not currently implemented (suitable for <1000 cards)
3. **State Updates** - Immutable updates via spread operators
4. **Storage Writes** - Debounced/throttled via useEffect dependencies

## Security

- No sensitive data stored (except optional Supabase credentials in env)
- XSS protection via React's default escaping
- localStorage data is user-controlled
- Supabase RLS policies protect user data

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

## Future Considerations

- Real-time collaboration (Supabase Realtime)
- Offline-first with conflict resolution
- Card virtualization for large boards
- WebSocket sync for multi-device
