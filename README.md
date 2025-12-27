# Focusboard

[![Vercel](https://img.shields.io/badge/deployed%20on-Vercel-black)](https://focusboard-git-main-claire-donalds-projects.vercel.app/)

A focused Kanban-style board with WIP limits, colored tags, and cloud sync.

## Features

- **Kanban Board** - Drag-and-drop cards between customizable columns
- **WIP Limits** - Set work-in-progress limits per column with visual warnings
- **Colored Tags** - Organize cards with predefined tag categories (Priority, Type, Effort) and custom colors
- **Cloud Sync** - Optional Supabase authentication for syncing across devices
- **Undo/Redo** - Full history support with keyboard shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
- **Card Relationships** - Link related cards with "blocks", "blocked by", and "related to" relationships
- **Keyboard Navigation** - Navigate and manage cards without leaving the keyboard
- **Filtering** - Filter cards by search, column, tag, due date, or blocker status
- **Export/Import** - Backup and restore your data in JSON or CSV format
- **Metrics Dashboard** - Track completed cards, cycle time, and WIP violations
- **Celebrations** - Confetti animation when completing tasks (can be disabled)
- **Custom Backgrounds** - Upload your own background image
- **Responsive Design** - Works on desktop and tablet

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

## Cloud Sync Setup (Optional)

To enable cloud sync with Supabase:

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Copy `.env.example` to `.env.local`
3. Fill in your Supabase URL and anon key
4. Run the SQL migration in your Supabase dashboard (see `supabase/` folder if available)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Shift + Z` | Redo |
| `Arrow keys` | Navigate between cards |
| `Enter` | Open selected card |
| `Delete/Backspace` | Delete selected card |
| `Escape` | Close modal / clear search |

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS
- @dnd-kit (drag and drop)
- Supabase (optional auth & storage)
- Vitest + React Testing Library

## License

MIT
