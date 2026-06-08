import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COLUMNS } from "../app/constants";
import type { Card, MetricsState } from "../app/types";
import { WeeklyReviewPanel } from "./WeeklyReviewPanel";

const card: Card = {
  id: "card-1",
  column: "todo",
  title: "Next commitment",
  order: 0,
  createdAt: "2026-06-08T09:00:00.000Z",
  updatedAt: "2026-06-08T09:00:00.000Z",
  tags: [],
  checklist: [],
};

const metrics: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  focusSessions: [
    {
      id: "focus-1",
      cardId: "card-1",
      cardTitle: "Next commitment",
      plannedMinutes: 25,
      startedAt: "2026-06-08T09:00:00.000Z",
      endedAt: new Date().toISOString(),
      outcome: "progressed",
    },
  ],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
};

describe("WeeklyReviewPanel", () => {
  it("renders weekly review and marks completion", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(
      <WeeklyReviewPanel
        open
        cards={[card]}
        columns={DEFAULT_COLUMNS}
        metrics={metrics}
        onClose={vi.fn()}
        onOpenCard={vi.fn()}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Weekly review" })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark complete" }));

    expect(onComplete).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
});
