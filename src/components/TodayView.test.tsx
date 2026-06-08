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
  onStartFocusSession: vi.fn(),
  onSetMainFocus: vi.fn(),
  onToggleSupportTask: vi.fn(),
  onClearDailyPlan: vi.fn(),
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

  it("starts a focus session for already in-progress cards", async () => {
    const user = userEvent.setup();
    const onOpenCard = vi.fn();
    const onStartFocusSession = vi.fn();
    const doingCard = card({ id: "doing", title: "Current task", column: "doing" });

    render(
      <TodayView
        {...defaultProps}
        cards={[doingCard]}
        onOpenCard={onOpenCard}
        onStartFocusSession={onStartFocusSession}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Focus/i }));

    expect(onStartFocusSession).toHaveBeenCalledWith(expect.objectContaining({ id: "doing" }));
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it("lets users choose a main focus and support task from recommendations", async () => {
    const user = userEvent.setup();
    const onSetMainFocus = vi.fn();
    const onToggleSupportTask = vi.fn();
    const dueCard = card({ id: "due", title: "Due task", dueDate: "2026-06-08" });

    render(
      <TodayView
        {...defaultProps}
        cards={[dueCard]}
        onSetMainFocus={onSetMainFocus}
        onToggleSupportTask={onToggleSupportTask}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Main" }));
    await user.click(screen.getByRole("button", { name: "Support" }));

    expect(onSetMainFocus).toHaveBeenCalledWith(expect.objectContaining({ id: "due" }));
    expect(onToggleSupportTask).toHaveBeenCalledWith(expect.objectContaining({ id: "due" }));
  });

  it("shows saved daily plan progress and clears it", async () => {
    const user = userEvent.setup();
    const onClearDailyPlan = vi.fn();
    const main = card({ id: "main", title: "Main task", column: "doing" });
    const support = card({ id: "support", title: "Support task", column: "done" });

    render(
      <TodayView
        {...defaultProps}
        cards={[main, support]}
        dailyPlan={{
          date: new Date().toLocaleDateString("en-CA"),
          mainCardId: "main",
          supportCardIds: ["support"],
          createdAt: "2026-06-08T08:00:00.000Z",
          updatedAt: "2026-06-08T09:00:00.000Z",
        }}
        onClearDailyPlan={onClearDailyPlan}
      />,
    );

    expect(screen.getByText("1/2 planned tasks complete")).toBeInTheDocument();
    expect(screen.getAllByText("Main task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Support task").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClearDailyPlan).toHaveBeenCalledTimes(1);
  });
});
