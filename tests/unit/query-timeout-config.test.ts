import { describe, it, expect, afterEach, vi } from "vitest";
import { effectiveTimeoutMs } from "../../src/db/index.js";

describe("effectiveTimeoutMs", () => {
  it("uses the requested value when the server sets no limit", () => {
    expect(effectiveTimeoutMs(5000, 0)).toBe(5000);
    expect(effectiveTimeoutMs(0, 0)).toBe(0);
  });

  it("never goes above a limit the server already sets", () => {
    expect(effectiveTimeoutMs(500, 1000)).toBe(500);
    expect(effectiveTimeoutMs(5000, 1000)).toBe(1000);
    expect(effectiveTimeoutMs(0, 1000)).toBe(1000);
  });
});

// Config is read at import time, so load a fresh copy for each env combination.
// An empty string counts as unset (and keeps dotenv from filling it in).
async function loadConfig(env: { timeout?: string; max?: string }) {
  vi.resetModules();
  vi.stubEnv("MYSQL_QUERY_TIMEOUT", env.timeout ?? "");
  vi.stubEnv("MYSQL_QUERY_TIMEOUT_MAX", env.max ?? "");
  return import("../../src/config/index.js");
}

describe("query timeout config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 30000 ms, and without MYSQL_QUERY_TIMEOUT_MAX a call can only shorten it", async () => {
    const c = await loadConfig({});
    expect(c.MYSQL_QUERY_TIMEOUT).toBe(30000);
    expect(c.isValidQueryTimeout(1)).toBe(true);
    expect(c.isValidQueryTimeout(30000)).toBe(true);
    expect(c.isValidQueryTimeout(30001)).toBe(false);
    expect(c.isValidQueryTimeout(0)).toBe(false);
    expect(c.isValidQueryTimeout(1.5)).toBe(false);
    expect(c.isValidQueryTimeout("1000")).toBe(false);
    expect(c.QUERY_TIMEOUT_RULE).toContain("set MYSQL_QUERY_TIMEOUT_MAX to allow longer");
  });

  it("puts no ceiling on timeout_ms when the default is 0 and no MAX is set", async () => {
    const c = await loadConfig({ timeout: "0" });
    expect(c.isValidQueryTimeout(0)).toBe(true);
    expect(c.isValidQueryTimeout(3_600_000)).toBe(true);
    expect(c.isValidQueryTimeout(-1)).toBe(false);
  });

  it("with MYSQL_QUERY_TIMEOUT_MAX, rejects 0 and values above the ceiling", async () => {
    const c = await loadConfig({ timeout: "5000", max: "60000" });
    expect(c.MYSQL_QUERY_TIMEOUT).toBe(5000);
    expect(c.isValidQueryTimeout(60000)).toBe(true);
    expect(c.isValidQueryTimeout(60001)).toBe(false);
    expect(c.isValidQueryTimeout(0)).toBe(false);
    expect(c.QUERY_TIMEOUT_RULE).toContain("1 to 60000 ms");
  });

  it("lowers the default to the ceiling when only the ceiling is set", async () => {
    const c = await loadConfig({ max: "10000" });
    expect(c.MYSQL_QUERY_TIMEOUT).toBe(10000);
  });

  it("refuses to start with a default above the ceiling or an invalid value", async () => {
    await expect(loadConfig({ timeout: "0", max: "10000" })).rejects.toThrow(
      /MYSQL_QUERY_TIMEOUT must be an integer from 1 to 10000/,
    );
    await expect(loadConfig({ timeout: "30s" })).rejects.toThrow(
      /MYSQL_QUERY_TIMEOUT must be a non-negative integer/,
    );
    await expect(loadConfig({ max: "-5" })).rejects.toThrow(
      /MYSQL_QUERY_TIMEOUT_MAX must be/,
    );
  });
});
