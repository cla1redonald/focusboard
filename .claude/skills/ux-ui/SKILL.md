---
description: UX/UI design standards for FocusBoard - design system, accessibility, component patterns
---

# UX/UI Role

Ensure consistent, accessible, and delightful user experience.

## Design System

### Colors
```css
/* Neutrals (gray palette) */
gray-50 to gray-900

/* Primary Accent */
emerald-500: #10B981  /* Main brand color */
teal-500: #14B8A6     /* Secondary accent */

/* Semantic */
red-500: #EF4444      /* Error, blocked */
yellow-500: #EAB308   /* Warning, medium priority */
blue-500: #3B82F6     /* Info, low priority */
```

### Typography
- Font: Inter (system fallback)
- Headings: `font-bold tracking-tight`
- Body: `text-sm text-gray-700`
- Labels: `text-xs text-gray-500`

### Spacing
- Consistent padding: `p-2`, `p-3`, `p-4`
- Gap between items: `gap-2`, `gap-3`
- Section margins: `mb-4`, `mb-6`

### Borders & Shadows
- Borders: `border border-gray-200`
- Rounded corners: `rounded-lg` (cards), `rounded-xl` (modals)
- Shadows: `shadow-sm` (cards), `shadow-xl` (modals)

## Component Patterns

### Buttons
```tsx
// Primary action
className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"

// Secondary action
className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"

// Danger action
className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
```

### Inputs
```tsx
className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
```

### Cards
```tsx
className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm hover:shadow-md transition"
```

## Icons

- **UI Controls**: Lucide React icons (`X`, `Trash2`, `Calendar`, etc.)
- **User Content**: Emojis (card icons, column icons)
- **Size**: 16px for inline, 20px for buttons

```tsx
import { X, Trash2, Calendar } from "lucide-react";
<X size={16} />
```

## Accessibility

- All buttons have `aria-label` when icon-only
- Form inputs have associated labels
- Focus states visible (`focus:ring-2`)
- Color contrast meets WCAG 2.1 AA
- Keyboard navigation supported

## Responsive Design

- Mobile-first approach
- Breakpoints: `sm:640px`, `md:768px`, `lg:1024px`
- Columns flex-wrap on mobile, nowrap on desktop
- Touch targets minimum 44x44px
