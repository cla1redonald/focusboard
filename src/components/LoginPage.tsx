import React from "react";
import { useAuth } from "../app/AuthContext";

export function LoginPage() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
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
              <div className="mb-4 text-5xl">📧</div>
              <div className="text-lg font-medium text-emerald-900 mb-2">
                Check your email
              </div>
              <div className="text-sm text-emerald-900/70 mb-6">
                We sent a magic link to <strong>{email}</strong>
              </div>
              <button
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                }}
                className="text-sm text-emerald-700 hover:text-emerald-900 underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
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

              <div className="mt-6 text-center text-xs text-emerald-900/50">
                No password needed. We'll email you a secure login link.
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
