import { describe, expect, it } from "vitest";
import { JsonFileError } from "../json-file.js";
import { assertDaemonState } from "./daemon-state.js";

const validState = {
  startedAt: "2026-01-01T00:00:00.000Z",
  completedRuns: 0,
  pid: 12345,
};

describe("assertDaemonState", () => {
  it("accepts a minimal valid state", () => {
    expect(() => assertDaemonState("/path", validState)).not.toThrow();
  });

  it("accepts a fully populated state", () => {
    const full = {
      ...validState,
      lastCompletedWorkflow: "builder",
      lastCompletedAt: "2026-01-01T01:00:00.000Z",
      lastCompletedStatus: "success",
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

  it("throws when completedRuns is missing", () => {
    const { completedRuns: _c, ...bad } = validState;
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when completedRuns is negative", () => {
    const bad = { ...validState, completedRuns: -1 };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when completedRuns is not an integer", () => {
    const bad = { ...validState, completedRuns: 1.5 };
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

  it("throws when lastCompletedWorkflow is present but empty", () => {
    const bad = { ...validState, lastCompletedWorkflow: "" };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when lastCompletedAt is present but whitespace-only", () => {
    const bad = { ...validState, lastCompletedAt: "  " };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("throws when lastCompletedStatus is an unknown value", () => {
    const bad = { ...validState, lastCompletedStatus: "pending" };
    expect(() => assertDaemonState("/p", bad)).toThrow(JsonFileError);
  });

  it("accepts all valid lastCompletedStatus values", () => {
    for (const status of [
      "success",
      "failed",
      "interrupted",
      "completed-with-warnings",
    ] as const) {
      const s = { ...validState, lastCompletedStatus: status };
      expect(() => assertDaemonState("/p", s)).not.toThrow();
    }
  });

  it("throws contain the path in error message", () => {
    expect(() => assertDaemonState("/state.json", null)).toThrow("/state.json");
  });
});
