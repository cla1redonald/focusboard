import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, setupGlobalErrorHandlers } from "./logger";

describe("logger", () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    logger.clearBuffer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("debug", () => {
    it("should log debug messages with correct prefix", () => {
      logger.debug("Test debug message");

      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining("[DEBUG]"),
        expect.anything()
      );
      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining("Test debug message"),
        expect.anything()
      );
    });

    it("should include context in debug messages", () => {
      logger.debug("Debug with context", { component: "TestComponent" });

      expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining("component=TestComponent"),
        expect.anything()
      );
    });
  });

  describe("info", () => {
    it("should log info messages", () => {
      logger.info("Test info message");

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining("[INFO]")
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining("Test info message")
      );
    });
  });

  describe("warn", () => {
    it("should log warning messages", () => {
      logger.warn("Test warning message");

      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining("[WARN]"),
        expect.anything()
      );
    });

    it("should log warning with error object", () => {
      const error = new Error("Test error");
      logger.warn("Warning with error", { action: "test" }, error);

      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining("Warning with error"),
        expect.any(Error)
      );
    });
  });

  describe("error", () => {
    it("should log error messages", () => {
      logger.error("Test error message");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]"),
        expect.anything()
      );
    });

    it("should log error with context and error object", () => {
      const error = new Error("Database connection failed");
      logger.error("Failed to sync", { component: "Sync", userId: "123" }, error);

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("component=Sync"),
        expect.any(Error)
      );
    });

    it("should convert non-Error objects to Error", () => {
      logger.error("String error", {}, "Something went wrong");

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]"),
        expect.any(Error)
      );
    });
  });

  describe("buffer", () => {
    it("should buffer log entries", () => {
      logger.info("Message 1");
      logger.warn("Message 2");
      logger.error("Message 3");

      const buffer = logger.getBuffer();
      expect(buffer).toHaveLength(3);
      expect(buffer[0].message).toBe("Message 1");
      expect(buffer[1].message).toBe("Message 2");
      expect(buffer[2].message).toBe("Message 3");
    });

    it("should clear buffer", () => {
      logger.info("Message 1");
      logger.info("Message 2");

      logger.clearBuffer();

      expect(logger.getBuffer()).toHaveLength(0);
    });

    it("should include timestamp in buffer entries", () => {
      logger.info("Timestamped message");

      const buffer = logger.getBuffer();
      expect(buffer[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should limit buffer size to MAX_BUFFER_SIZE", () => {
      // Fill buffer beyond limit (100 is the max)
      for (let i = 0; i < 110; i++) {
        logger.info(`Message ${i}`);
      }

      const buffer = logger.getBuffer();
      expect(buffer.length).toBeLessThanOrEqual(100);
      // First 10 messages should have been dropped
      expect(buffer[0].message).toBe("Message 10");
    });
  });

  describe("withContext", () => {
    it("should create child logger with preset context", () => {
      const syncLogger = logger.withContext({ component: "Sync" });
      syncLogger.info("Sync started");

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining("component=Sync")
      );
    });

    it("should merge additional context", () => {
      const syncLogger = logger.withContext({ component: "Sync" });
      syncLogger.info("User sync", { userId: "user-123" });

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining("component=Sync")
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining("userId=user-123")
      );
    });

    it("should support all log levels", () => {
      const childLogger = logger.withContext({ component: "Test" });

      childLogger.debug("Debug");
      childLogger.info("Info");
      childLogger.warn("Warn");
      childLogger.error("Error");

      expect(consoleSpy.debug).toHaveBeenCalled();
      expect(consoleSpy.info).toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe("setupGlobalErrorHandlers", () => {
    it("should register unhandledrejection handler", () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");

      setupGlobalErrorHandlers();

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function)
      );
    });

    it("should register error handler", () => {
      const addEventListenerSpy = vi.spyOn(window, "addEventListener");

      setupGlobalErrorHandlers();

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "error",
        expect.any(Function)
      );
    });
  });
});
