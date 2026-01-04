import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth, useRequireAuth } from "./AuthContext";

// Mock the supabase module
vi.mock("./supabase", () => ({
  supabase: null,
  isSupabaseConfigured: vi.fn(() => false),
}));

// Mock the storage module
vi.mock("./storage", () => ({
  setStorageUserId: vi.fn(),
}));

// Import the mocked modules
import { isSupabaseConfigured } from "./supabase";

// Test component that uses auth
function TestAuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="loading">{auth.loading ? "loading" : "ready"}</div>
      <div data-testid="user">{auth.user?.email ?? "no-user"}</div>
      <button onClick={() => auth.signInWithEmail("test@example.com")}>
        Sign In Email
      </button>
      <button onClick={() => auth.signInWithPassword("test@example.com", "password")}>
        Sign In Password
      </button>
      <button onClick={() => auth.signUp("new@example.com", "password")}>
        Sign Up
      </button>
      <button onClick={() => auth.resetPassword("test@example.com")}>
        Reset Password
      </button>
      <button onClick={() => auth.signOut()}>Sign Out</button>
    </div>
  );
}

function TestRequireAuthConsumer() {
  const { isAuthenticated, loading } = useRequireAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? "loading" : "ready"}</div>
      <div data-testid="authenticated">{isAuthenticated ? "yes" : "no"}</div>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AuthProvider without Supabase", () => {
    it("should render children", () => {
      render(
        <AuthProvider>
          <div data-testid="child">Hello</div>
        </AuthProvider>
      );
      expect(screen.getByTestId("child")).toHaveTextContent("Hello");
    });

    it("should set loading to false when supabase is not configured", async () => {
      render(
        <AuthProvider>
          <TestAuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("ready");
      });
    });

    it("should have null user when supabase is not configured", async () => {
      render(
        <AuthProvider>
          <TestAuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("user")).toHaveTextContent("no-user");
      });
    });
  });

  describe("useAuth hook", () => {
    it("should throw error when used outside AuthProvider", () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        render(<TestAuthConsumer />);
      }).toThrow("useAuth must be used within an AuthProvider");

      consoleSpy.mockRestore();
    });

    it("signInWithEmail returns error when supabase not configured", async () => {
      const user = userEvent.setup();
      let authResult: { error: Error | null } | undefined;

      function TestComponent() {
        const auth = useAuth();
        return (
          <button
            onClick={async () => {
              authResult = await auth.signInWithEmail("test@example.com");
            }}
          >
            Sign In
          </button>
        );
      }

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await user.click(screen.getByText("Sign In"));

      await waitFor(() => {
        expect(authResult?.error?.message).toBe("Supabase not configured");
      });
    });

    it("signInWithPassword returns error when supabase not configured", async () => {
      const user = userEvent.setup();
      let authResult: { error: Error | null } | undefined;

      function TestComponent() {
        const auth = useAuth();
        return (
          <button
            onClick={async () => {
              authResult = await auth.signInWithPassword("test@example.com", "pass");
            }}
          >
            Sign In
          </button>
        );
      }

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await user.click(screen.getByText("Sign In"));

      await waitFor(() => {
        expect(authResult?.error?.message).toBe("Supabase not configured");
      });
    });

    it("signUp returns error when supabase not configured", async () => {
      const user = userEvent.setup();
      let authResult: { error: Error | null } | undefined;

      function TestComponent() {
        const auth = useAuth();
        return (
          <button
            onClick={async () => {
              authResult = await auth.signUp("test@example.com", "pass");
            }}
          >
            Sign Up
          </button>
        );
      }

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await user.click(screen.getByText("Sign Up"));

      await waitFor(() => {
        expect(authResult?.error?.message).toBe("Supabase not configured");
      });
    });

    it("resetPassword returns error when supabase not configured", async () => {
      const user = userEvent.setup();
      let authResult: { error: Error | null } | undefined;

      function TestComponent() {
        const auth = useAuth();
        return (
          <button
            onClick={async () => {
              authResult = await auth.resetPassword("test@example.com");
            }}
          >
            Reset
          </button>
        );
      }

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await user.click(screen.getByText("Reset"));

      await waitFor(() => {
        expect(authResult?.error?.message).toBe("Supabase not configured");
      });
    });

    it("signOut does nothing when supabase not configured", async () => {
      const user = userEvent.setup();

      render(
        <AuthProvider>
          <TestAuthConsumer />
        </AuthProvider>
      );

      // Should not throw
      await user.click(screen.getByText("Sign Out"));
    });
  });

  describe("useRequireAuth hook", () => {
    it("should return isAuthenticated true when supabase not configured", async () => {
      vi.mocked(isSupabaseConfigured).mockReturnValue(false);

      render(
        <AuthProvider>
          <TestRequireAuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("ready");
        expect(screen.getByTestId("authenticated")).toHaveTextContent("yes");
      });
    });
  });
});

// Note: Tests for AuthContext with Supabase configured are challenging
// due to module hoisting. The core functionality (without Supabase) is
// well tested above. Integration tests with real Supabase would go in
// a separate e2e test suite.
