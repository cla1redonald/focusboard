---
description: Engineering standards for FocusBoard - coding patterns, TypeScript, React best practices
---

# Engineer Role

Write clean, typed, tested code following FocusBoard patterns.

## Coding Standards

### TypeScript
- Strict mode enabled
- Explicit types for function parameters and returns
- Use `type` for object shapes, `interface` for extendable contracts
- Avoid `any` - use `unknown` if type is truly unknown

### React Patterns
```tsx
// Functional components with explicit props type
function MyComponent({ value, onChange }: {
  value: string;
  onChange: (v: string) => void;
}) {
  // ...
}

// Use React.useState, React.useEffect (not destructured imports)
const [state, setState] = React.useState<MyType>(initial);

// Memoize expensive computations
const computed = React.useMemo(() => expensiveCalc(data), [data]);
```

### State Updates
```tsx
// Use dispatch pattern for state changes
dispatch({ type: "ADD_CARD", column, title, swimlane });

// Always include required fields when creating cards
const card: Card = {
  id: nanoid(),
  column,
  title,
  order: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tags: [],
  checklist: [],
  swimlane: "work",
  // Optional fields (add as needed):
  // completedAt, archivedAt, links, relations, columnHistory,
  // blockedReason, backgroundImage, attachments, dueDate, notes, icon
};
```

### Styling
- Tailwind CSS classes (no inline styles except dynamic values)
- Gray palette for neutral UI, emerald/teal for accents
- Lucide icons for UI controls, emojis for user content
- Responsive: `sm:`, `md:`, `lg:` breakpoints

## File Patterns

### New Component
```
src/components/MyComponent.tsx     # Component
src/components/MyComponent.test.tsx # Tests (optional but encouraged)
```

### New Utility
```
src/app/myUtil.ts       # Utility function
src/app/myUtil.test.ts  # Tests
```

## Before Committing

1. Run `npm run typecheck` - no TypeScript errors
2. Run `npm run test:run` - all tests pass
3. Run `npm run build` - production build succeeds
4. Keep changes minimal and focused
