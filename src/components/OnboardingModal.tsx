import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  {
    title: "Welcome to FocusBoard",
    emoji: "👋",
    description: "Your AI-powered kanban board for staying focused and getting things done. Let's walk through how to get the most out of it!",
  },
  {
    title: "Step 1: Add Your Tasks",
    emoji: "✏️",
    description: "Start by adding your tasks to the Backlog column. Click the + button or press N. Type naturally like \"urgent bug fix login page by friday\" — the AI will parse tags, priority, and due dates for you!",
  },
  {
    title: "AI-Powered Task Creation",
    emoji: "✨",
    description: "Look for the sparkles button when typing a task. Click it to let AI extract details from natural language. It understands priorities, due dates, categories, and more.",
  },
  {
    title: "Organize with Drag & Drop",
    emoji: "🎯",
    description: "Drag tasks between columns as you work on them. Each column has a WIP limit — when you hit it, finish something before starting something new. This keeps you focused!",
  },
  {
    title: "Step 2: Plan Your Work",
    emoji: "📅",
    description: "Once you have tasks, use the AI planning features in the header: Daily Focus (sparkles icon) suggests your top priorities, and Weekly Plan (calendar icon) helps schedule your week.",
  },
  {
    title: "Break Down Complex Tasks",
    emoji: "🧩",
    description: "Open any card and click \"Break down with AI\" to generate subtasks. Great for turning big projects into actionable steps. You can also add file attachments to cards!",
  },
  {
    title: "Step 3: Track & Analyze",
    emoji: "📊",
    description: "Click the chart icon to see your Metrics Dashboard — cycle time, throughput, and completion trends. The Timeline view shows your tasks as a Gantt chart.",
  },
  {
    title: "Keyboard Power User",
    emoji: "⌨️",
    description: "Press Cmd+K for the command palette. Use arrow keys to navigate, D to mark done, N to add cards. Press ? anytime to see all shortcuts.",
  },
  {
    title: "You're Ready!",
    emoji: "🚀",
    description: "Start by adding 3-5 tasks to your Backlog, then try the Daily Focus feature to see AI prioritization in action. Happy focusing!",
  },
];

export function OnboardingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = React.useState(0);
  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  React.useEffect(() => {
    if (open) {
      setStep(0);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handleBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1450] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-gray-900/40 dark:bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-[440px] max-w-[92vw] overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-[0_30px_80px_rgba(0,0,0,0.25)]"
      >
        {/* Progress dots */}
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 gap-1.5">
          {STEPS.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                idx === step ? "bg-emerald-500" : "bg-gray-200 dark:bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-8 pb-6 pt-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="text-center"
            >
              <div className="mb-4 text-5xl">{currentStep.emoji}</div>
              <h2 className="display-font mb-3 text-xl text-gray-900 dark:text-white">
                {currentStep.title}
              </h2>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {currentStep.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-6 py-4">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              step === 0
                ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            Back
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-500 dark:text-gray-400 transition hover:text-gray-900 dark:hover:text-white"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-md transition hover:bg-emerald-700"
            >
              {isLastStep ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
