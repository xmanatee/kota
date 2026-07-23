import { describe, expect, it } from "vitest";
import { JsonFileError } from "#core/util/json-file.js";
import { assertDaemonState } from "./daemon-state.js";

const validState = {
  startedAt: "2026-01-01T00:00:00.000Z",
  pid: 12345,
};

describe("assertDaemonState", () => {
  it("accepts a minimal valid state", () => {
    expect(() => assertDaemonState("/path", validState)).not.toThrow();
  });

  it("accepts a fully populated state", () => {
    const full = {
      ...validState,
      lastStoppedAt: "2026-01-01T02:00:00.000Z",
      lastStopReason: "sigint",
    };
    expect(() => assertDaemonState("/path", full)).not.toThrow();
  });

  it("throws for non-object input", () => {
    expect(() => assertDaemonState("/p", null)).toThrow(JsonFileError);
    expect(() => assertDaemonState("/p", "string")).toThrow(JsonFileError);
    expect(() => assertDaemonState("/p", 42)).toThrow(JsonFileError);
    expect(() => assertDaemonState("/p", [])).toThrow(JsonFileError);
  });

  it("throws when startedAt is missing", () => {
    const bad = { ...validState, startedAt: undefined };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when startedAt is empty string", () => {
    const bad = { ...validState, startedAt: "   " };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when pid is missing", () => {
    const { pid: _p, ...bad } = validState;
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when pid is zero", () => {
    const bad = { ...validState, pid: 0 };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when pid is negative", () => {
    const bad = { ...validState, pid: -1 };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when lastStoppedAt or lastStopReason is invalid", () => {
    expect(() =>
      assertDaemonState("/p", { ...validState, lastStoppedAt: "" }),
    ).toThrow(JsonFileError);
    expect(() =>
      assertDaemonState("/p", { ...validState, lastStopReason: "unknown" }),
    ).toThrow(JsonFileError);
  });

  it("throws contain the path in error message", () => {
    expect(() => assertDaemonState("/state.json", null)).toThrow("/state.json");
  });
});
