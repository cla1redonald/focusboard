import React from "react";
import { useAuth } from "../app/AuthContext";

type AuthMode = "login" | "signup" | "magic-link";

export function LoginPage() {
  const { signInWithEmail, signInWithPassword, signUp } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<AuthMode>("login");
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState("");

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

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

  const resetForm = () => {
    setStatus("idle");
    setEmail("");
    setPassword("");
    setErrorMessage("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <div className="w-full max-w-md px-6">
        <div className="rounded-2xl border border-emerald-700/10 bg-white/90 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.1)] backdrop-blur">
          <div className="text-center mb-8">
            <div className="display-font text-3xl text-emerald-950 mb-2">
              Focusboard
            </div>
            <div className="text-sm text-emerald-900/70">
              Plan with intent. Keep flow sacred.
            </div>
          </div>

          {status === "sent" ? (
            <div className="text-center">
              <div className="mb-4 text-5xl">{mode === "signup" ? "✅" : "📧"}</div>
              <div className="text-lg font-medium text-emerald-900 mb-2">
                {mode === "signup" ? "Account created!" : "Check your email"}
              </div>
              <div className="text-sm text-emerald-900/70 mb-6">
                {mode === "signup"
                  ? "You can now sign in with your password."
                  : <>We sent a magic link to <strong>{email}</strong></>
                }
              </div>
              <button
                onClick={() => {
                  resetForm();
                  setMode("login");
                }}
                className="text-sm text-emerald-700 hover:text-emerald-900 underline"
              >
                {mode === "signup" ? "Sign in now" : "Use a different email"}
              </button>
            </div>
          ) : mode === "magic-link" ? (
            <form onSubmit={handleMagicLinkSubmit}>
              <label className="block mb-2 text-sm font-medium text-emerald-900">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={status === "loading"}
                className="w-full rounded-xl border border-emerald-700/20 bg-white px-4 py-3 text-emerald-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50"
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
                className="mt-4 w-full text-sm text-emerald-700 hover:text-emerald-900"
              >
                Back to password login
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit}>
              <label className="block mb-2 text-sm font-medium text-emerald-900">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={status === "loading"}
                className="w-full rounded-xl border border-emerald-700/20 bg-white px-4 py-3 text-emerald-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50"
                autoFocus
              />

              <label className="block mt-4 mb-2 text-sm font-medium text-emerald-900">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "Create a password (min 6 chars)" : "Enter your password"}
                disabled={status === "loading"}
                className="w-full rounded-xl border border-emerald-700/20 bg-white px-4 py-3 text-emerald-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50"
              />

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
                  className="text-emerald-700 hover:text-emerald-900"
                >
                  {mode === "signup" ? "Already have an account?" : "Create an account"}
                </button>
                <button
                  type="button"
                  onClick={() => { resetForm(); setMode("magic-link"); }}
                  className="text-emerald-700 hover:text-emerald-900"
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
