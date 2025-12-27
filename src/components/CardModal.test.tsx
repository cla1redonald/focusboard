import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardModal } from "./CardModal";
import type { Card } from "../app/types";

describe("CardModal", () => {
  const createCard = (overrides: Partial<Card> = {}): Card => ({
    id: "test-card-1",
    column: "todo",
    title: "Test Card Title",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tags: [],
    checklist: [],
    ...overrides,
  });

  const defaultProps = {
    open: true,
    card: createCard(),
    onClose: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("does not render when open is false", () => {
      render(<CardModal {...defaultProps} open={false} />);

      expect(screen.queryByText("Edit card")).not.toBeInTheDocument();
    });

    it("does not render when card is null", () => {
      render(<CardModal {...defaultProps} card={null} />);

      expect(screen.queryByText("Edit card")).not.toBeInTheDocument();
    });

    it("renders modal with card data when open", () => {
      render(<CardModal {...defaultProps} />);

      expect(screen.getByText("Edit card")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Test Card Title")).toBeInTheDocument();
    });

    it("renders all form fields", () => {
      render(<CardModal {...defaultProps} />);

      expect(screen.getByText(/title/i)).toBeInTheDocument();
      expect(screen.getByText(/icon/i)).toBeInTheDocument();
      expect(screen.getByText(/notes/i)).toBeInTheDocument();
      expect(screen.getByText(/link/i)).toBeInTheDocument();
      expect(screen.getByText(/due date/i)).toBeInTheDocument();
      expect(screen.getByText(/tags/i)).toBeInTheDocument();
    });

    it("renders emoji picker buttons", () => {
      render(<CardModal {...defaultProps} />);

      expect(screen.getByRole("button", { name: "✨" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "✅" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "🧠" })).toBeInTheDocument();
    });

    it("renders save, cancel, and delete buttons", () => {
      render(<CardModal {...defaultProps} />);

      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    });
  });

  describe("card data display", () => {
    it("displays card icon when present", () => {
      const card = createCard({ icon: "🎯" });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByDisplayValue("🎯")).toBeInTheDocument();
    });

    it("displays card notes when present", () => {
      const card = createCard({ notes: "Some important notes" });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByDisplayValue("Some important notes")).toBeInTheDocument();
    });

    it("displays card link when present", () => {
      const card = createCard({ link: "https://example.com" });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByDisplayValue("https://example.com")).toBeInTheDocument();
    });

    it("displays card tags as comma-separated string", () => {
      const card = createCard({ tags: ["urgent", "feature", "bug"] });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByDisplayValue("urgent, feature, bug")).toBeInTheDocument();
    });

    it("displays blocked reason when present", () => {
      const card = createCard({ blockedReason: "Waiting for API access" });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByText(/blocked: waiting for api access/i)).toBeInTheDocument();
    });

    it("displays override reason when present", () => {
      const card = createCard({ lastOverrideReason: "Emergency deployment" });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByText(/override: emergency deployment/i)).toBeInTheDocument();
    });

    it("displays both blocked and override reasons when both present", () => {
      const card = createCard({
        blockedReason: "API down",
        lastOverrideReason: "Critical fix needed",
      });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByText(/blocked: api down/i)).toBeInTheDocument();
      expect(screen.getByText(/override: critical fix needed/i)).toBeInTheDocument();
    });
  });

  describe("checklist", () => {
    it("renders checklist items", () => {
      const card = createCard({
        checklist: [
          { id: "c1", text: "First item", done: false },
          { id: "c2", text: "Second item", done: true },
        ],
      });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByDisplayValue("First item")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Second item")).toBeInTheDocument();
    });

    it("shows correct checkbox state for checklist items", () => {
      const card = createCard({
        checklist: [
          { id: "c1", text: "Unchecked", done: false },
          { id: "c2", text: "Checked", done: true },
        ],
      });

      render(<CardModal {...defaultProps} card={card} />);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[0]).not.toBeChecked();
      expect(checkboxes[1]).toBeChecked();
    });

    it("renders add item button", () => {
      render(<CardModal {...defaultProps} />);

      expect(screen.getByText(/\+ add item/i)).toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("updates title on input change", async () => {
      const user = userEvent.setup();

      render(<CardModal {...defaultProps} />);

      const titleInput = screen.getByDisplayValue("Test Card Title");
      await user.clear(titleInput);
      await user.type(titleInput, "New Title");

      expect(screen.getByDisplayValue("New Title")).toBeInTheDocument();
    });

    it("updates notes on textarea change", async () => {
      const user = userEvent.setup();

      render(<CardModal {...defaultProps} />);

      // Find the textarea (not an input)
      const notesTextarea = document.querySelector("textarea") as HTMLTextAreaElement;
      await user.type(notesTextarea, "Added notes");

      expect(screen.getByDisplayValue("Added notes")).toBeInTheDocument();
    });

    it("sets icon when emoji button is clicked", async () => {
      const user = userEvent.setup();

      render(<CardModal {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "🎯" }));

      expect(screen.getByDisplayValue("🎯")).toBeInTheDocument();
    });

    it("clears icon when clear button is clicked", async () => {
      const user = userEvent.setup();
      const card = createCard({ icon: "🎯" });

      render(<CardModal {...defaultProps} card={card} />);

      await user.click(screen.getByRole("button", { name: /clear/i }));

      expect(screen.queryByDisplayValue("🎯")).not.toBeInTheDocument();
    });

    it("adds new checklist item when add button is clicked", async () => {
      const user = userEvent.setup();

      render(<CardModal {...defaultProps} />);

      await user.click(screen.getByText(/\+ add item/i));

      expect(screen.getByDisplayValue("New item")).toBeInTheDocument();
    });

    it("toggles checklist item done state", async () => {
      const user = userEvent.setup();
      const card = createCard({
        checklist: [{ id: "c1", text: "Task", done: false }],
      });

      render(<CardModal {...defaultProps} card={card} />);

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeChecked();

      await user.click(checkbox);

      expect(checkbox).toBeChecked();
    });

    it("removes checklist item when delete button is clicked", async () => {
      const user = userEvent.setup();
      const card = createCard({
        checklist: [{ id: "c1", text: "Task to delete", done: false }],
      });

      render(<CardModal {...defaultProps} card={card} />);

      expect(screen.getByDisplayValue("Task to delete")).toBeInTheDocument();

      // Find the remove button (✕) for the checklist item
      const removeButtons = screen.getAllByRole("button", { name: "✕" });
      // The last ✕ is for the checklist item (first is modal close)
      await user.click(removeButtons[removeButtons.length - 1]);

      expect(screen.queryByDisplayValue("Task to delete")).not.toBeInTheDocument();
    });

    it("parses tags from comma-separated input", async () => {
      const onSave = vi.fn();
      const card = createCard({ tags: [] });

      render(<CardModal {...defaultProps} card={card} onSave={onSave} />);

      // Find the tags input - it's the text input for comma-separated values
      // Use a more specific approach - find by the label text nearby
      const tagLabel = screen.getByText(/tags/i);
      const tagSection = tagLabel.closest("div");
      const tagsInput = tagSection?.querySelector("input") as HTMLInputElement;

      if (tagsInput) {
        fireEvent.change(tagsInput, { target: { value: "tag1, tag2, tag3" } });
      }

      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["tag1", "tag2", "tag3"],
        })
      );
    });
  });

  describe("actions", () => {
    it("calls onClose when close button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<CardModal {...defaultProps} onClose={onClose} />);

      // Find the ✕ close button in header
      await user.click(screen.getAllByRole("button", { name: "✕" })[0]);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when cancel button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<CardModal {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when backdrop is clicked", () => {
      const onClose = vi.fn();

      render(<CardModal {...defaultProps} onClose={onClose} />);

      // Click the backdrop (first element with backdrop-blur class)
      const backdrop = document.querySelector(".backdrop-blur-sm");
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onSave with updated card data when save is clicked", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();

      render(<CardModal {...defaultProps} onSave={onSave} />);

      const titleInput = screen.getByDisplayValue("Test Card Title");
      await user.clear(titleInput);
      await user.type(titleInput, "Updated Title");

      await user.click(screen.getByRole("button", { name: /save/i }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-card-1",
          title: "Updated Title",
        })
      );
    });

    it("calls onDelete with card id when delete is clicked", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();

      render(<CardModal {...defaultProps} onDelete={onDelete} />);

      await user.click(screen.getByRole("button", { name: /delete/i }));

      expect(onDelete).toHaveBeenCalledWith("test-card-1");
    });
  });

  describe("due date handling", () => {
    it("displays due date in correct format", () => {
      const card = createCard({ dueDate: "2024-12-31T00:00:00.000Z" });

      render(<CardModal {...defaultProps} card={card} />);

      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput.value).toBe("2024-12-31");
    });

    it("updates due date when changed", async () => {
      const onSave = vi.fn();

      render(<CardModal {...defaultProps} onSave={onSave} />);

      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: "2025-01-15" } });

      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDate: expect.stringContaining("2025-01-15"),
        })
      );
    });
  });

  describe("state synchronization", () => {
    it("updates draft when card prop changes", () => {
      const { rerender } = render(<CardModal {...defaultProps} />);

      expect(screen.getByDisplayValue("Test Card Title")).toBeInTheDocument();

      const newCard = createCard({ title: "Different Title" });
      rerender(<CardModal {...defaultProps} card={newCard} />);

      expect(screen.getByDisplayValue("Different Title")).toBeInTheDocument();
    });
  });
});
