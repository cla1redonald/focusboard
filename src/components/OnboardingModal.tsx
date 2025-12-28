import React from "react";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  {
    title: "Welcome to Focusboard",
    emoji: "👋",
    description: "Your personal kanban board for staying focused and getting things done. Let's take a quick tour!",
  },
  {
    title: "WIP Limits Keep You Focused",
    emoji: "🎯",
    description: "Each column has a work-in-progress limit. When you hit the limit, finish something before starting something new. This keeps you focused and prevents overwhelm.",
  },
  {
    title: "Quick Navigation with Cmd+K",
    emoji: "⌨️",
    description: "Press Cmd+K (or Ctrl+K) to open the command palette. Quickly search cards, jump to columns, or access settings without leaving your keyboard.",
  },
  {
    title: "Track Your Progress",
    emoji: "📊",
    description: "Click the metrics button to see your productivity stats: cycle time, throughput, and more. Understanding your flow helps you improve!",
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
        className="absolute inset-0 bg-amber-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-[440px] max-w-[92vw] overflow-hidden rounded-2xl border border-amber-700/15 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.25)]"
      >
        {/* Progress dots */}
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 gap-1.5">
          {STEPS.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                idx === step ? "bg-amber-500" : "bg-amber-200"
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
              <h2 className="display-font mb-3 text-xl text-amber-950">
                {currentStep.title}
              </h2>
              <p className="text-sm leading-relaxed text-amber-800/70">
                {currentStep.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-amber-700/10 bg-amber-50/50 px-6 py-4">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              step === 0
                ? "text-amber-400 cursor-not-allowed"
                : "text-amber-700 hover:bg-amber-100"
            }`}
          >
            Back
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-amber-700/70 transition hover:text-amber-900"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-medium text-white shadow-md transition hover:bg-amber-700"
            >
              {isLastStep ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
