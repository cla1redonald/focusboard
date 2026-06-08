import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Card, Column } from "../app/types";
import { WipModal } from "./WipModal";

const pressureColumn: Column = {
  id: "doing",
  title: "Doing",
  icon: "zap",
  color: "#c4956a",
  wipLimit: 1,
  isTerminal: false,
  order: 0,
};

const pressureCard: Card = {
  id: "card-1",
  column: "doing",
  title: "Current task",
  order: 0,
  createdAt: "2026-06-08T09:00:00.000Z",
  updatedAt: "2026-06-08T09:00:00.000Z",
  tags: [],
  checklist: [],
};

describe("WipModal", () => {
  it("shows pressure cards with action choices", async () => {
    const user = userEvent.setup();
    const onOpenCard = vi.fn();
    const onMoveCardBack = vi.fn();
    const onArchiveCard = vi.fn();

    render(
      <WipModal
        open
        title="WIP limit reached"
        message="Move something out first, or override."
        pressureColumn={pressureColumn}
        pressureCards={[pressureCard]}
        fallbackColumnId="todo"
        askReason
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onOpenCard={onOpenCard}
        onMoveCardBack={onMoveCardBack}
        onArchiveCard={onArchiveCard}
        confirmText="Override"
      />,
    );

    expect(screen.getByText("Doing is full")).toBeInTheDocument();
    expect(screen.getByText("Current task")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Move back" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1" }));
    expect(onMoveCardBack).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1" }), "todo", undefined);
    expect(onArchiveCard).toHaveBeenCalledWith(expect.objectContaining({ id: "card-1" }));
  });

  it("requires a reason before overriding", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <WipModal
        open
        title="WIP limit reached"
        message="Move something out first, or override."
        askReason
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        confirmText="Override"
      />,
    );

    const override = screen.getByRole("button", { name: "Override" });
    expect(override).toBeDisabled();

    await user.type(screen.getByLabelText("Reason"), "Emergency");
    await user.click(override);

    expect(onConfirm).toHaveBeenCalledWith("Emergency");
  });
});
