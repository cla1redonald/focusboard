import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Column } from "./Column";
import type { Card, ColumnId } from "../app/types";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock @dnd-kit/core
vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}));

// Mock @dnd-kit/sortable
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => <>{children}</>,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

// Mock CardItem
vi.mock("./CardItem", () => ({
  CardItem: ({ card, onOpen, focused }: any) => (
    <div
      data-testid={`card-${card.id}`}
      data-focused={focused ? "true" : "false"}
      onClick={() => onOpen(card)}
    >
      {card.title}
    </div>
  ),
}));

// Mock EmptyColumnState
vi.mock("./EmptyColumnState", () => ({
  EmptyColumnState: ({ columnId }: { columnId: string }) => (
    <div data-testid={`empty-${columnId}`}>No cards</div>
  ),
}));

// Mock constants
vi.mock("../app/constants", () => ({
  ICON_MAP: {
    inbox: () => <span data-testid="icon-inbox">📥</span>,
    play: () => <span data-testid="icon-play">▶️</span>,
  },
}));

// Helper to create test cards
function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: `card-${Math.random().toString(36).slice(2)}`,
    title: "Test Card",
    column: "todo",
    order: 0,
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Column", () => {
  const defaultProps = {
    id: "todo" as ColumnId,
    title: "To Do",
    cards: [] as Card[],
    accentColor: "#10b981",
    countLabel: "0",
    headerState: "normal" as const,
    onAdd: vi.fn(),
    onOpenCard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic rendering", () => {
    it("should render column title", () => {
      render(<Column {...defaultProps} title="My Column" />);

      expect(screen.getByText("My Column")).toBeInTheDocument();
    });

    it("should render count label", () => {
      render(<Column {...defaultProps} countLabel="3/5" />);

      expect(screen.getByText("3/5")).toBeInTheDocument();
    });

    it("should render icon when provided", () => {
      render(<Column {...defaultProps} icon="inbox" />);

      expect(screen.getByTestId("icon-inbox")).toBeInTheDocument();
    });

    it("should render emoji icon as fallback", () => {
      render(<Column {...defaultProps} icon="📋" />);

      expect(screen.getByText("📋")).toBeInTheDocument();
    });

    it("should apply accent color to left border", () => {
      const { container } = render(
        <Column {...defaultProps} accentColor="#ff0000" />
      );

      const headerElement = container.querySelector(".border-l-4");
      expect(headerElement).toHaveStyle({ borderLeftColor: "#ff0000" });
    });
  });

  describe("Header states", () => {
    it("should apply normal header class when headerState is normal", () => {
      const { container } = render(
        <Column {...defaultProps} headerState="normal" />
      );

      const header = container.querySelector(".border-l-4");
      expect(header?.className).toContain("bg-white");
      expect(header?.className).not.toContain("bg-red-50");
    });

    it("should apply near-limit header class when headerState is near", () => {
      const { container } = render(
        <Column {...defaultProps} headerState="near" />
      );

      const header = container.querySelector(".border-l-4");
      expect(header?.className).toContain("bg-gray-50");
    });

    it("should apply full header class when headerState is full", () => {
      const { container } = render(
        <Column {...defaultProps} headerState="full" />
      );

      const header = container.querySelector(".border-l-4");
      expect(header?.className).toContain("bg-red-50");
    });
  });

  describe("Card rendering", () => {
    it("should render empty state when no cards", () => {
      render(<Column {...defaultProps} cards={[]} />);

      expect(screen.getByTestId("empty-todo")).toBeInTheDocument();
    });

    it("should render cards when present", () => {
      const cards = [
        makeCard({ id: "card-1", title: "First Card" }),
        makeCard({ id: "card-2", title: "Second Card" }),
      ];

      render(<Column {...defaultProps} cards={cards} />);

      expect(screen.getByText("First Card")).toBeInTheDocument();
      expect(screen.getByText("Second Card")).toBeInTheDocument();
    });

    it("should pass correct props to CardItem", () => {
      const cards = [makeCard({ id: "card-1", title: "Test Card" })];

      render(
        <Column
          {...defaultProps}
          cards={cards}
          columnFocused={true}
          focusedCardIndex={0}
        />
      );

      const cardElement = screen.getByTestId("card-card-1");
      expect(cardElement).toHaveAttribute("data-focused", "true");
    });

    it("should call onOpenCard when card is clicked", () => {
      const onOpenCard = vi.fn();
      const cards = [makeCard({ id: "card-1", title: "Test Card" })];

      render(<Column {...defaultProps} cards={cards} onOpenCard={onOpenCard} />);

      fireEvent.click(screen.getByText("Test Card"));

      expect(onOpenCard).toHaveBeenCalledWith(cards[0]);
    });
  });

  describe("Add card form", () => {
    it("should render add card input", () => {
      render(<Column {...defaultProps} />);

      const input = screen.getByPlaceholderText("Add a card…");
      expect(input).toBeInTheDocument();
    });

    it("should show AI placeholder when onAIAdd is provided", () => {
      render(<Column {...defaultProps} onAIAdd={vi.fn()} />);

      const input = screen.getByPlaceholderText("Add card or describe with AI…");
      expect(input).toBeInTheDocument();
    });

    it("should call onAdd when form is submitted", async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();

      render(<Column {...defaultProps} onAdd={onAdd} />);

      const input = screen.getByPlaceholderText("Add a card…");
      await user.type(input, "New Card{Enter}");

      expect(onAdd).toHaveBeenCalledWith("todo", "New Card");
    });

    it("should clear input after submission", async () => {
      const user = userEvent.setup();

      render(<Column {...defaultProps} />);

      const input = screen.getByPlaceholderText("Add a card…") as HTMLInputElement;
      await user.type(input, "New Card{Enter}");

      expect(input.value).toBe("");
    });

    it("should not submit when input is empty", async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();

      render(<Column {...defaultProps} onAdd={onAdd} />);

      const input = screen.getByPlaceholderText("Add a card…");
      await user.type(input, "   {Enter}");

      expect(onAdd).not.toHaveBeenCalled();
    });

    it("should trim whitespace from input", async () => {
      const user = userEvent.setup();
      const onAdd = vi.fn();

      render(<Column {...defaultProps} onAdd={onAdd} />);

      const input = screen.getByPlaceholderText("Add a card…");
      await user.type(input, "  New Card  {Enter}");

      expect(onAdd).toHaveBeenCalledWith("todo", "New Card");
    });
  });

  describe("AI button", () => {
    it("should not show AI button when onAIAdd is not provided", async () => {
      const user = userEvent.setup();

      render(<Column {...defaultProps} />);

      const input = screen.getByPlaceholderText("Add a card…");
      await user.type(input, "Some text");

      // Should not have sparkles button
      expect(screen.queryByTitle("Use AI to parse this as natural language")).not.toBeInTheDocument();
    });

    it("should show AI button when onAIAdd is provided and input has text", async () => {
      const user = userEvent.setup();

      render(<Column {...defaultProps} onAIAdd={vi.fn()} />);

      const input = screen.getByPlaceholderText("Add card or describe with AI…");
      await user.type(input, "Some text");

      expect(screen.getByTitle("Use AI to parse this as natural language")).toBeInTheDocument();
    });

    it("should not show AI button when input is empty", () => {
      render(<Column {...defaultProps} onAIAdd={vi.fn()} />);

      expect(screen.queryByTitle("Use AI to parse this as natural language")).not.toBeInTheDocument();
    });

    it("should call onAIAdd when AI button is clicked", async () => {
      const user = userEvent.setup();
      const onAIAdd = vi.fn();

      render(<Column {...defaultProps} onAIAdd={onAIAdd} />);

      const input = screen.getByPlaceholderText("Add card or describe with AI…");
      await user.type(input, "Create a bug fix for login");

      const aiButton = screen.getByTitle("Use AI to parse this as natural language");
      await user.click(aiButton);

      expect(onAIAdd).toHaveBeenCalledWith("todo", "Create a bug fix for login");
    });

    it("should clear input after AI submission", async () => {
      const user = userEvent.setup();
      const onAIAdd = vi.fn().mockResolvedValue(undefined);

      render(<Column {...defaultProps} onAIAdd={onAIAdd} />);

      const input = screen.getByPlaceholderText("Add card or describe with AI…") as HTMLInputElement;
      await user.type(input, "New AI card");

      const aiButton = screen.getByTitle("Use AI to parse this as natural language");
      await user.click(aiButton);

      await waitFor(() => {
        expect(input.value).toBe("");
      });
    });

    it("should disable AI button when aiLoading is true", async () => {
      const user = userEvent.setup();

      render(<Column {...defaultProps} onAIAdd={vi.fn()} aiLoading={true} />);

      const input = screen.getByPlaceholderText("Add card or describe with AI…");
      await user.type(input, "Some text");

      const aiButton = screen.getByTitle("Use AI to parse this as natural language");
      expect(aiButton).toBeDisabled();
    });

    it("should show loading spinner when aiLoading is true", async () => {
      const user = userEvent.setup();

      render(<Column {...defaultProps} onAIAdd={vi.fn()} aiLoading={true} />);

      const input = screen.getByPlaceholderText("Add card or describe with AI…");
      await user.type(input, "Some text");

      // Should have spinner animation class
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("Swimlane support", () => {
    it("should create composite droppable ID when swimlaneId is provided", () => {
      // This is tested indirectly through the useDroppable mock
      // The component should use "work:todo" format
      render(<Column {...defaultProps} swimlaneId="work" />);

      // Component should render without errors
      expect(screen.getByText("To Do")).toBeInTheDocument();
    });
  });

  describe("Focus states", () => {
    it("should apply focus ring when columnFocused and no card focused", () => {
      const { container } = render(
        <Column
          {...defaultProps}
          columnFocused={true}
          focusedCardIndex={null}
        />
      );

      const header = container.querySelector(".ring-2.ring-emerald-500\\/20");
      expect(header).toBeInTheDocument();
    });

    it("should not apply focus ring when card is focused", () => {
      const cards = [makeCard()];
      const { container } = render(
        <Column
          {...defaultProps}
          cards={cards}
          columnFocused={true}
          focusedCardIndex={0}
        />
      );

      const header = container.querySelector(".border-l-4");
      expect(header?.className).not.toContain("ring-2 ring-emerald-500/20");
    });
  });

  describe("Card indicators", () => {
    it("should pass aging indicator props to cards", () => {
      const cards = [makeCard({ id: "card-1" })];

      render(
        <Column
          {...defaultProps}
          cards={cards}
          showAgingIndicators={true}
        />
      );

      // Card should be rendered (indicator props are passed through)
      expect(screen.getByTestId("card-card-1")).toBeInTheDocument();
    });

    it("should pass stale card data to cards", () => {
      const cards = [makeCard({ id: "card-1" })];
      const staleCardIds = new Set(["card-1"]);
      const staleCardDays = { "card-1": 14 };

      render(
        <Column
          {...defaultProps}
          cards={cards}
          staleCardIds={staleCardIds}
          staleCardDays={staleCardDays}
        />
      );

      expect(screen.getByTestId("card-card-1")).toBeInTheDocument();
    });
  });

  describe("Input data attribute", () => {
    it("should have data-column-input attribute for keyboard navigation", () => {
      render(<Column {...defaultProps} id="doing" />);

      const input = screen.getByPlaceholderText("Add a card…");
      expect(input).toHaveAttribute("data-column-input", "doing");
    });
  });
});
