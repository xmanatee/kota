import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentStepRecordingError,
  loadAgentStepRecordings,
  parseAgentStepRecording,
  recordingPathForStep,
} from "./agent-step-recording.js";

const VALID = {
  version: 1,
  workflowName: "decomposer",
  stepId: "decompose",
  sourceRunId: "2026-04-18T15-45-49-339Z-decomposer-zloyo6",
  response: {
    text: "ok",
    subtype: "success",
    turns: 3,
    totalCostUsd: 0.125,
    inputTokens: 10,
    outputTokens: 20,
  },
  fileOperations: [
    { op: "write", path: "data/tasks/ready/task-a.md", content: "a" },
    { op: "delete", path: "data/tasks/doing/task-b.md" },
  ],
};

describe("parseAgentStepRecording", () => {
  it("parses a fully-specified recording", () => {
    const recording = parseAgentStepRecording(JSON.stringify(VALID), "/x.json");
    expect(recording.workflowName).toBe("decomposer");
    expect(recording.response.turns).toBe(3);
    expect(recording.fileOperations).toHaveLength(2);
  });

  it("preserves an optional sessionId", () => {
    const raw = { ...VALID, response: { ...VALID.response, sessionId: "s-1" } };
    const recording = parseAgentStepRecording(JSON.stringify(raw), "/x.json");
    expect(recording.response.sessionId).toBe("s-1");
  });

  it("rejects unsupported version", () => {
    const raw = { ...VALID, version: 2 };
    expect(() => parseAgentStepRecording(JSON.stringify(raw), "/x.json")).toThrow(
      AgentStepRecordingError,
    );
  });

  it("rejects a missing response", () => {
    const raw = { ...VALID, response: undefined };
    expect(() => parseAgentStepRecording(JSON.stringify(raw), "/x.json")).toThrow(
      /response/,
    );
  });

  it("rejects a non-numeric cost", () => {
    const raw = { ...VALID, response: { ...VALID.response, totalCostUsd: "nope" } };
    expect(() => parseAgentStepRecording(JSON.stringify(raw), "/x.json")).toThrow(
      /totalCostUsd/,
    );
  });

  it("rejects a write operation with missing content", () => {
    const raw = {
      ...VALID,
      fileOperations: [{ op: "write", path: "a.md" }],
    };
    expect(() => parseAgentStepRecording(JSON.stringify(raw), "/x.json")).toThrow(
      /content/,
    );
  });

  it("rejects an unknown op kind", () => {
    const raw = {
      ...VALID,
      fileOperations: [{ op: "rename", path: "a.md" }],
    };
    expect(() => parseAgentStepRecording(JSON.stringify(raw), "/x.json")).toThrow(
      /unknown op/,
    );
  });

  it("rejects unparseable JSON", () => {
    expect(() => parseAgentStepRecording("{not json", "/x.json")).toThrow(
      /unparseable JSON/,
    );
  });
});

describe("loadAgentStepRecordings", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-recording-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty when no recordings/ directory exists", () => {
    expect(loadAgentStepRecordings(dir)).toEqual([]);
  });

  it("returns every valid recording in the directory", () => {
    mkdirSync(join(dir, "recordings"), { recursive: true });
    writeFileSync(
      recordingPathForStep(dir, "decompose"),
      JSON.stringify(VALID),
    );
    const recordings = loadAgentStepRecordings(dir);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].stepId).toBe("decompose");
  });

  it("fails loudly when a recording's stepId does not match its filename", () => {
    mkdirSync(join(dir, "recordings"), { recursive: true });
    const raw = { ...VALID, stepId: "decompose" };
    writeFileSync(
      join(dir, "recordings", "something-else.json"),
      JSON.stringify(raw),
    );
    expect(() => loadAgentStepRecordings(dir)).toThrow(
      /does not match filename/,
    );
  });
});
