import React from "react";
import { Clock, Play, Pause, RotateCcw, SkipForward, X } from "lucide-react";

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
  focus: "bg-emerald-500",
  shortBreak: "bg-blue-500",
  longBreak: "bg-violet-500",
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
        className="flex items-center gap-2 rounded-md px-2 py-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
        title="Open Pomodoro Timer"
      >
        <div className="relative">
          <Clock size={16} />
          {isRunning && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
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
      <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🍅</span>
            <span className="font-semibold text-gray-900">Pomodoro</span>
          </div>
          <button
            onClick={() => setIsExpanded(false)}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-lg">
          {(["focus", "shortBreak", "longBreak"] as TimerMode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${
                mode === m
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
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
              stroke="#f3f4f6"
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
                mode === "focus" ? "text-emerald-500" : mode === "shortBreak" ? "text-blue-500" : "text-violet-500"
              }`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-900 tabular-nums">
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
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
            title="Reset"
          >
            <RotateCcw size={20} />
          </button>
          <button
            onClick={toggleTimer}
            className={`flex items-center justify-center w-14 h-14 rounded-full transition ${
              isRunning
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {isRunning ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
          </button>
          <button
            onClick={() => {
              const newMode = mode === "focus" ? "shortBreak" : "focus";
              switchMode(newMode);
            }}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
            title="Skip"
          >
            <SkipForward size={20} />
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-4 text-xs text-gray-500 border-t border-gray-100 pt-3">
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
