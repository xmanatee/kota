import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLogFormatter } from "./log-format.js";

describe("resolveLogFormatter — text (default)", () => {
  it("formats info without level prefix", () => {
    const fmt = resolveLogFormatter("text");
    expect(fmt("info", "[extension:foo]", "hello")).toBe("[extension:foo] hello");
  });

  it("formats warn with WARN prefix", () => {
    const fmt = resolveLogFormatter("text");
    expect(fmt("warn", "[extension:foo]", "uh oh")).toBe("[extension:foo] WARN: uh oh");
  });

  it("formats error with ERROR prefix", () => {
    const fmt = resolveLogFormatter("text");
    expect(fmt("error", "[extension:foo]", "boom")).toBe("[extension:foo] ERROR: boom");
  });

  it("formats debug with DEBUG prefix", () => {
    const fmt = resolveLogFormatter("text");
    expect(fmt("debug", "[extension:foo]", "trace")).toBe("[extension:foo] DEBUG: trace");
  });
});

describe("resolveLogFormatter — json", () => {
  it("returns valid JSON string", () => {
    const fmt = resolveLogFormatter("json");
    const line = fmt("info", "[extension:myext]", "hello world");
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it("includes required fields: ts, level, msg", () => {
    const fmt = resolveLogFormatter("json");
    const parsed = JSON.parse(fmt("info", "[extension:myext]", "hello world"));
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello world");
  });

  it("extracts extension name from prefix", () => {
    const fmt = resolveLogFormatter("json");
    const parsed = JSON.parse(fmt("info", "[extension:myext]", "msg"));
    expect(parsed.extension).toBe("myext");
  });

  it("omits extension for non-extension prefix", () => {
    const fmt = resolveLogFormatter("json");
    const parsed = JSON.parse(fmt("info", "[extension]", "msg"));
    expect(parsed.extension).toBeUndefined();
  });

  it("includes data field when provided", () => {
    const fmt = resolveLogFormatter("json");
    const parsed = JSON.parse(fmt("warn", "[extension:foo]", "msg", { key: "val" }));
    expect(parsed.data).toEqual({ key: "val" });
  });

  it("omits data field when not provided", () => {
    const fmt = resolveLogFormatter("json");
    const parsed = JSON.parse(fmt("info", "[extension:foo]", "msg"));
    expect(parsed.data).toBeUndefined();
  });

  it("ts is a valid ISO 8601 timestamp", () => {
    const fmt = resolveLogFormatter("json");
    const parsed = JSON.parse(fmt("info", "[extension:foo]", "msg"));
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });
});

describe("resolveLogFormatter — LOG_FORMAT env var", () => {
  const originalEnv = process.env.LOG_FORMAT;

  beforeEach(() => {
    delete process.env.LOG_FORMAT;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LOG_FORMAT;
    } else {
      process.env.LOG_FORMAT = originalEnv;
    }
  });

  it("defaults to text when LOG_FORMAT is unset", () => {
    const fmt = resolveLogFormatter();
    const result = fmt("info", "[extension:foo]", "msg");
    expect(result).toBe("[extension:foo] msg");
    expect(() => JSON.parse(result)).toThrow();
  });

  it("uses json when LOG_FORMAT=json", () => {
    process.env.LOG_FORMAT = "json";
    const fmt = resolveLogFormatter();
    const result = fmt("info", "[extension:foo]", "msg");
    const parsed = JSON.parse(result);
    expect(parsed.level).toBe("info");
  });

  it("explicit format arg overrides LOG_FORMAT env var", () => {
    process.env.LOG_FORMAT = "json";
    const fmt = resolveLogFormatter("text");
    const result = fmt("info", "[extension:foo]", "msg");
    expect(result).toBe("[extension:foo] msg");
  });
});
