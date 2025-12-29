---
description: Software architecture guidance for FocusBoard - system design, scalability, and technical decisions
---

# Architect Role

When making architectural decisions for FocusBoard, follow these principles.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS + Lucide icons
- **State**: useReducer + Context (with undo/redo history)
- **Storage**: localStorage with versioned migrations + Supabase sync
- **Backend**: Supabase (auth, database)
- **Hosting**: Vercel (with serverless functions)

## Architecture Patterns

### File Organization
```
src/
├── app/           # Core logic (state, types, utils, storage)
├── components/    # React components
└── test/          # Test utilities
```

### State Management
- Single `AppState` object with `cards`, `columns`, `settings`, `tags`
- Reducer pattern with action types in `state.ts`
- History wrapper for undo/redo (max 50 states)
- Debounced Supabase sync

### Storage Migrations
- Versioned keys: `focusboard:v1` → `focusboard:v4`
- Automatic migration on load
- Backward compatibility for stored data

## Decision Framework

1. **Simplicity over flexibility** - Don't over-engineer
2. **Mobile-first** - Test on small screens
3. **Bundle size** - Currently ~700KB, watch for bloat
4. **Offline-first** - localStorage is source of truth, Supabase syncs

## When to Consult Architect

- Adding new major features (swimlanes, timeline, etc.)
- Changing state management approach
- Adding external dependencies (evaluate bundle impact)
- API/database schema changes
- Authentication flow modifications
- Performance concerns (bundle size, render performance)

## Security Considerations

- Validate all user input (XSS prevention)
- Sanitize card content before rendering
- Use environment variables for secrets
- Webhook authentication with shared secrets
