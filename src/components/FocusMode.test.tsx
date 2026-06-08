import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "../app/types";
import { FocusMode } from "./FocusMode";

const card: Card = {
  id: "card-1",
  column: "doing",
  title: "Draft launch plan",
  order: 0,
  createdAt: "2026-06-08T09:00:00.000Z",
  updatedAt: "2026-06-08T09:00:00.000Z",
  tags: [],
  checklist: [],
};

describe("FocusMode", () => {
  it("records selected length, note, and completion outcome", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(
      <FocusMode
        open
        card={card}
        onClose={vi.fn()}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Focus session" })).toBeInTheDocument();
    expect(screen.getByText("Draft launch plan")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "50m" }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.type(screen.getByLabelText("Session note"), "Finished the outline");
    await user.click(screen.getByRole("button", { name: /Completed card/i }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        card,
        outcome: "completed",
        note: "Finished the outline",
        plannedMinutes: 50,
      }),
    );
  });

  it("pauses and resumes an active session", async () => {
    const user = userEvent.setup();

    render(
      <FocusMode
        open
        card={card}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});
