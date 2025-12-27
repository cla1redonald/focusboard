import React from "react";
import { supabase } from "../app/supabase";

type Props = {
  onComplete: () => void;
};

export function SetPasswordPage({ onComplete }: Props) {
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      setStatus("error");
      setErrorMessage("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("error");
      setErrorMessage("Passwords do not match");
      return;
    }

    if (!supabase) {
      setStatus("error");
      setErrorMessage("Supabase not configured");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    } else {
      setStatus("success");
      // Clear the hash from URL
      window.history.replaceState(null, "", window.location.pathname);
      // Wait a moment then redirect
      setTimeout(onComplete, 1500);
    }
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
              Set your password
            </div>
          </div>

          {status === "success" ? (
            <div className="text-center">
              <div className="mb-4 text-5xl">✅</div>
              <div className="text-lg font-medium text-emerald-900 mb-2">
                Password set!
              </div>
              <div className="text-sm text-emerald-900/70">
                Redirecting to your board...
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="block mb-2 text-sm font-medium text-emerald-900">
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                disabled={status === "loading"}
                className="w-full rounded-xl border border-emerald-700/20 bg-white px-4 py-3 text-emerald-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50"
                autoFocus
              />

              <label className="block mt-4 mb-2 text-sm font-medium text-emerald-900">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Enter password again"
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
                disabled={status === "loading" || !password || !confirmPassword}
                className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "loading" ? "Setting password..." : "Set password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
