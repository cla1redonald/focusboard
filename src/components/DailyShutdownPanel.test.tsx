import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COLUMNS } from "../app/constants";
import type { Card, MetricsState } from "../app/types";
import { DailyShutdownPanel } from "./DailyShutdownPanel";

const card: Card = {
  id: "card-1",
  column: "doing",
  title: "Active task",
  order: 0,
  createdAt: "2026-06-08T09:00:00.000Z",
  updatedAt: "2026-06-08T09:00:00.000Z",
  tags: [],
  checklist: [],
};

const metrics: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  focusSessions: [],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
};

describe("DailyShutdownPanel", () => {
  it("renders candidates and marks completion", async () => {
    const user = userEvent.setup();
    const onOpenCard = vi.fn();
    const onComplete = vi.fn();

    render(
      <DailyShutdownPanel
        open
        cards={[card]}
        columns={DEFAULT_COLUMNS}
        metrics={metrics}
        onClose={vi.fn()}
        onOpenCard={onOpenCard}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Daily shutdown" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Active task/i }));
    await user.click(screen.getByRole("button", { name: "Mark complete" }));

    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1" }));
    expect(onComplete).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });
});
