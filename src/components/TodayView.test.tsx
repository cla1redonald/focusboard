import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COLUMNS, DEFAULT_SETTINGS } from "../app/constants";
import type { Card } from "../app/types";
import { TodayView } from "./TodayView";

function card(overrides: Partial<Card>): Card {
  return {
    id: overrides.id ?? "card",
    column: overrides.column ?? "todo",
    title: overrides.title ?? "Card",
    order: overrides.order ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T09:00:00.000Z",
    tags: [],
    checklist: [],
    ...overrides,
  };
}

const defaultProps = {
  open: true,
  cards: [card({ id: "due", title: "Due task", dueDate: "2026-06-08" })],
  columns: DEFAULT_COLUMNS,
  settings: DEFAULT_SETTINGS,
  captureCount: 0,
  onClose: vi.fn(),
  onOpenCard: vi.fn(),
  onStartCard: vi.fn(),
  onOpenCapture: vi.fn(),
};

describe("TodayView", () => {
  it("renders as a modal dialog and keeps tab focus inside", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <button>Outside</button>
        <TodayView {...defaultProps} onClose={onClose} />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Today" });
    const closeButton = screen.getByRole("button", { name: "Close Today" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(closeButton).toHaveFocus());

    screen.getByRole("button", { name: /Capture inbox/i }).focus();
    await user.tab();

    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens already in-progress cards instead of starting them again", async () => {
    const user = userEvent.setup();
    const onOpenCard = vi.fn();
    const onStartCard = vi.fn();
    const doingCard = card({ id: "doing", title: "Current task", column: "doing" });

    render(
      <TodayView
        {...defaultProps}
        cards={[doingCard]}
        onOpenCard={onOpenCard}
        onStartCard={onStartCard}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Continue/i }));

    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ id: "doing" }));
    expect(onStartCard).not.toHaveBeenCalled();
  });
});
