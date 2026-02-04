import React from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  undoAction?: () => void;
};

type ToastActions = {
  showToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
};

// Separate contexts: actions (stable, never triggers re-renders) vs data (volatile)
const ToastActionContext = React.createContext<ToastActions | null>(null);
const ToastDataContext = React.createContext<Toast[]>([]);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const showToast = React.useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newToast: Toast = { id, ...toast };
    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss after duration (default 3000ms)
    const duration = toast.duration ?? 3000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Actions object is stable (both functions are useCallback with empty deps)
  const actions = React.useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast]
  );

  return (
    <ToastActionContext.Provider value={actions}>
      <ToastDataContext.Provider value={toasts}>
        {children}
      </ToastDataContext.Provider>
    </ToastActionContext.Provider>
  );
}

/** Use in components that SHOW toasts — stable, never causes re-render */
export function useToast() {
  const context = React.useContext(ToastActionContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/** Use in components that DISPLAY toasts — re-renders when toasts change */
export function useToastData() {
  return React.useContext(ToastDataContext);
}
