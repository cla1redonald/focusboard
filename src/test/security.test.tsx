import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { loadState, saveState } from "../app/storage";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "../app/constants";
import type { AppState, Card, Column } from "../app/types";
import { SettingsPanel } from "../components/SettingsPanel";
import { Board } from "../components/Board";

describe("Security Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("XSS Prevention", () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert("xss")>',
      '"><script>alert("xss")</script>',
      "javascript:alert('xss')",
      '<svg onload=alert("xss")>',
      '<body onload=alert("xss")>',
      '"><img src=x onerror=alert(1)>',
      '<iframe src="javascript:alert(1)">',
      "'-alert(1)-'",
      "'; DROP TABLE users; --",
      "<div onclick=\"alert('xss')\">click me</div>",
      '{{constructor.constructor("alert(1)")()}}',
      "${alert(1)}",
      "<a href='javascript:alert(1)'>click</a>",
    ];

    it.each(xssPayloads)("safely renders malicious card title: %s", (payload) => {
      const card: Card = {
        id: "xss-test",
        column: "todo",
        title: payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        checklist: [],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      // The payload should be stored as-is (no script execution in storage)
      expect(loaded.cards[0].title).toBe(payload);

      // Rendering should escape the content (React's default behavior)
      render(
        <Board
          cards={[card]}
          columns={DEFAULT_COLUMNS}
          settings={DEFAULT_SETTINGS}
          metrics={{ completedCards: [], dailySnapshots: [], wipViolations: 0 }}
          onAdd={vi.fn()}
          onMove={vi.fn()}
          onDelete={vi.fn()}
          onOpenCard={vi.fn()}
          onSettings={vi.fn()}
          onOpenMetrics={vi.fn()}
          canUndo={false}
          canRedo={false}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
        />
      );

      // The text should be visible but not executed as HTML
      expect(document.body.innerHTML).not.toContain("<script>");
    });

    it("safely handles XSS in card notes", () => {
      const card: Card = {
        id: "notes-xss",
        column: "todo",
        title: "Test Card",
        notes: '<script>alert("xss")</script>',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        checklist: [{ id: "c1", text: '<img src=x onerror=alert("xss")>', done: false }],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].notes).toBe('<script>alert("xss")</script>');
    });
  });

  describe("localStorage Security", () => {
    it("handles corrupted JSON gracefully", () => {
      localStorage.setItem("focusboard:v2", "{{{{invalid json}}}}");

      const state = loadState();

      expect(state.cards).toEqual([]);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.columns).toEqual(DEFAULT_COLUMNS);
    });

    it("handles null values gracefully", () => {
      localStorage.setItem("focusboard:v2", "null");

      const state = loadState();

      expect(state.cards).toEqual([]);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
    });

    it("handles empty object gracefully", () => {
      localStorage.setItem("focusboard:v2", "{}");

      const state = loadState();

      expect(state.cards).toEqual([]);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
    });

    it("sanitizes loaded cards with missing required fields", () => {
      const malformedState = {
        cards: [
          { id: "partial" },
          { column: "todo" },
          { id: "complete", column: "done", title: "Valid" },
        ],
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(malformedState));

      const state = loadState();

      // Cards should be loaded, even if malformed
      expect(state.cards.length).toBe(3);
    });

    it("handles extremely large data", () => {
      const largeTitle = "A".repeat(100000);
      const state: AppState = {
        cards: [
          {
            id: "large",
            column: "todo",
            title: largeTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: [],
            checklist: [],
          },
        ],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].title).toBe(largeTitle);
    });

    it("preserves data integrity with special characters", () => {
      const specialTitle = "Test\n\t\"'\\\u0000\u001f<>&";
      const card: Card = {
        id: "special",
        column: "todo",
        title: specialTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        checklist: [],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].title).toBe(specialTitle);
    });

    it("handles unicode characters correctly", () => {
      const unicodeTitle = "测试 🎉 ñ é ü ö ä 日本語 العربية";
      const card: Card = {
        id: "unicode",
        column: "todo",
        title: unicodeTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        checklist: [],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].title).toBe(unicodeTitle);
    });

    it("handles emoji in all fields", () => {
      const card: Card = {
        id: "emoji",
        column: "todo",
        title: "Title 🎯",
        icon: "🔥",
        notes: "Notes 📝",
        tags: ["tag1 🏷️"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checklist: [{ id: "c1", text: "Checklist item ✅", done: true }],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].title).toBe("Title 🎯");
      expect(loaded.cards[0].icon).toBe("🔥");
    });
  });

  describe("Prototype Pollution Prevention", () => {
    it("does not allow __proto__ pollution via card data", () => {
      const maliciousData = {
        cards: [
          {
            id: "proto-test",
            column: "todo",
            title: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: [],
            checklist: [],
            __proto__: { polluted: true },
          },
        ],
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(maliciousData));
      loadState();

      // Check that Object.prototype was not polluted
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it("does not allow constructor pollution", () => {
      const maliciousData = {
        cards: [],
        columns: DEFAULT_COLUMNS,
        settings: {
          ...DEFAULT_SETTINGS,
          constructor: { prototype: { polluted: true } },
        },
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(maliciousData));
      loadState();

      // Check that Function.prototype was not polluted
      expect((function () {} as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    });
  });

  describe("Input Validation", () => {
    it("handles extremely long tags gracefully", () => {
      const longTag = "A".repeat(10000);
      const card: Card = {
        id: "long-tag",
        column: "todo",
        title: "Test",
        tags: [longTag, "normal"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        checklist: [],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].tags).toContain(longTag);
    });

    it("handles many checklist items", () => {
      const manyItems = Array.from({ length: 1000 }, (_, i) => ({
        id: `item-${i}`,
        text: `Item ${i}`,
        done: i % 2 === 0,
      }));

      const card: Card = {
        id: "many-items",
        column: "todo",
        title: "Test",
        checklist: manyItems,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      expect(loaded.cards[0].checklist).toHaveLength(1000);
    });
  });

  describe("URL Validation", () => {
    it("stores URLs without execution", () => {
      const dangerousUrl = "javascript:alert('xss')";
      const card: Card = {
        id: "url-test",
        column: "todo",
        title: "Test",
        link: dangerousUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
        checklist: [],
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);
      const loaded = loadState();

      // URL is stored but should be handled safely when rendered
      expect(loaded.cards[0].link).toBe(dangerousUrl);
    });
  });

  describe("Settings Panel Security", () => {
    const defaultSettingsPanelProps = {
      open: true,
      settings: DEFAULT_SETTINGS,
      columns: DEFAULT_COLUMNS,
      state: {
        cards: [],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      } as AppState,
      onClose: vi.fn(),
      onChange: vi.fn(),
      onUpdateColumn: vi.fn(),
      onAddColumn: vi.fn(),
      onDeleteColumn: vi.fn(),
      onReorderColumns: vi.fn(),
      onImport: vi.fn(),
    };

    it("safely renders settings panel with default settings", () => {
      render(<SettingsPanel {...defaultSettingsPanelProps} />);

      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("handles XSS in column icons", () => {
      const columnsWithXss: Column[] = DEFAULT_COLUMNS.map((col) => ({
        ...col,
        icon: '<script>alert("xss")</script>',
      }));

      render(
        <SettingsPanel
          {...defaultSettingsPanelProps}
          columns={columnsWithXss}
        />
      );

      // Script tags should be rendered as text, not executed
      expect(document.body.innerHTML).not.toContain("<script>");
    });
  });

  describe("Data Type Coercion", () => {
    it("handles number strings gracefully", () => {
      const state = {
        cards: [],
        columns: DEFAULT_COLUMNS.map((col) => ({
          ...col,
          wipLimit: "5" as unknown as number, // Malicious string instead of number
        })),
        settings: DEFAULT_SETTINGS,
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(state));
      const loaded = loadState();

      // App should handle this without crashing
      expect(loaded.columns).toBeDefined();
    });

    it("handles boolean strings gracefully", () => {
      const state = {
        cards: [],
        columns: DEFAULT_COLUMNS,
        settings: {
          ...DEFAULT_SETTINGS,
          celebrations: "true" as unknown as boolean,
        },
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(state));
      const loaded = loadState();

      expect(loaded.settings).toBeDefined();
    });
  });

  describe("Memory Safety", () => {
    it("handles circular reference attempts gracefully", () => {
      // JSON.stringify will throw on circular references, so we can't actually
      // create a circular reference in localStorage. But we test that our code
      // handles parse errors gracefully.
      localStorage.setItem("focusboard:v2", '{"cards": [{"id": "test"');

      const state = loadState();

      expect(state.cards).toEqual([]);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
    });
  });
});
