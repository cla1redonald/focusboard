# Focusboard Testing Strategy

## Overview

Focusboard uses **Vitest** as the test runner with **React Testing Library** for component testing. The test suite focuses on ensuring correctness of business logic, state management, and user interactions.

## Test Stack

| Tool | Purpose |
|------|---------|
| Vitest | Test runner and assertion library |
| React Testing Library | Component rendering and interaction |
| jsdom | Browser environment simulation |
| @testing-library/user-event | Realistic user interaction simulation |

## Running Tests

```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm run test

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm run test:run -- src/app/state.test.ts
```

## Test Organization

```
src/
├── app/
│   ├── state.test.ts         # State reducer tests (53 tests)
│   ├── storage.test.ts       # Persistence and migration tests (13 tests)
│   ├── filters.test.ts       # Filtering logic tests (32 tests)
│   ├── metrics.test.ts       # Metrics calculation tests (18 tests)
│   ├── utils.test.ts         # Utility function tests (21 tests)
│   ├── exportImport.test.ts  # Export/import tests (21 tests)
│   └── useKeyboardNav.test.ts # Keyboard navigation tests (22 tests)
├── components/
│   ├── Board.test.tsx        # Board component tests (11 tests)
│   ├── CardModal.test.tsx    # Card editor tests (32 tests)
│   └── SettingsPanel.test.tsx # Settings tests (26 tests)
└── test/
    └── security.test.tsx     # XSS and security tests (33 tests)
```

**Total: 282 tests**

## Testing Patterns

### 1. State Reducer Tests

Test all reducer actions and state transitions:

```typescript
describe("ADD_CARD action", () => {
  it("creates card with correct defaults", () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.dispatch({
        type: "ADD_CARD",
        column: "todo",
        title: "New Task",
      });
    });

    expect(result.current.state.cards).toHaveLength(1);
    expect(result.current.state.cards[0].title).toBe("New Task");
  });
});
```

### 2. Component Tests

Test rendering and user interactions:

```typescript
describe("CardModal", () => {
  it("displays card data when open", () => {
    const card = createCard({ title: "Test Card" });
    render(<CardModal open={true} card={card} {...handlers} />);

    expect(screen.getByDisplayValue("Test Card")).toBeInTheDocument();
  });

  it("calls onSave with updated data", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<CardModal {...defaultProps} onSave={onSave} />);

    await user.clear(screen.getByDisplayValue("Test Card"));
    await user.type(screen.getByRole("textbox", { name: /title/i }), "Updated");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Updated" })
    );
  });
});
```

### 3. Security Tests

Test XSS prevention and data integrity:

```typescript
describe("XSS Prevention", () => {
  it.each(xssPayloads)("safely renders malicious input: %s", (payload) => {
    const card = createCard({ title: payload });
    render(<Board cards={[card]} {...props} />);

    // Script tags should not execute
    expect(document.body.innerHTML).not.toContain("<script>");
  });
});
```

### 4. Storage Migration Tests

Test data migration between versions:

```typescript
describe("storage migration", () => {
  it("migrates v1 state to v3 format", () => {
    localStorage.setItem("focusboard:v1", JSON.stringify(v1State));

    const state = loadState();

    expect(state.columns).toBeDefined();
    expect(state.tagCategories).toBeDefined();
    expect(state.tags).toBeDefined();
  });
});
```

## Test Helpers

### Creating Test Data

```typescript
// Helper to create cards with defaults
const createCard = (overrides: Partial<Card> = {}): Card => ({
  id: "test-card-1",
  column: "todo",
  title: "Test Card",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  tags: [],
  checklist: [],
  ...overrides,
});

// Helper to create full state
const makeState = (overrides: Partial<AppState> = {}): AppState => ({
  cards: [],
  columns: DEFAULT_COLUMNS,
  templates: [],
  settings: DEFAULT_SETTINGS,
  tagCategories: DEFAULT_TAG_CATEGORIES,
  tags: DEFAULT_TAGS,
  ...overrides,
});
```

### Mocking

```typescript
// Mock localStorage
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// Mock timers for animations
vi.useFakeTimers();
act(() => {
  vi.advanceTimersByTime(1000);
});
```

## Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Statements | 80% | ~85% |
| Branches | 75% | ~80% |
| Functions | 80% | ~85% |
| Lines | 80% | ~85% |

### Areas with High Coverage

- State reducer actions
- Filtering logic
- Storage persistence
- Export/import validation

### Areas with Lower Coverage

- Animation components (visual)
- Error boundaries
- Network error handling

## Writing New Tests

### Checklist for New Features

1. **Unit tests** for pure functions (utils, filters, metrics)
2. **Reducer tests** for new actions
3. **Component tests** for UI changes
4. **Integration tests** for feature workflows

### Test File Template

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("FeatureName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders correctly with default props", () => {
      // ...
    });
  });

  describe("interactions", () => {
    it("handles user action correctly", async () => {
      const user = userEvent.setup();
      // ...
    });
  });

  describe("edge cases", () => {
    it("handles empty data gracefully", () => {
      // ...
    });
  });
});
```

## Continuous Integration

Tests run automatically on:
- Every push to main
- Pull request creation
- Pull request updates

```yaml
# .github/workflows/ci.yml
- name: Run tests
  run: npm run test:run
```

## Debugging Tests

### Run Single Test

```bash
npm run test:run -- -t "test name pattern"
```

### Verbose Output

```bash
npm run test:run -- --reporter=verbose
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": ["run", "--no-coverage"],
  "console": "integratedTerminal"
}
```

## Common Issues

### Test Isolation

Each test should be independent. Always reset state:

```typescript
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
```

### Async Operations

Use `waitFor` for async state updates:

```typescript
await waitFor(() => {
  expect(screen.getByText("Updated")).toBeInTheDocument();
});
```

### User Events

Prefer `userEvent` over `fireEvent` for realistic interactions:

```typescript
// Good
const user = userEvent.setup();
await user.click(button);

// Avoid
fireEvent.click(button);
```
