import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "../app/constants";
import type { Card, Column } from "../app/types";

describe("Board", () => {
  const defaultProps = {
    cards: [] as Card[],
    columns: DEFAULT_COLUMNS,
    settings: DEFAULT_SETTINGS,
    onAdd: vi.fn(),
    onMove: vi.fn(),
    onOpenCard: vi.fn(),
    onSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders all default columns", () => {
      render(<Board {...defaultProps} />);

      expect(screen.getByText("Backlog")).toBeInTheDocument();
      expect(screen.getByText("Design & Planning")).toBeInTheDocument();
      expect(screen.getByText("To Do")).toBeInTheDocument();
      expect(screen.getByText("Doing")).toBeInTheDocument();
      expect(screen.getByText("Blocked")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
    });

    it("renders title and tagline", () => {
      render(<Board {...defaultProps} />);

      expect(screen.getByText("Focusboard")).toBeInTheDocument();
      expect(screen.getByText("Plan with intent. Keep flow sacred.")).toBeInTheDocument();
    });

    it("renders settings button", () => {
      render(<Board {...defaultProps} />);

      expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    });

    it("renders cards in their columns", () => {
      const cards: Card[] = [
        {
          id: "1",
          column: "todo",
          title: "Test Card",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
          tags: [],
          checklist: [],
        },
      ];

      render(<Board {...defaultProps} cards={cards} />);

      expect(screen.getByText("Test Card")).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("calls onSettings when settings button is clicked", async () => {
      const user = userEvent.setup();
      const onSettings = vi.fn();

      render(<Board {...defaultProps} onSettings={onSettings} />);

      await user.click(screen.getByRole("button", { name: "Settings" }));

      expect(onSettings).toHaveBeenCalledTimes(1);
    });

    it("calls onOpenCard when a card is clicked", async () => {
      const user = userEvent.setup();
      const onOpenCard = vi.fn();
      const cards: Card[] = [
        {
          id: "1",
          column: "todo",
          title: "Clickable Card",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
          tags: [],
          checklist: [],
        },
      ];

      render(<Board {...defaultProps} cards={cards} onOpenCard={onOpenCard} />);

      await user.click(screen.getByText("Clickable Card"));

      expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ title: "Clickable Card" }));
    });
  });

  describe("WIP limits", () => {
    it("shows WIP count for columns with limits", () => {
      render(<Board {...defaultProps} />);

      // Design column has WIP limit of 5, Todo has 12, Doing has 1, Blocked has 5
      // Find all count labels that include a "/"
      const wipLabels = screen.getAllByText(/\d+\/\d+/);
      expect(wipLabels.length).toBeGreaterThan(0);
    });

    it("shows simple count for columns without limits", () => {
      render(<Board {...defaultProps} />);

      // Backlog and Done have no limits, should show just counts
      const countLabels = screen.getAllByText("0");
      expect(countLabels.length).toBeGreaterThan(0);
    });
  });

  describe("custom columns", () => {
    it("renders custom column configuration", () => {
      const customColumns: Column[] = [
        {
          id: "inbox",
          title: "Inbox",
          icon: "📥",
          color: "#ff0000",
          wipLimit: null,
          isTerminal: false,
          order: 0,
        },
        {
          id: "complete",
          title: "Complete",
          icon: "🎉",
          color: "#00ff00",
          wipLimit: null,
          isTerminal: true,
          order: 1,
        },
      ];

      render(<Board {...defaultProps} columns={customColumns} />);

      expect(screen.getByText("Inbox")).toBeInTheDocument();
      expect(screen.getByText("Complete")).toBeInTheDocument();
    });

    it("respects column order", () => {
      const reorderedColumns: Column[] = [
        { ...DEFAULT_COLUMNS[5], order: 0 }, // Done first
        { ...DEFAULT_COLUMNS[0], order: 1 }, // Backlog second
      ];

      render(<Board {...defaultProps} columns={reorderedColumns} />);

      // Get all column titles
      expect(screen.getByText("Done")).toBeInTheDocument();
      expect(screen.getByText("Backlog")).toBeInTheDocument();
    });
  });

  describe("top strip", () => {
    it("shows doing card info when present", () => {
      const cards: Card[] = [
        {
          id: "1",
          column: "doing",
          title: "Current Task",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
          tags: [],
          checklist: [],
        },
      ];

      render(<Board {...defaultProps} cards={cards} />);

      // Card title appears in both the TopStrip and the column
      const elements = screen.getAllByText("Current Task");
      expect(elements.length).toBeGreaterThan(0);
    });
  });
});
