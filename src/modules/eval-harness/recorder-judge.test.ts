import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAgentStepRecording } from "./agent-step-recording.js";
import { extractJudgeCallRecording } from "./recorder.js";

describe("extractJudgeCallRecording", () => {
  let workspaceRoot: string;
  let fixtureDir: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-judge-recorder-project-"));
    fixtureDir = mkdtempSync(join(tmpdir(), "kota-judge-recorder-fixture-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function seedJudgeArtifact(
    runId: string,
    workflowName: string,
    label: string,
    verdict: Record<string, unknown>,
  ): void {
    const runDir = join(workspaceRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, workflow: workflowName }),
    );
    writeFileSync(
      join(runDir, `${label}.json`),
      JSON.stringify(verdict, null, 2),
    );
  }

  it("wraps a critic-review artifact as a judge recording that round-trips through the loader", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-judge";
    const verdict = {
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "All Done When criteria addressed.",
    };
    seedJudgeArtifact(runId, "builder", "critic-review", verdict);

    const result = extractJudgeCallRecording({
      workspaceRoot,
      sourceRunId: runId,
      label: "critic-review",
      fixtureDir,
    });

    expect(result.recording.version).toBe(1);
    expect(result.recording.workflowName).toBe("builder");
    expect(result.recording.stepId).toBe("critic-review");
    expect(result.recording.sourceRunId).toBe(runId);
    expect(result.recording.fileOperations).toEqual([]);
    expect(result.recording.response.subtype).toBe("success");
    expect(result.recording.response.turns).toBe(1);
    expect(result.recording.response.totalCostUsd).toBe(0);
    expect(result.recording.response.inputTokens).toBe(0);
    expect(result.recording.response.outputTokens).toBe(0);
    expect(JSON.parse(result.recording.response.text)).toEqual(verdict);

    const reloaded = parseAgentStepRecording(
      readFileSync(result.recordingPath, "utf-8"),
      result.recordingPath,
    );
    expect(reloaded.stepId).toBe("critic-review");
    expect(JSON.parse(reloaded.response.text)).toEqual(verdict);
  });

  it("accepts a non-critic judge label (improver semantic gate) without hardcoding", () => {
    const runId = "2026-04-24T00-00-00-000Z-improver-gate";
    const verdict = {
      verdict: "fail",
      critical_issues: ["artifact-only diff"],
      warnings: [],
      summary: "Diff only touches scratch files.",
    };
    seedJudgeArtifact(runId, "improver", "semantic-gate-review", verdict);

    const result = extractJudgeCallRecording({
      workspaceRoot,
      sourceRunId: runId,
      label: "semantic-gate-review",
      fixtureDir,
    });

    expect(result.recording.stepId).toBe("semantic-gate-review");
    expect(result.recording.workflowName).toBe("improver");
    expect(result.recordingPath).toBe(
      join(fixtureDir, "recordings", "semantic-gate-review.json"),
    );
    expect(JSON.parse(result.recording.response.text)).toEqual(verdict);
  });

  it("rejects a source run missing the labeled judge artifact, naming run id and label", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-nojudge";
    const runDir = join(workspaceRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, workflow: "builder" }),
    );

    let err: unknown;
    try {
      extractJudgeCallRecording({
        workspaceRoot,
        sourceRunId: runId,
        label: "critic-review",
        fixtureDir,
      });
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain(runId);
    expect(message).toContain("critic-review");
  });

  it("rejects traversal-shaped source run and judge labels before deriving paths", () => {
    expect(() =>
      extractJudgeCallRecording({
        workspaceRoot,
        sourceRunId: "../outside-run",
        label: "critic-review",
        fixtureDir,
      }),
    ).toThrow(/--run-id must be a safe single path component/);

    expect(() =>
      extractJudgeCallRecording({
        workspaceRoot,
        sourceRunId: "2026-04-24T00-00-00-000Z-builder-safe",
        label: "../critic-review",
        fixtureDir,
      }),
    ).toThrow(/--judge must be a safe single path component/);
  });

  it("rejects an unparseable judge artifact", () => {
    const runId = "2026-04-24T00-00-00-000Z-builder-badjson";
    const runDir = join(workspaceRoot, ".kota", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({ id: runId, workflow: "builder" }),
    );
    writeFileSync(join(runDir, "critic-review.json"), "{not json");

    expect(() =>
      extractJudgeCallRecording({
        workspaceRoot,
        sourceRunId: runId,
        label: "critic-review",
        fixtureDir,
      }),
    ).toThrow(/not valid JSON/);
  });
});
