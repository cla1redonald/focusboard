import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CaptureInbox } from "./CaptureInbox";
import { DEFAULT_COLUMNS } from "../app/constants";
import type { CaptureQueueItem } from "../app/captureTypes";
import type { Tag } from "../app/types";

describe("CaptureInbox", () => {
  const tags: Tag[] = [
    { id: "high", name: "High", color: "#EF4444", categoryId: "priority" },
    { id: "bug", name: "Bug", color: "#F59E0B", categoryId: "type" },
  ];

  const defaultProps = {
    open: true,
    reviewItems: [] as CaptureQueueItem[],
    processingItems: [] as CaptureQueueItem[],
    autoAddedItems: [] as CaptureQueueItem[],
    columns: DEFAULT_COLUMNS,
    tags,
    onClose: vi.fn(),
    onAddCard: vi.fn(),
    onDismiss: vi.fn(),
    onDelete: vi.fn(),
  };

  const makeItem = (overrides: Partial<CaptureQueueItem> = {}): CaptureQueueItem => ({
    id: "cap-1",
    user_id: "user-1",
    status: "ready",
    confidence: 0.85,
    source: "slack",
    raw_content: "Review the Q3 budget spreadsheet by Friday",
    raw_metadata: {},
    parsed_cards: [
      {
        title: "Review Q3 budget spreadsheet",
        notes: "From Slack",
        tags: ["high"],
        swimlane: "work",
        suggestedColumn: "todo",
        confidence: 0.85,
      },
    ],
    created_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CaptureInbox {...defaultProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows empty state when no items", () => {
    render(<CaptureInbox {...defaultProps} />);
    expect(screen.getByText("No captured items yet")).toBeInTheDocument();
  });

  it("renders review items with correct source badges", () => {
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("Review Q3 budget spreadsheet")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(screen.getByText("85% confidence")).toBeInTheDocument();
  });

  it("shows processing items with spinner", () => {
    const item = makeItem({ status: "processing", parsed_cards: null });
    render(<CaptureInbox {...defaultProps} processingItems={[item]} />);

    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText(/Review the Q3 budget/)).toBeInTheDocument();
  });

  it("calls onAddCard when add button is clicked", async () => {
    const user = userEvent.setup();
    const onAddCard = vi.fn();
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} onAddCard={onAddCard} />);

    await user.click(screen.getByRole("button", { name: "Add card" }));

    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Review Q3 budget spreadsheet" }),
      "cap-1"
    );
  });

  it("calls onDismiss when dismiss button is clicked", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledWith("cap-1");
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CaptureInbox {...defaultProps} onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Add all button when multiple review items", () => {
    const items = [
      makeItem({ id: "cap-1" }),
      makeItem({ id: "cap-2" }),
    ];
    render(<CaptureInbox {...defaultProps} reviewItems={items} />);

    expect(screen.getByText("Add all (2)")).toBeInTheDocument();
  });

  it("shows missing field nudge for items without due date", () => {
    const item = makeItem();
    // parsed_cards already has no dueDate
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText(/No due date/)).toBeInTheDocument();
  });

  it("shows tag chips on review items", () => {
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows item count in header", () => {
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("1 item to review")).toBeInTheDocument();
  });

  it("expands inline editor when edit button is clicked", async () => {
    const user = userEvent.setup();
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    await user.click(screen.getByRole("button", { name: "Edit card" }));

    // Editor should show column selector and Add Card button
    expect(screen.getByText("Add Card")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  // ── Inline editor submit ─────────────────────────────────────────

  it("inline editor submits edited card with onAddCard", async () => {
    const user = userEvent.setup();
    const onAddCard = vi.fn();
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} onAddCard={onAddCard} />);

    // Open editor
    await user.click(screen.getByRole("button", { name: "Edit card" }));

    // Modify the title
    const titleInput = screen.getByDisplayValue("Review Q3 budget spreadsheet");
    await user.clear(titleInput);
    await user.type(titleInput, "Updated title");

    // Click Add Card
    await user.click(screen.getByText("Add Card"));

    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Updated title", confidence: 1 }),
      "cap-1"
    );
  });

  it("inline editor cancel closes the editor without calling onAddCard", async () => {
    const user = userEvent.setup();
    const onAddCard = vi.fn();
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} onAddCard={onAddCard} />);

    // Open editor
    await user.click(screen.getByRole("button", { name: "Edit card" }));
    expect(screen.getByText("Cancel")).toBeInTheDocument();

    // Cancel
    await user.click(screen.getByText("Cancel"));

    // Should be back to normal card view
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
    expect(screen.getByText("Review Q3 budget spreadsheet")).toBeInTheDocument();
    expect(onAddCard).not.toHaveBeenCalled();
  });

  // ── Add all batch button ──────────────────────────────────────────

  it("Add all button calls onAddCard for each review item", async () => {
    const user = userEvent.setup();
    const onAddCard = vi.fn();
    const items = [
      makeItem({ id: "cap-1" }),
      makeItem({
        id: "cap-2",
        parsed_cards: [
          {
            title: "Second task",
            tags: [],
            swimlane: "work",
            suggestedColumn: "backlog",
            confidence: 0.9,
          },
        ],
      }),
    ];
    render(<CaptureInbox {...defaultProps} reviewItems={items} onAddCard={onAddCard} />);

    await user.click(screen.getByText("Add all (2)"));

    expect(onAddCard).toHaveBeenCalledTimes(2);
    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Review Q3 budget spreadsheet" }),
      "cap-1"
    );
    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Second task" }),
      "cap-2"
    );
  });

  it("does not show Add all button for a single review item", () => {
    const item = makeItem();
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.queryByText(/Add all/)).not.toBeInTheDocument();
  });

  // ── Auto-added section toggle ─────────────────────────────────────

  it("auto-added section is collapsed by default", () => {
    const item = makeItem({
      id: "auto-1",
      status: "auto_added",
    });
    render(<CaptureInbox {...defaultProps} autoAddedItems={[item]} />);

    // Section header is visible
    expect(screen.getByText(/Recently Auto-Added/)).toBeInTheDocument();

    // But the card title should not be visible (collapsed)
    // The card content is inside the collapsed section — check that the
    // title from parsed_cards is NOT rendered inline
    const autoTitle = item.parsed_cards![0].title;
    // When collapsed, auto-added items are not rendered in the DOM
    expect(screen.queryByText(autoTitle)).not.toBeInTheDocument();
  });

  it("expands auto-added section when clicked", async () => {
    const user = userEvent.setup();
    const item = makeItem({
      id: "auto-1",
      status: "auto_added",
    });
    render(<CaptureInbox {...defaultProps} autoAddedItems={[item]} />);

    // Expand
    await user.click(screen.getByText(/Recently Auto-Added/));

    // Now the card title should be visible
    const autoTitle = item.parsed_cards![0].title;
    expect(screen.getByText(autoTitle)).toBeInTheDocument();
  });

  it("collapses auto-added section on second click", async () => {
    const user = userEvent.setup();
    const item = makeItem({
      id: "auto-1",
      status: "auto_added",
    });
    render(<CaptureInbox {...defaultProps} autoAddedItems={[item]} />);

    const toggle = screen.getByText(/Recently Auto-Added/);

    // Expand then collapse
    await user.click(toggle);
    await user.click(toggle);

    const autoTitle = item.parsed_cards![0].title;
    expect(screen.queryByText(autoTitle)).not.toBeInTheDocument();
  });

  it("calls onDelete when remove button is clicked in auto-added section", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const item = makeItem({
      id: "auto-1",
      status: "auto_added",
    });
    render(<CaptureInbox {...defaultProps} autoAddedItems={[item]} onDelete={onDelete} />);

    // Expand the section first
    await user.click(screen.getByText(/Recently Auto-Added/));

    // Click the Remove button
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(onDelete).toHaveBeenCalledWith("auto-1");
  });

  // ── Source badge rendering for all sources ────────────────────────

  it.each([
    ["email", "Email"],
    ["slack", "Slack"],
    ["browser", "Browser"],
    ["shortcut", "Shortcut"],
    ["whatsapp", "WhatsApp"],
    ["in_app", "In-App"],
  ] as const)("renders correct source badge for %s source", (source, expectedLabel) => {
    const item = makeItem({ source });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  // ── Duplicate warning ─────────────────────────────────────────────

  it("shows duplicate warning when card has duplicateOf", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Review Q3 budget spreadsheet",
          confidence: 0.85,
          duplicateOf: "Existing budget review task",
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText(/Possible duplicate/)).toBeInTheDocument();
  });

  it("does not show duplicate warning when card has no duplicateOf", () => {
    const item = makeItem(); // default has no duplicateOf
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.queryByText(/Possible duplicate/)).not.toBeInTheDocument();
  });

  // ── Confidence indicator colors ───────────────────────────────────

  it("shows green confidence dot for high confidence (>= 0.8)", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "High confidence task",
          confidence: 0.92,
        },
      ],
    });
    const { container } = render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("92% confidence")).toBeInTheDocument();
    const dot = container.querySelector(".bg-emerald-500");
    expect(dot).not.toBeNull();
  });

  it("shows amber confidence dot for medium confidence (0.5-0.79)", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Medium confidence task",
          confidence: 0.65,
        },
      ],
    });
    const { container } = render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("65% confidence")).toBeInTheDocument();
    const dot = container.querySelector(".bg-amber-500");
    expect(dot).not.toBeNull();
  });

  it("shows red confidence dot for low confidence (< 0.5)", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Low confidence task",
          confidence: 0.3,
        },
      ],
    });
    const { container } = render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("30% confidence")).toBeInTheDocument();
    const dot = container.querySelector(".bg-red-400");
    expect(dot).not.toBeNull();
  });

  // ── Notes preview ─────────────────────────────────────────────────

  it("renders notes preview when card has notes", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Task with notes",
          notes: "Important context from the email thread",
          confidence: 0.85,
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("Important context from the email thread")).toBeInTheDocument();
  });

  it("does not render notes section when card has no notes", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Task without notes",
          confidence: 0.85,
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("Task without notes")).toBeInTheDocument();
    // No notes paragraph should appear
    expect(screen.queryByText("From Slack")).not.toBeInTheDocument();
  });

  // ── Column suggestion display ─────────────────────────────────────

  it("shows suggested column label on review card", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Task for doing column",
          suggestedColumn: "doing",
          confidence: 0.8,
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("Doing")).toBeInTheDocument();
  });

  // ── Personal swimlane badge ───────────────────────────────────────

  it("shows Personal badge when swimlane is personal", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Personal task",
          swimlane: "personal",
          confidence: 0.85,
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("does not show Personal badge when swimlane is work", () => {
    const item = makeItem(); // default swimlane is work
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    // The text "Personal" should not be present (only appears for non-work swimlanes)
    expect(screen.queryByText("Personal")).not.toBeInTheDocument();
  });

  // ── Header counts ─────────────────────────────────────────────────

  it("shows plural item count for multiple items", () => {
    const items = [
      makeItem({ id: "cap-1" }),
      makeItem({ id: "cap-2" }),
    ];
    render(<CaptureInbox {...defaultProps} reviewItems={items} />);

    expect(screen.getByText("2 items to review")).toBeInTheDocument();
  });

  it("includes processing items in the total count", () => {
    const reviewItem = makeItem({ id: "cap-1" });
    const processingItem = makeItem({ id: "cap-2", status: "processing", parsed_cards: null });
    render(
      <CaptureInbox
        {...defaultProps}
        reviewItems={[reviewItem]}
        processingItems={[processingItem]}
      />
    );

    expect(screen.getByText("2 items to review")).toBeInTheDocument();
  });

  it("shows 'No items to review' when count is zero", () => {
    render(<CaptureInbox {...defaultProps} />);

    expect(screen.getByText("No items to review")).toBeInTheDocument();
  });

  // ── Due date nudge suppressed when present ────────────────────────

  it("does not show due date nudge when card has a dueDate", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Task with due date",
          dueDate: "2026-03-01",
          confidence: 0.85,
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.queryByText(/No due date/)).not.toBeInTheDocument();
  });

  // ── Close button in footer ────────────────────────────────────────

  it("calls onClose when footer Close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CaptureInbox {...defaultProps} onClose={onClose} />);

    // There are two close mechanisms: the X button and the footer Close button.
    // Click the footer one (role button with name "Close" is the X; the footer uses text "Close")
    const closeButtons = screen.getAllByText("Close");
    // The footer close button is the text button, not the X aria-label
    await user.click(closeButtons[0]);

    expect(onClose).toHaveBeenCalled();
  });

  // ── Multiple tags rendering ───────────────────────────────────────

  it("renders multiple tag chips on a review card", () => {
    const item = makeItem({
      parsed_cards: [
        {
          title: "Multi-tag task",
          tags: ["high", "bug"],
          confidence: 0.85,
        },
      ],
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  // ── Items with no parsed_cards (fallback rendering) ───────────────

  it("renders raw content fallback for ready item with null parsed_cards", () => {
    const item = makeItem({
      id: "cap-no-parse",
      parsed_cards: null,
      raw_content: "Unparsed content from a weird email format that AI could not handle",
    });
    render(<CaptureInbox {...defaultProps} reviewItems={[item]} />);

    expect(screen.getByText(/Unparsed content from a weird email/)).toBeInTheDocument();
  });

  // ── Auto-added count in header ────────────────────────────────────

  it("shows count in auto-added section header", () => {
    const items = [
      makeItem({ id: "auto-1", status: "auto_added" }),
      makeItem({ id: "auto-2", status: "auto_added" }),
    ];
    render(<CaptureInbox {...defaultProps} autoAddedItems={items} />);

    expect(screen.getByText(/Recently Auto-Added \(2\)/)).toBeInTheDocument();
  });
});
