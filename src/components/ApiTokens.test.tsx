/**
 * Tests for the API Tokens section added to SettingsPanel.
 * Covers: list renders, create shows one-time token, revoke calls the endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "../app/constants";
import type { AppState } from "../app/types";

// ---------- module mocks ----------

// Mock isSupabaseConfigured so the tokens section always renders
vi.mock("../app/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-session-token" } },
      }),
    },
  },
  isSupabaseConfigured: () => true,
}));

// ---------- helpers ----------

const defaultState: AppState = {
  cards: [],
  columns: DEFAULT_COLUMNS,
  templates: [],
  settings: DEFAULT_SETTINGS,
  tagCategories: DEFAULT_TAG_CATEGORIES,
  tags: DEFAULT_TAGS,
};

const defaultProps = {
  open: true,
  settings: DEFAULT_SETTINGS,
  columns: DEFAULT_COLUMNS,
  state: defaultState,
  onClose: vi.fn(),
  onChange: vi.fn(),
  onUpdateColumn: vi.fn(),
  onAddColumn: vi.fn(),
  onDeleteColumn: vi.fn(),
  onReorderColumns: vi.fn(),
  onImport: vi.fn(),
};

function mockFetch(responses: { ok: boolean; body: unknown }[]) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    return Promise.resolve({
      ok: r.ok,
      json: () => Promise.resolve(r.body),
    });
  });
}

// ---------- tests ----------

describe("SettingsPanel — API Tokens section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("token list", () => {
    it("renders the section heading", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([{ ok: true, body: { tokens: [] } }])
      );

      render(<SettingsPanel {...defaultProps} />);

      expect(screen.getByText("API Tokens (CLI & MCP)")).toBeInTheDocument();
    });

    it("shows 'No tokens yet' when list is empty", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([{ ok: true, body: { tokens: [] } }])
      );

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/no tokens yet/i)).toBeInTheDocument();
      });
    });

    it("renders a token row when the API returns a token", async () => {
      const token = {
        id: "tok-1",
        name: "My CLI",
        scopes: ["capture:read", "capture:write"],
        last_used_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        revoked_at: null,
      };
      vi.stubGlobal(
        "fetch",
        mockFetch([{ ok: true, body: { tokens: [token] } }])
      );

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("My CLI")).toBeInTheDocument();
      });
      expect(screen.getByText("capture:read, capture:write")).toBeInTheDocument();
    });

    it("shows 'revoked' badge on a revoked token", async () => {
      const token = {
        id: "tok-2",
        name: "Old token",
        scopes: ["capture:read"],
        last_used_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        revoked_at: "2026-02-01T00:00:00.000Z",
      };
      vi.stubGlobal(
        "fetch",
        mockFetch([{ ok: true, body: { tokens: [token] } }])
      );

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("revoked")).toBeInTheDocument();
      });
    });

    it("shows an error message when the list fetch fails", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([{ ok: false, body: { error: "Unauthorized" } }])
      );

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("Unauthorized")).toBeInTheDocument();
      });
    });
  });

  describe("create token", () => {
    it("shows the plaintext token in a revealed box after creation", async () => {
      const user = userEvent.setup();
      // First call: GET list, second call: POST create
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, body: { tokens: [] } },
          {
            ok: true,
            body: { token: "fb_pat_supersecret", id: "tok-new", name: "Test token" },
          },
        ])
      );

      render(<SettingsPanel {...defaultProps} />);

      // Wait for list to load
      await waitFor(() => screen.getByText(/no tokens yet/i));

      const nameInput = screen.getByPlaceholderText(/token name/i);
      await user.type(nameInput, "Test token");
      await user.click(screen.getByRole("button", { name: /create token/i }));

      await waitFor(() => {
        expect(screen.getByLabelText("New API token value")).toHaveTextContent("fb_pat_supersecret");
      });

      // Warning copy message visible
      expect(screen.getByText(/you won't see it again/i)).toBeInTheDocument();
    });

    it("shows a copy button for the revealed token", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, body: { tokens: [] } },
          { ok: true, body: { token: "fb_pat_abc", id: "tok-3", name: "CLI" } },
        ])
      );

      render(<SettingsPanel {...defaultProps} />);
      await waitFor(() => screen.getByText(/no tokens yet/i));

      await user.type(screen.getByPlaceholderText(/token name/i), "CLI");
      await user.click(screen.getByRole("button", { name: /create token/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /copy token/i })).toBeInTheDocument();
      });
    });

    it("dismisses the revealed box when the user clicks dismiss", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, body: { tokens: [] } },
          { ok: true, body: { token: "fb_pat_abc", id: "tok-3", name: "CLI" } },
        ])
      );

      render(<SettingsPanel {...defaultProps} />);
      await waitFor(() => screen.getByText(/no tokens yet/i));

      await user.type(screen.getByPlaceholderText(/token name/i), "CLI");
      await user.click(screen.getByRole("button", { name: /create token/i }));

      await waitFor(() => screen.getByText(/I've copied it/i));
      await user.click(screen.getByText(/I've copied it/i));

      expect(screen.queryByLabelText("New API token value")).not.toBeInTheDocument();
    });

    it("shows an error when creation fails", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, body: { tokens: [] } },
          { ok: false, body: { error: "name is required" } },
        ])
      );

      render(<SettingsPanel {...defaultProps} />);
      await waitFor(() => screen.getByText(/no tokens yet/i));

      await user.type(screen.getByPlaceholderText(/token name/i), "Bad");
      await user.click(screen.getByRole("button", { name: /create token/i }));

      await waitFor(() => {
        expect(screen.getByText("name is required")).toBeInTheDocument();
      });
    });
  });

  describe("revoke token", () => {
    it("calls DELETE /api/tokens and marks token as revoked", async () => {
      const user = userEvent.setup();
      const token = {
        id: "tok-rev",
        name: "Revoke me",
        scopes: ["capture:read"],
        last_used_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        revoked_at: null,
      };
      const fetchMock = mockFetch([
        { ok: true, body: { tokens: [token] } },
        { ok: true, body: { ok: true } },
      ]);
      vi.stubGlobal("fetch", fetchMock);

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => screen.getByText("Revoke me"));

      const revokeBtn = screen.getByRole("button", { name: /revoke token revoke me/i });
      await user.click(revokeBtn);

      await waitFor(() => {
        expect(screen.getByText("revoked")).toBeInTheDocument();
      });

      // Verify DELETE /api/tokens was called with correct id
      const calls = fetchMock.mock.calls as [string, RequestInit][];
      const revokeCall = calls.find(([url, opts]) => url === "/api/tokens" && opts?.method === "DELETE");
      expect(revokeCall).toBeDefined();
      expect(JSON.parse(revokeCall![1].body as string)).toEqual({ id: "tok-rev" });
    });

    it("does not show Revoke button for already-revoked tokens", async () => {
      const token = {
        id: "tok-already",
        name: "Already gone",
        scopes: ["capture:read"],
        last_used_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        revoked_at: "2026-02-01T00:00:00.000Z",
      };
      vi.stubGlobal(
        "fetch",
        mockFetch([{ ok: true, body: { tokens: [token] } }])
      );

      render(<SettingsPanel {...defaultProps} />);

      await waitFor(() => screen.getByText("Already gone"));
      expect(screen.queryByRole("button", { name: /revoke token already gone/i })).not.toBeInTheDocument();
    });
  });
});
