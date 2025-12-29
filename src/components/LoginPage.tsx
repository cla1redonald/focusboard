import React from "react";
import { useAuth } from "../app/AuthContext";

type AuthMode = "login" | "signup" | "magic-link" | "reset-password";

export function LoginPage() {
  const { signInWithEmail, signInWithPassword, signUp, resetPassword } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<AuthMode>("login");
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState("");

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) {
      return "Password must be at least 8 characters";
    }
    if (!/[a-z]/.test(pwd)) {
      return "Password must contain a lowercase letter";
    }
    if (!/[A-Z]/.test(pwd)) {
      return "Password must contain an uppercase letter";
    }
    if (!/[0-9]/.test(pwd)) {
      return "Password must contain a number";
    }
    return null;
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    // Only validate password strength on signup
    if (mode === "signup") {
      const validationError = validatePassword(password);
      if (validationError) {
        setStatus("error");
        setErrorMessage(validationError);
        return;
      }
    }

    setStatus("loading");
    setErrorMessage("");

    if (mode === "signup") {
      const { error } = await signUp(email.trim(), password);
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
      } else {
        setStatus("sent");
      }
    } else {
      const { error } = await signInWithPassword(email.trim(), password);
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
      }
      // On success, the auth state change will redirect automatically
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMessage("");

    const { error } = await signInWithEmail(email.trim());

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    } else {
      setStatus("sent");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMessage("");

    const { error } = await resetPassword(email.trim());

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    } else {
      setStatus("sent");
    }
  };

  const resetForm = () => {
    setStatus("idle");
    setEmail("");
    setPassword("");
    setErrorMessage("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md px-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="h-8 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-teal-500" />
              <div className="text-3xl font-bold text-gray-900">
                Focusboard
              </div>
            </div>
            <div className="text-sm text-gray-500">
              Plan with intent. Keep flow sacred.
            </div>
          </div>

          {status === "sent" ? (
            <div className="text-center">
              <div className="mb-4 text-5xl">
                {mode === "signup" ? "✅" : "📧"}
              </div>
              <div className="text-lg font-medium text-gray-900 mb-2">
                {mode === "signup" ? "Account created!" : "Check your email"}
              </div>
              <div className="text-sm text-gray-600 mb-6">
                {mode === "signup"
                  ? "You can now sign in with your password."
                  : mode === "reset-password"
                  ? <>We sent a password reset link to <strong>{email}</strong></>
                  : <>We sent a magic link to <strong>{email}</strong></>
                }
              </div>
              <button
                onClick={() => {
                  resetForm();
                  setMode("login");
                }}
                className="text-sm text-emerald-600 hover:text-emerald-700 underline"
              >
                {mode === "signup" || mode === "reset-password" ? "Sign in now" : "Use a different email"}
              </button>
            </div>
          ) : mode === "magic-link" ? (
            <form onSubmit={handleMagicLinkSubmit}>
              <label className="block mb-2 text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={status === "loading"}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
                autoFocus
              />

              {status === "error" && (
                <div className="mt-3 text-sm text-rose-600">
                  {errorMessage || "Something went wrong. Please try again."}
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading" || !email.trim()}
                className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "loading" ? "Sending..." : "Send magic link"}
              </button>

              <button
                type="button"
                onClick={() => { resetForm(); setMode("login"); }}
                className="mt-4 w-full text-sm text-emerald-600 hover:text-emerald-700"
              >
                Back to password login
              </button>
            </form>
          ) : mode === "reset-password" ? (
            <form onSubmit={handleResetPassword}>
              <div className="mb-4 text-sm text-gray-600">
                Enter your email and we'll send you a link to set your password.
              </div>
              <label className="block mb-2 text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={status === "loading"}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
                autoFocus
              />

              {status === "error" && (
                <div className="mt-3 text-sm text-rose-600">
                  {errorMessage || "Something went wrong. Please try again."}
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading" || !email.trim()}
                className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "loading" ? "Sending..." : "Send password reset link"}
              </button>

              <button
                type="button"
                onClick={() => { resetForm(); setMode("login"); }}
                className="mt-4 w-full text-sm text-emerald-600 hover:text-emerald-700"
              >
                Back to login
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit}>
              <label className="block mb-2 text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={status === "loading"}
                autoComplete="email"
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
                autoFocus
              />

              <label className="block mt-4 mb-2 text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "Min 8 chars, upper/lower/number" : "Enter your password"}
                disabled={status === "loading"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50"
              />
              {mode === "signup" && (
                <div className="mt-1 text-xs text-gray-500">
                  At least 8 characters with uppercase, lowercase, and a number
                </div>
              )}

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => { setStatus("idle"); setErrorMessage(""); setMode("reset-password"); }}
                  className="mt-2 text-xs text-emerald-600 hover:text-emerald-700"
                >
                  Forgot password? Set a new one
                </button>
              )}

              {status === "error" && (
                <div className="mt-3 text-sm text-rose-600">
                  {errorMessage || "Something went wrong. Please try again."}
                </div>
              )}

              <button
                type="submit"
                disabled={status === "loading" || !email.trim() || !password}
                className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "loading"
                  ? (mode === "signup" ? "Creating account..." : "Signing in...")
                  : (mode === "signup" ? "Create account" : "Sign in")
                }
              </button>

              <div className="mt-6 flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { resetForm(); setMode(mode === "signup" ? "login" : "signup"); }}
                  className="text-emerald-600 hover:text-emerald-700"
                >
                  {mode === "signup" ? "Already have an account?" : "Create an account"}
                </button>
                <button
                  type="button"
                  onClick={() => { resetForm(); setMode("magic-link"); }}
                  className="text-emerald-600 hover:text-emerald-700"
                >
                  Use magic link
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
