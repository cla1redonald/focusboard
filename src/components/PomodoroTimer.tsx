import React from "react";

type TimerMode = "focus" | "shortBreak" | "longBreak";

const TIMER_DURATIONS: Record<TimerMode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const MODE_LABELS: Record<TimerMode, string> = {
  focus: "Focus",
  shortBreak: "Short Break",
  longBreak: "Long Break",
};

const MODE_COLORS: Record<TimerMode, string> = {
  focus: "bg-amber-500",
  shortBreak: "bg-emerald-500",
  longBreak: "bg-blue-500",
};

const STORAGE_KEY = "focusboard:pomodoro";

type PomodoroState = {
  completedPomodoros: number;
  totalFocusMinutes: number;
};

function loadPomodoroState(): PomodoroState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore errors
  }
  return { completedPomodoros: 0, totalFocusMinutes: 0 };
}

function savePomodoroState(state: PomodoroState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Simple beep using Web Audio API
function playNotificationSound() {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.value = 0.3;

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    oscillator.stop(audioContext.currentTime + 0.5);

    // Play a second beep
    setTimeout(() => {
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.value = 1000;
      osc2.type = "sine";
      gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      osc2.stop(audioContext.currentTime + 0.5);
    }, 200);
  } catch {
    // Fallback: do nothing if audio fails
  }
}

export function PomodoroTimer() {
  const [mode, setMode] = React.useState<TimerMode>("focus");
  const [timeLeft, setTimeLeft] = React.useState(TIMER_DURATIONS.focus);
  const [isRunning, setIsRunning] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [pomodoroState, setPomodoroState] = React.useState<PomodoroState>(loadPomodoroState);

  // Timer interval
  React.useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          playNotificationSound();

          // Auto-switch mode
          if (mode === "focus") {
            const newState = {
              completedPomodoros: pomodoroState.completedPomodoros + 1,
              totalFocusMinutes: pomodoroState.totalFocusMinutes + 25,
            };
            setPomodoroState(newState);
            savePomodoroState(newState);

            // Every 4 pomodoros, suggest long break
            if ((pomodoroState.completedPomodoros + 1) % 4 === 0) {
              setMode("longBreak");
              return TIMER_DURATIONS.longBreak;
            } else {
              setMode("shortBreak");
              return TIMER_DURATIONS.shortBreak;
            }
          } else {
            setMode("focus");
            return TIMER_DURATIONS.focus;
          }
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, mode, pomodoroState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleTimer = () => {
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(TIMER_DURATIONS[mode]);
  };

  const switchMode = (newMode: TimerMode) => {
    setMode(newMode);
    setTimeLeft(TIMER_DURATIONS[newMode]);
    setIsRunning(false);
  };

  const progress = 1 - timeLeft / TIMER_DURATIONS[mode];

  // Compact view when not expanded
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-amber-700 transition hover:bg-amber-600/10"
        title="Open Pomodoro Timer"
      >
        <div className="relative">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          {isRunning && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          )}
        </div>
        <span className="text-sm font-medium">{formatTime(timeLeft)}</span>
      </button>
    );
  }

  return (
    <div className="relative">
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setIsExpanded(false)}
      />

      {/* Timer panel */}
      <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-2xl border border-amber-700/15 bg-white p-4 shadow-[0_20px_50px_rgba(0,0,0,0.15)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🍅</span>
            <span className="font-semibold text-amber-950">Pomodoro</span>
          </div>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-amber-700/60 hover:text-amber-700 transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-4 p-1 bg-amber-100/50 rounded-xl">
          {(["focus", "shortBreak", "longBreak"] as TimerMode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${
                mode === m
                  ? "bg-white text-amber-900 shadow-sm"
                  : "text-amber-700/70 hover:text-amber-900"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Timer display */}
        <div className="relative flex items-center justify-center mb-4">
          {/* Progress ring */}
          <svg className="w-32 h-32 -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="58"
              fill="none"
              stroke="#FEF3C7"
              strokeWidth="8"
            />
            <circle
              cx="64"
              cy="64"
              r="58"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 58}`}
              strokeDashoffset={`${2 * Math.PI * 58 * (1 - progress)}`}
              className={`transition-all duration-1000 ${
                mode === "focus" ? "text-amber-500" : mode === "shortBreak" ? "text-emerald-500" : "text-blue-500"
              }`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-amber-950 tabular-nums">
              {formatTime(timeLeft)}
            </span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full mt-1 ${MODE_COLORS[mode]} text-white`}>
              {MODE_LABELS[mode]}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            onClick={resetTimer}
            className="p-2 rounded-full text-amber-700 hover:bg-amber-100 transition"
            title="Reset"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={toggleTimer}
            className={`flex items-center justify-center w-14 h-14 rounded-full transition ${
              isRunning
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                : "bg-amber-500 text-white hover:bg-amber-600"
            }`}
          >
            {isRunning ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
              </svg>
            ) : (
              <svg className="h-6 w-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => {
              const newMode = mode === "focus" ? "shortBreak" : "focus";
              switchMode(newMode);
            }}
            className="p-2 rounded-full text-amber-700 hover:bg-amber-100 transition"
            title="Skip"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-4 text-xs text-amber-700 border-t border-amber-100 pt-3">
          <div className="flex items-center gap-1">
            <span>🍅</span>
            <span>{pomodoroState.completedPomodoros} today</span>
          </div>
          <div className="flex items-center gap-1">
            <span>⏱️</span>
            <span>{pomodoroState.totalFocusMinutes} min focused</span>
          </div>
        </div>
      </div>
    </div>
  );
}
