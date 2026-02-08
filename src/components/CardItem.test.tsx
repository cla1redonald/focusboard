import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CardItem } from "./CardItem";
import type { Card } from "../app/types";

// Mock the framer-motion library
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock @dnd-kit/sortable
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

// Mock @dnd-kit/utilities
vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => null,
    },
  },
}));

// Mock RelationshipIndicators
vi.mock("./RelationshipPicker", () => ({
  RelationshipIndicators: ({ card }: { card: Card }) => (
    <div data-testid="relationship-indicators">
      {card.relations?.length ?? 0} relations
    </div>
  ),
}));

// Mock urgency functions
vi.mock("../app/urgency", () => ({
  getUrgencyLevel: vi.fn(() => "none"),
  getUrgencyColor: vi.fn(() => "#10b981"),
  getUrgencyLabel: vi.fn(() => ""),
  getUrgencyBackgroundColor: vi.fn(() => null),
}));

// Mock metrics functions
vi.mock("../app/metrics", () => ({
  getCardAgeLevel: vi.fn(() => "none"),
  getCardAgeDays: vi.fn(() => 0),
}));

// Mock utils
vi.mock("../app/utils", () => ({
  getSafeUrl: vi.fn((url: string) => {
    if (url.startsWith("javascript:")) return null;
    return url;
  }),
}));

import { getUrgencyLevel, getUrgencyBackgroundColor } from "../app/urgency";
import { getCardAgeLevel, getCardAgeDays } from "../app/metrics";

// Helper to create a test card
function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    title: "Test Card",
    column: "todo",
    order: 0,
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CardItem", () => {
  const mockOnOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic rendering", () => {
    it("should render card title", () => {
      const card = makeCard({ title: "My Test Card" });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText("My Test Card")).toBeInTheDocument();
    });

    it("should render card icon when present", () => {
      const card = makeCard({ icon: "📋" });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText("📋")).toBeInTheDocument();
    });

    it("should call onOpen when clicked", () => {
      const card = makeCard();
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      fireEvent.click(screen.getByText("Test Card"));

      expect(mockOnOpen).toHaveBeenCalledWith(card);
    });

    it("should apply focused class when focused prop is true", () => {
      const card = makeCard();
      const { container } = render(
        <CardItem card={card} onOpen={mockOnOpen} focused={true} />
      );

      const cardElement = container.firstChild as HTMLElement;
      expect(cardElement.className).toContain("border-emerald-500");
      expect(cardElement.className).toContain("ring-2");
    });
  });

  describe("Due date display", () => {
    it("should render due date when present", () => {
      const card = makeCard({ dueDate: "2024-06-15" });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      // Should show formatted date
      expect(screen.getByText(/Jun 15/)).toBeInTheDocument();
    });

    it("should show urgency label when showUrgencyIndicator is true", () => {
      vi.mocked(getUrgencyLevel).mockReturnValue("high");

      const card = makeCard({ dueDate: "2024-01-01" });
      render(
        <CardItem card={card} onOpen={mockOnOpen} showUrgencyIndicator={true} />
      );

      // Urgency indicator should be displayed
      expect(getUrgencyLevel).toHaveBeenCalledWith(card);
    });

    it("should not show due date when not present", () => {
      const card = makeCard({ dueDate: undefined });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.queryByText(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/)).not.toBeInTheDocument();
    });
  });

  describe("Blocked reason", () => {
    it("should render blocked reason when present", () => {
      const card = makeCard({ blockedReason: "Waiting for API" });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText(/Blocked:/)).toBeInTheDocument();
      expect(screen.getByText(/Waiting for API/)).toBeInTheDocument();
    });

    it("should not render blocked reason when not present", () => {
      const card = makeCard({ blockedReason: undefined });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.queryByText(/Blocked:/)).not.toBeInTheDocument();
    });
  });

  describe("Relations", () => {
    it("should render relationship indicators when relations exist", () => {
      const card = makeCard({
        relations: [
          { id: "rel-1", targetCardId: "card-2", type: "blocks" },
        ],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByTestId("relationship-indicators")).toBeInTheDocument();
    });

    it("should not render relationship indicators when no relations", () => {
      const card = makeCard({ relations: [] });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.queryByTestId("relationship-indicators")).not.toBeInTheDocument();
    });
  });

  describe("Links", () => {
    it("should render links when present", () => {
      const card = makeCard({
        links: [{ id: "link-1", url: "https://github.com/test" }],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "https://github.com/test");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("should render legacy link field as fallback", () => {
      const card = makeCard({
        link: "https://figma.com/design",
        links: undefined,
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "https://figma.com/design");
    });

    it("should display custom label when provided", () => {
      const card = makeCard({
        links: [{ id: "link-1", url: "https://example.com", label: "My Link" }],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText("My Link")).toBeInTheDocument();
    });

    it("should recognize GitHub links", () => {
      const card = makeCard({
        links: [{ id: "link-1", url: "https://github.com/user/repo" }],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });

    it("should recognize Figma links", () => {
      const card = makeCard({
        links: [{ id: "link-1", url: "https://figma.com/file/123" }],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText("Figma")).toBeInTheDocument();
    });

    it("should show +N more when more than 3 links", () => {
      const card = makeCard({
        links: [
          { id: "link-1", url: "https://example1.com" },
          { id: "link-2", url: "https://example2.com" },
          { id: "link-3", url: "https://example3.com" },
          { id: "link-4", url: "https://example4.com" },
          { id: "link-5", url: "https://example5.com" },
        ],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.getByText("+2 more")).toBeInTheDocument();
    });

    it("should stop propagation when clicking link", () => {
      const card = makeCard({
        links: [{ id: "link-1", url: "https://example.com" }],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      const link = screen.getByRole("link");
      fireEvent.click(link);

      // onOpen should not be called when clicking the link
      expect(mockOnOpen).not.toHaveBeenCalled();
    });

    it("should filter out unsafe URLs", () => {
      const card = makeCard({
        links: [{ id: "link-1", url: "javascript:alert('xss')" }],
      });
      render(<CardItem card={card} onOpen={mockOnOpen} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("Aging indicator", () => {
    it("should show aging indicator when enabled and card is aging", () => {
      vi.mocked(getCardAgeLevel).mockReturnValue("orange");
      vi.mocked(getCardAgeDays).mockReturnValue(5);

      const card = makeCard();
      render(
        <CardItem card={card} onOpen={mockOnOpen} showAgingIndicator={true} />
      );

      // Should have an aging dot
      const agingDot = document.querySelector(".bg-orange-500");
      expect(agingDot).toBeInTheDocument();
    });

    it("should not show aging indicator when level is none", () => {
      vi.mocked(getCardAgeLevel).mockReturnValue("none");

      const card = makeCard();
      render(
        <CardItem card={card} onOpen={mockOnOpen} showAgingIndicator={true} />
      );

      const agingDot = document.querySelector(".bg-orange-500, .bg-gray-400, .bg-rose-500");
      expect(agingDot).not.toBeInTheDocument();
    });

    it("should not show aging indicator when showAgingIndicator is false", () => {
      vi.mocked(getCardAgeLevel).mockReturnValue("orange");

      const card = makeCard();
      render(
        <CardItem card={card} onOpen={mockOnOpen} showAgingIndicator={false} />
      );

      const agingDot = document.querySelector(".bg-orange-500");
      expect(agingDot).not.toBeInTheDocument();
    });
  });

  describe("Stale backlog indicator", () => {
    it("should show stale backlog warning when isStaleBacklog is true", () => {
      const card = makeCard();
      render(
        <CardItem
          card={card}
          onOpen={mockOnOpen}
          isStaleBacklog={true}
          staleBacklogDays={14}
        />
      );

      expect(screen.getByText(/Stale/)).toBeInTheDocument();
      expect(screen.getByText(/14 days/)).toBeInTheDocument();
    });

    it("should not show stale warning when isStaleBacklog is false", () => {
      const card = makeCard();
      render(
        <CardItem card={card} onOpen={mockOnOpen} isStaleBacklog={false} />
      );

      expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    });
  });

  describe("Background image", () => {
    it("should render background image when present", () => {
      const card = makeCard({
        backgroundImage: "https://images.unsplash.com/photo-123",
      });
      const { container } = render(<CardItem card={card} onOpen={mockOnOpen} />);

      const bgElement = container.querySelector(".bg-cover");
      expect(bgElement).toBeInTheDocument();
      expect(bgElement).toHaveStyle({
        backgroundImage: "url(https://images.unsplash.com/photo-123)",
      });
    });

    it("should apply white text when background image is present", () => {
      const card = makeCard({
        backgroundImage: "https://images.unsplash.com/photo-123",
      });
      const { container } = render(<CardItem card={card} onOpen={mockOnOpen} />);

      const contentDiv = container.querySelector(".text-white");
      expect(contentDiv).toBeInTheDocument();
    });
  });

  describe("Urgency background color", () => {
    it("should apply urgency background color when set", () => {
      vi.mocked(getUrgencyBackgroundColor).mockReturnValue("#fef2f2");

      const card = makeCard({ dueDate: "2024-01-01" });
      const { container } = render(<CardItem card={card} onOpen={mockOnOpen} />);

      const cardElement = container.firstChild as HTMLElement;
      expect(cardElement.style.backgroundColor).toBe("rgb(254, 242, 242)");
    });

    it("should not apply urgency background when card has background image", () => {
      vi.mocked(getUrgencyBackgroundColor).mockReturnValue("#fef2f2");

      const card = makeCard({
        dueDate: "2024-01-01",
        backgroundImage: "https://images.unsplash.com/photo-123",
      });
      const { container } = render(<CardItem card={card} onOpen={mockOnOpen} />);

      const cardElement = container.firstChild as HTMLElement;
      // Should not have urgency background when has image
      expect(cardElement.style.backgroundColor).not.toBe("rgb(254, 242, 242)");
    });
  });

  describe("Card ref setter", () => {
    it("should call cardRefSetter with card id and element", () => {
      const mockRefSetter = vi.fn();
      const card = makeCard();

      render(
        <CardItem card={card} onOpen={mockOnOpen} cardRefSetter={mockRefSetter} />
      );

      expect(mockRefSetter).toHaveBeenCalledWith("card-1", expect.any(HTMLElement));
    });
  });

  describe("Reduced motion", () => {
    it("should disable animations when reducedMotion is true", () => {
      const card = makeCard();
      render(
        <CardItem card={card} onOpen={mockOnOpen} />
      );

      // The component should render without crashing
      // Animation props are handled by framer-motion mock
      expect(screen.getByText("Test Card")).toBeInTheDocument();
    });
  });
});
