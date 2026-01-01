# Focusboard

[![Vercel](https://img.shields.io/badge/deployed%20on-Vercel-black)](https://focusboard-git-main-claire-donalds-projects.vercel.app/)

A focused Kanban-style board with WIP limits, colored tags, and cloud sync.

## Features

- **Kanban Board** - Drag-and-drop cards between customizable columns
- **Work/Personal Swimlanes** - Separate tasks into collapsible Work and Personal rows
- **WIP Limits** - Set work-in-progress limits per column with visual warnings
- **Smart Card Creation** - Auto-suggest emojis and tags based on card title keywords
- **Colored Tags** - Organize cards with predefined tag categories (Priority, Type, Effort) and custom colors
- **Multi-User Support** - Each user gets their own private board with Supabase authentication
- **Cloud Sync** - Sync your board across devices when logged in
- **Undo/Redo** - Full history support with keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
- **Card Relationships** - Link related cards with "blocks", "blocked by", and "related to" relationships
- **Keyboard Navigation** - Navigate and manage cards without leaving the keyboard
- **Filtering** - Filter cards by search, column, tag, due date, or blocker status
- **Export/Import** - Backup and restore your data in JSON or CSV format
- **Metrics Dashboard** - Track completed cards, cycle time, and WIP violations
- **Timeline View** - Gantt-style chart showing cards from creation to due date
- **Smart Urgency** - Visual indicators based on due date proximity (overdue, due soon, this week)
- **Stale Backlog Warnings** - Alerts for cards sitting in backlog without due dates
- **Auto-Priority** - Optionally auto-assign priority tags based on due dates
- **Dark Mode** - Light, dark, or system theme with smooth transitions
- **Celebrations** - Confetti animation when completing tasks (can be disabled)
- **Custom Backgrounds** - Upload your own background image
- **Responsive Design** - Works on desktop and tablet
- **Webhook API** - Add cards from Apple Shortcuts, Zapier, or any automation tool
- **Pomodoro Timer** - 25-minute focus sessions with break reminders and streak tracking
- **AI Features** (requires Anthropic API key):
  - **Natural Language Cards** - Type "urgent bug fix login page by friday" and AI parses title, tags, due date
  - **Daily Focus** - AI suggests your top 3-5 tasks based on due dates and priorities
  - **Weekly Planning** - 7-day calendar view with AI scheduling suggestions
  - **Smart Task Breakdown** - AI generates subtasks for complex cards
- **Goals Tracking** - Tag cards with goals for big-picture organization

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck and build for production |
| `npm run typecheck` | Run TypeScript typechecking |
| `npm run lint` | Run ESLint |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run preview` | Preview the production build |

## Multi-User Setup (Optional)

To enable authentication and multi-user support:

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Copy `.env.example` to `.env.local`
3. Fill in your Supabase URL and anon key
4. Run the SQL setup in your Supabase dashboard (see [docs/SUPABASE.md](docs/SUPABASE.md))
5. Enable Email auth in Supabase Authentication settings

Each user will have their own private board with isolated data.

## Webhook API

Add cards to Focusboard from external tools like Apple Shortcuts, Zapier, or custom scripts.

```bash
curl -X POST https://your-app.vercel.app/api/webhook/add-card \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy coffee", "secret": "your-secret"}'
```

See [docs/API.md](docs/API.md) for full documentation.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Arrow keys` | Navigate between cards |
| `Enter` | Open selected card |
| `N` | Add new card to focused column |
| `D` | Mark focused card as Done |
| `Delete/Backspace` | Delete selected card |
| `Escape` | Close modal / clear search |
| `?` | Show keyboard shortcuts |

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- @dnd-kit (drag and drop)
- Supabase (optional auth & storage)
- Vercel (hosting & serverless functions)
- Vitest + React Testing Library

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical architecture and data model |
| [TESTING.md](TESTING.md) | Testing strategy and guidelines |
| [docs/API.md](docs/API.md) | Webhook API for external integrations |
| [docs/SUPABASE.md](docs/SUPABASE.md) | Database schema and RLS setup |

## License

MIT
