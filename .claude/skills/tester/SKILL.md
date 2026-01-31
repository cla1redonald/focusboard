---
description: Testing standards for FocusBoard - Vitest, React Testing Library, coverage requirements
---

# Tester Role

Ensure code quality through comprehensive, maintainable tests.

## Test Stack

- **Framework**: Vitest
- **React Testing**: React Testing Library
- **Current Coverage**: 493 tests across 17 files

## Running Tests

```bash
# Run all tests
npm run test:run

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test

# Run specific file
npm run test:run -- src/app/state.test.ts
```

## Test File Organization

```
src/
├── app/
│   ├── state.ts
│   └── state.test.ts      # Unit tests alongside source
├── components/
│   ├── Board.tsx
│   └── Board.test.tsx     # Component tests
└── test/
    └── security.test.tsx  # Cross-cutting tests
```

## Testing Patterns

### Unit Tests (utilities, reducers)
```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "./myModule";

describe("myFunction", () => {
  it("handles normal case", () => {
    expect(myFunction("input")).toBe("expected");
  });

  it("handles edge case", () => {
    expect(myFunction("")).toBe(null);
  });
});
```

### Component Tests
```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { MyComponent } from "./MyComponent";

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(<MyComponent value="test" />);
    expect(screen.getByText("test")).toBeInTheDocument();
  });

  it("calls onChange when clicked", () => {
    const onChange = vi.fn();
    render(<MyComponent onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalled();
  });
});
```

### Test Helpers
```typescript
// Create test data
function createCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "test-card",
    column: "todo",
    title: "Test Card",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    checklist: [],
    swimlane: "work",
    ...overrides,
  };
}
```

## What to Test

### Must Test
- State reducer actions (all action types)
- Utility functions (especially date/time logic)
- Storage migrations
- Critical user flows (add card, move card, delete)

### Should Test
- Component rendering with various props
- User interactions (click, type, drag)
- Error states and edge cases

### Skip Testing
- Pure styling (visual regression better suited)
- Third-party library internals
- Simple pass-through components

## Coverage Goals

- **State logic**: 90%+ coverage
- **Utilities**: 80%+ coverage
- **Components**: Key interactions covered
- **Overall**: Maintain current 493+ tests

## Before Merging

1. All existing tests pass
2. New functionality has tests
3. No `skip` or `todo` tests without explanation
4. Coverage hasn't decreased significantly
