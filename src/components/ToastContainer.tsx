import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast, type Toast, type ToastType } from "../app/ToastContext";

const TOAST_ICONS: Record<ToastType, string> = {
  success: "checkmark",
  error: "xmark",
  info: "info",
  warning: "warning",
};

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
  },
  error: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-800",
  },
  info: {
    bg: "bg-sky-50",
    border: "border-sky-200",
    text: "text-sky-800",
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
  },
};

function ToastIcon({ type }: { type: ToastType }) {
  const iconType = TOAST_ICONS[type];

  if (iconType === "checkmark") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (iconType === "xmark") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    );
  }

  if (iconType === "info") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    );
  }

  // warning
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { dismissToast } = useToast();
  const colors = TOAST_COLORS[toast.type];
  const [_isPaused, setIsPaused] = React.useState(false);

  const handleUndo = () => {
    if (toast.undoAction) {
      toast.undoAction();
    }
    dismissToast(toast.id);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 100, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`flex items-center gap-3 rounded-xl border ${colors.border} ${colors.bg} px-4 py-3 shadow-lg backdrop-blur-sm`}
    >
      <div className={colors.text}>
        <ToastIcon type={toast.type} />
      </div>
      <span className={`text-sm font-medium ${colors.text}`}>{toast.message}</span>

      {toast.undoAction && (
        <button
          onClick={handleUndo}
          className="ml-2 rounded-md bg-white/80 px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-white"
        >
          Undo
        </button>
      )}

      <button
        onClick={() => dismissToast(toast.id)}
        className={`ml-auto rounded-md p-1 transition hover:bg-black/5 ${colors.text}`}
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  return (
    <div className="fixed bottom-6 right-6 z-[1600] flex flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
