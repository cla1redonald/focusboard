import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "../app/constants";
import type { Settings } from "../app/types";

describe("SettingsPanel", () => {
  const defaultProps = {
    open: true,
    settings: DEFAULT_SETTINGS,
    columns: DEFAULT_COLUMNS,
    onClose: vi.fn(),
    onChange: vi.fn(),
    onUpdateColumn: vi.fn(),
    onAddColumn: vi.fn(),
    onDeleteColumn: vi.fn(),
    onReorderColumns: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("does not render when open is false", () => {
      render(<SettingsPanel {...defaultProps} open={false} />);

      expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    });

    it("renders modal when open is true", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("renders background upload section", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Background")).toBeInTheDocument();
      expect(screen.getByText("Upload image")).toBeInTheDocument();
    });

    it("renders columns section", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Columns")).toBeInTheDocument();
    });

    it("renders celebrations toggle", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Celebrations")).toBeInTheDocument();
    });

    it("renders reduced motion override toggle", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Reduced motion override")).toBeInTheDocument();
    });

    it("renders close button", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    });

    it("renders all default columns", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Backlog")).toBeInTheDocument();
      expect(screen.getByText("Design & Planning")).toBeInTheDocument();
      expect(screen.getByText("To Do")).toBeInTheDocument();
      expect(screen.getByText("Doing")).toBeInTheDocument();
      expect(screen.getByText("Blocked")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
    });
  });

  describe("close actions", () => {
    it("calls onClose when close button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<SettingsPanel {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByRole("button", { name: /close/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when header X button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<SettingsPanel {...defaultProps} onClose={onClose} />);

      await user.click(screen.getByRole("button", { name: "✕" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when backdrop is clicked", () => {
      const onClose = vi.fn();

      render(<SettingsPanel {...defaultProps} onClose={onClose} />);

      const backdrop = document.querySelector(".backdrop-blur-sm");
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("celebrations toggle", () => {
    it("shows celebrations enabled when true", () => {
      const settings: Settings = { ...DEFAULT_SETTINGS, celebrations: true };

      render(<SettingsPanel {...defaultProps} settings={settings} />);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[0]).toBeChecked();
    });

    it("shows celebrations disabled when false", () => {
      const settings: Settings = { ...DEFAULT_SETTINGS, celebrations: false };

      render(<SettingsPanel {...defaultProps} settings={settings} />);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[0]).not.toBeChecked();
    });

    it("calls onChange with updated celebrations setting", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<SettingsPanel {...defaultProps} onChange={onChange} />);

      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[0]);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          celebrations: false,
        })
      );
    });
  });

  describe("reduced motion override", () => {
    it("shows reduced motion enabled when true", () => {
      const settings: Settings = { ...DEFAULT_SETTINGS, reducedMotionOverride: true };

      render(<SettingsPanel {...defaultProps} settings={settings} />);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[1]).toBeChecked();
    });

    it("calls onChange with updated reducedMotionOverride", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<SettingsPanel {...defaultProps} onChange={onChange} />);

      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[1]);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          reducedMotionOverride: true,
        })
      );
    });
  });

  describe("columns management", () => {
    it("renders Use Moo palette button", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByRole("button", { name: /use moo palette/i })).toBeInTheDocument();
    });

    it("renders Add column button", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByRole("button", { name: /add column/i })).toBeInTheDocument();
    });

    it("renders edit buttons for each column", () => {
      render(<SettingsPanel {...defaultProps} />);

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      expect(editButtons.length).toBe(DEFAULT_COLUMNS.length);
    });

    it("opens column edit modal when edit is clicked", async () => {
      const user = userEvent.setup();

      render(<SettingsPanel {...defaultProps} />);

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);

      expect(screen.getByText("Edit Column")).toBeInTheDocument();
    });

    it("opens add column modal when add is clicked", async () => {
      const user = userEvent.setup();

      render(<SettingsPanel {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: /add column/i }));

      expect(screen.getByText("Add Column")).toBeInTheDocument();
    });
  });

  describe("background image", () => {
    it("shows upload button when no background is set", () => {
      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("Upload image")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    });

    it("shows remove button when background is set", () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        backgroundImage: "data:image/png;base64,test",
      };

      render(<SettingsPanel {...defaultProps} settings={settings} />);

      expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
    });

    it("removes background when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        backgroundImage: "data:image/png;base64,test",
      };

      render(<SettingsPanel {...defaultProps} settings={settings} onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: /remove/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundImage: null,
        })
      );
    });
  });

  describe("file upload", () => {
    it("has file input with correct accept attribute", () => {
      render(<SettingsPanel {...defaultProps} />);

      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toHaveAttribute("accept", "image/*");
    });

    it("file input is hidden", () => {
      render(<SettingsPanel {...defaultProps} />);

      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toHaveClass("hidden");
    });
  });
});
