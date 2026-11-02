import { log } from "../utils/index.js";
import { getPool, safeExit, poolPromise } from "../db/index.js";

export interface ProcessSetupDeps {
  testConnection: () => Promise<void>;
  registerHandlers: () => void;
  exit: (code: number) => void;
}

const shutdown = async (signal: string): Promise<void> => {
  log("error", `Received ${signal}. Shutting down...`);
  try {
    // Only attempt to close the pool if it was created
    if (poolPromise) {
      const pool = await poolPromise;
      await pool.end();
    }
  } catch (err) {
    log("error", "Error closing pool:", err);
    throw err;
  }
};

const defaultDeps: ProcessSetupDeps = {
  testConnection: async () => {
    log("info", "Attempting to test database connection...");
    const pool = await getPool();
    const connection = await pool.getConnection();
    log("info", "Database connection test successful");
    connection.release();
  },
  registerHandlers: () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, async () => {
        try {
          await shutdown(signal);
          process.exit(0);
        } catch (err) {
          log("error", `Error during ${signal} shutdown:`, err);
          safeExit(1);
        }
      });
    }
    process.on("uncaughtException", (error) => {
      log("error", "Uncaught exception:", error);
      safeExit(1);
    });
    process.on("unhandledRejection", (reason, promise) => {
      log("error", "Unhandled rejection at:", promise, "reason:", reason);
      safeExit(1);
    });
  },
  exit: safeExit,
};

let setupPromise: Promise<void> | undefined;

/**
 * One-time process setup: shutdown/error handlers and a database connection
 * test. Idempotent; callers share the same promise. Exits the process when the
 * connection test fails, so awaiting it gives a fail-fast startup.
 */
export function runProcessSetup(
  deps: ProcessSetupDeps = defaultDeps,
): Promise<void> {
  if (!setupPromise) {
    deps.registerHandlers();
    setupPromise = deps.testConnection().catch((error) => {
      log("error", "Fatal error during server startup:", error);
      deps.exit(1);
    });
  }
  return setupPromise;
}

/** Test helper: allows runProcessSetup to run again. */
export function resetProcessSetup(): void {
  setupPromise = undefined;
}
