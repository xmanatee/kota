import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abbreviateRunId, formatDuration, formatTimeAgo, formatUptime, padLabel, truncateLine } from "./format-utils.js";

describe("formatUptime", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("formats seconds", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(formatUptime("2026-01-01T00:00:00Z")).toBe("30s");
  });

  it("formats minutes and seconds", () => {
    vi.setSystemTime(new Date("2026-01-01T00:05:15Z"));
    expect(formatUptime("2026-01-01T00:00:00Z")).toBe("5m 15s");
  });

  it("formats hours and minutes", () => {
    vi.setSystemTime(new Date("2026-01-01T02:14:00Z"));
    expect(formatUptime("2026-01-01T00:00:00Z")).toBe("2h 14m");
  });

  it("formats days and hours", () => {
    vi.setSystemTime(new Date("2026-01-03T05:00:00Z"));
    expect(formatUptime("2026-01-01T00:00:00Z")).toBe("2d 5h");
  });
});

describe("formatDuration", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("formats under a minute", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:45Z"));
    expect(formatDuration("2026-01-01T00:00:00Z")).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    vi.setSystemTime(new Date("2026-01-01T00:02:30Z"));
    expect(formatDuration("2026-01-01T00:00:00Z")).toBe("2m 30s");
  });
});

describe("formatTimeAgo", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows seconds ago", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    expect(formatTimeAgo("2026-01-01T00:00:00Z")).toBe("10s ago");
  });

  it("shows minutes ago", () => {
    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
    expect(formatTimeAgo("2026-01-01T00:00:00Z")).toBe("5m ago");
  });

  it("shows hours ago", () => {
    vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
    expect(formatTimeAgo("2026-01-01T00:00:00Z")).toBe("3h ago");
  });
});

describe("abbreviateRunId", () => {
  it("extracts the last segment after hyphen", () => {
    expect(abbreviateRunId("2026-04-15T13-13-57-840Z-builder-i8tz5a")).toBe("i8tz5a");
  });

  it("handles short IDs with no hyphens", () => {
    expect(abbreviateRunId("abcdefgh")).toBe("abcdefgh");
  });

  it("handles IDs with a single hyphen", () => {
    expect(abbreviateRunId("prefix-suffix")).toBe("suffix");
  });
});

describe("truncateLine", () => {
  it("returns line unchanged when under limit", () => {
    expect(truncateLine("short", 80)).toBe("short");
  });

  it("truncates with ellipsis when over limit", () => {
    const long = "a".repeat(100);
    const result = truncateLine(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("returns exact-length line unchanged", () => {
    const exact = "a".repeat(80);
    expect(truncateLine(exact, 80)).toBe(exact);
  });
});

describe("padLabel", () => {
  it("pads to default width of 12", () => {
    expect(padLabel("Foo:")).toBe("Foo:        ");
    expect(padLabel("Foo:").length).toBe(12);
  });

  it("pads to custom width", () => {
    expect(padLabel("Foo:", 8)).toBe("Foo:    ");
  });
});
