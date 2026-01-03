/**
 * Structured error logging utility for FocusBoard
 *
 * Provides consistent error logging with context and severity levels.
 * Can be extended to integrate with error tracking services (Sentry, etc.)
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  component?: string;
  action?: string;
  userId?: string;
  cardId?: string;
  [key: string]: unknown;
};

type LogEntry = {
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: Error;
  timestamp: string;
};

// Check if we're in development mode
const isDev = import.meta.env.DEV;

// Log buffer for potential batch sending to error tracking service
const logBuffer: LogEntry[] = [];
const MAX_BUFFER_SIZE = 100;

/**
 * Create a log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: unknown
): LogEntry {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  if (context) {
    entry.context = context;
  }

  if (error) {
    entry.error = error instanceof Error ? error : new Error(String(error));
  }

  return entry;
}

/**
 * Add entry to buffer (for potential future batch sending)
 */
function bufferLog(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift(); // Remove oldest entry
  }
}

/**
 * Output log to console with formatting
 */
function outputLog(entry: LogEntry): void {
  const prefix = `[${entry.level.toUpperCase()}]`;
  const contextStr = entry.context
    ? ` [${Object.entries(entry.context)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}]`
    : "";

  const logMessage = `${prefix}${contextStr} ${entry.message}`;

  switch (entry.level) {
    case "debug":
      if (isDev) console.debug(logMessage, entry.error || "");
      break;
    case "info":
      console.info(logMessage);
      break;
    case "warn":
      console.warn(logMessage, entry.error || "");
      break;
    case "error":
      console.error(logMessage, entry.error || "");
      break;
  }
}

/**
 * Main logger object with level-specific methods
 */
export const logger = {
  /**
   * Log debug message (only in development)
   */
  debug(message: string, context?: LogContext): void {
    const entry = createLogEntry("debug", message, context);
    bufferLog(entry);
    outputLog(entry);
  },

  /**
   * Log informational message
   */
  info(message: string, context?: LogContext): void {
    const entry = createLogEntry("info", message, context);
    bufferLog(entry);
    outputLog(entry);
  },

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext, error?: unknown): void {
    const entry = createLogEntry("warn", message, context, error);
    bufferLog(entry);
    outputLog(entry);
  },

  /**
   * Log error message
   */
  error(message: string, context?: LogContext, error?: unknown): void {
    const entry = createLogEntry("error", message, context, error);
    bufferLog(entry);
    outputLog(entry);

    // Here you could integrate with error tracking services:
    // if (window.Sentry) {
    //   Sentry.captureException(entry.error, { extra: entry.context });
    // }
  },

  /**
   * Get buffered logs (useful for debugging or sending to server)
   */
  getBuffer(): readonly LogEntry[] {
    return [...logBuffer];
  },

  /**
   * Clear the log buffer
   */
  clearBuffer(): void {
    logBuffer.length = 0;
  },

  /**
   * Create a child logger with preset context
   */
  withContext(defaultContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) =>
        logger.debug(message, { ...defaultContext, ...context }),
      info: (message: string, context?: LogContext) =>
        logger.info(message, { ...defaultContext, ...context }),
      warn: (message: string, context?: LogContext, error?: unknown) =>
        logger.warn(message, { ...defaultContext, ...context }, error),
      error: (message: string, context?: LogContext, error?: unknown) =>
        logger.error(message, { ...defaultContext, ...context }, error),
    };
  },
};

/**
 * Global unhandled rejection handler
 * Call this once at app initialization to catch unhandled promise rejections
 */
export function setupGlobalErrorHandlers(): void {
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (event) => {
      logger.error(
        "Unhandled promise rejection",
        { component: "global" },
        event.reason
      );
    });

    window.addEventListener("error", (event) => {
      logger.error(
        "Uncaught error",
        {
          component: "global",
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
        event.error
      );
    });
  }
}

export default logger;
