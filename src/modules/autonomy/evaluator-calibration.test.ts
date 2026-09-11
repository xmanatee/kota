import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
import { getRepoTaskPath, isActiveRepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import { getCriticPromptHash } from "./critic.js";
import {
  aggregateCalibration,
  decodeEvaluatorCalibrationDispositionsArtifact,
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  type EvaluatorCalibrationDispositionRecord,
  evaluateCalibrationGate,
  writeCalibrationArtifact,
} from "./evaluator-calibration.js";

const NOW = Date.parse("2026-04-20T12:00:00.000Z");
const HOUR = 3_600_000;
const PROMPT = "captured-prompt";
const REVISION = "a".repeat(40);
const iso = (offset = 0) => new Date(NOW + offset).toISOString();
let root: string;
let runsDir: string;
let runDir: string;
let criticDir: string;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

function writeCritic(value: unknown, directory = criticDir): void {
  writeJson(join(directory, "critic-review.json"), value);
}

const pass = {
  verdict: "pass", critical_issues: [], warnings: [], summary: "Reviewed",
  reviewerPromptHash: PROMPT,
};

function context(failures: string[][] = []): Parameters<typeof writeCalibrationArtifact>[0] {
  const taskDigest = "0".repeat(64);
  return {
    workspaceRoot: root, scopeRoot: root,
    workflow: {
      name: "builder", definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: "run-test", runDir: "run-test", runDirPath: runDir,
    },
    trigger: {
      event: "autonomy.queue.available", schemaRef: null,
      payload: {
        taskId: "task-1", taskPath: "data/tasks/task-1.md", taskState: "open",
        taskDigest, idempotencyKey: `builder:task-1:${taskDigest}`, title: "Calibration task", priority: "p2", dependsOn: [],
      },
    },
    stepOutputs: { build: { repairIterations: failures.map((ids, index) => ({
      attempt: index + 1, failures: ids.map((id) => ({ id })),
    })) } },
    stepResults: { build: {
      id: "build", type: "agent", status: "success", startedAt: iso(-HOUR),
      completedAt: iso(), durationMs: HOUR, usage: UNKNOWN_AGENT_USAGE,
    } },
  };
}

function seed(runId: string, changes: Partial<EvaluatorCalibrationArtifact> = {}): void {
  const directory = join(runsDir, runId);
  mkdirSync(directory, { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId, workflow: "builder", completedAt: iso(-HOUR), verdict: "pass",
    warningCount: 0, criticalIssueCount: 0, repairIterations: 1,
    finalIterationFailures: [], criticFailureCount: 0, terminalRunStatus: "success",
    taskId: null, taskFinalState: null, sourceRevision: REVISION,
    sourceFilesChanged: ["src/shared.ts"], criticPromptHash: PROMPT, ...changes,
  };
  writeJson(join(directory, EVALUATOR_CALIBRATION_ARTIFACT), artifact);
  writeJson(join(directory, "metadata.json"), {
    metadataVersion: 1, id: runId, workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    startedAt: artifact.completedAt, completedAt: artifact.completedAt,
    status: artifact.terminalRunStatus, runDir: `.kota/runs/${runId}`, steps: [],
  });
}

function aggregate(options: Partial<Parameters<typeof aggregateCalibration>[1]> = {}) {
  return aggregateCalibration(runsDir, { criticPromptHash: PROMPT, nowMs: NOW, ...options });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  root = mkdtempSync(join(tmpdir(), "kota-calibration-"));
  runsDir = join(root, "runs");
  runDir = join(runsDir, "run-test");
  criticDir = join(root, "critic");
  for (const dir of [runDir, criticDir, join(root, "data/tasks/archive")]) {
    mkdirSync(dir, { recursive: true });
  }
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe("calibration artifact", () => {
  it.each([
    { name: "successful repair", failures: [["critic-review"], []], final: [], catches: 1 },
    { name: "repeated critic catches", failures: [["test"], ["critic-review"], ["critic-review", "lint"]], final: ["lint"], catches: 2 },
    { name: "final critic repair", failures: [["test"], ["critic-review"]], final: [], catches: 1 },
    { name: "mechanical repair", failures: [["typecheck", "lint"]], final: ["typecheck", "lint"], catches: 0 },
  ])("persists $name without treating repaired catches as final failures", ({ failures, final, catches }) => {
    writeCritic({ ...pass, verdict: "pass_with_warnings", warnings: ["Follow-up"] });
    const artifact = writeCalibrationArtifact(context(failures), { criticVerdictRunDir: criticDir });
    expect(artifact).toMatchObject({
      verdict: "pass_with_warnings", warningCount: 1, criticalIssueCount: 0,
      repairIterations: failures.length, finalIterationFailures: final, criticFailureCount: catches,
      taskId: "task-1", taskFinalState: null, sourceRevision: null, sourceFilesChanged: [],
      terminalRunStatus: "success", criticPromptHash: PROMPT, completedAt: iso(),
    });
    expect(JSON.parse(readFileSync(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT), "utf8"))).toEqual(artifact);
  });

  it("uses explicit critic provenance and never falls back to stale run-root verdicts", () => {
    writeCritic({ ...pass, verdict: "fail", critical_issues: ["Stale"] }, runDir);
    writeCritic(pass);
    expect(writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir })).toMatchObject({
      verdict: "pass", criticPromptHash: PROMPT,
    });
    rmSync(join(criticDir, "critic-review.json"));
    expect(writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir })).toMatchObject({
      verdict: "absent", criticPromptHash: getCriticPromptHash(root),
    });
  });

  it.each([null, false, 0, "", { ...pass, verdict: "maybe" }, { ...pass, critical_issues: ["Required behavior missing"] }])(
    "rejects malformed current critic evidence %j despite a stale valid verdict",
    (payload) => {
      writeCritic(pass, runDir);
      writeCritic(payload);
      expect(() => writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir }))
        .toThrow(/Invalid critic verdict|accepted verdict cannot/);
    },
  );

  it.each(["open", "blocked", "done", "dropped"] as const)(
    "reads %s task state through the canonical task owner",
    (state) => {
      writeCritic(pass);
      writeFileSync(getRepoTaskPath(root, state, "task-1"),
        `---\nstatus: ${state}\n${isActiveRepoTaskState(state) ? "priority: p2\n" : ""}---\n# Calibration task\n`);
      expect(writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir }).taskFinalState).toBe(state);
    },
  );

  it("rejects invalid canonical task metadata rather than inferring state from a directory", () => {
    writeCritic(pass);
    writeFileSync(join(root, "data/tasks/task-1.md"), "---\nstatus: invalid\n---\n# Invalid task\n");
    expect(() => writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir })).toThrow(/invalid status/);
  });

  it("joins published revision and source paths while excluding task, instruction and runtime bookkeeping", () => {
    seed("run-test", { sourceFilesChanged: [] });
    writeCritic({ ...pass, verdict: "pass_with_warnings", warnings: ["Tracked follow-up"] });
    expect(writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir })).toMatchObject({
      verdict: "pass_with_warnings", warningCount: 1,
    });
    writeWriterIntegrationFixture(runsDir, {
      runId: "run-test", workflow: "builder", publishedHead: REVISION,
      changedPaths: ["src/shared.ts", "data/tasks/archive/task-1.md", "src/AGENTS.md", ".kota/runtime.json"],
      completedAt: iso(-HOUR),
    });
    seed("later-bookkeeping", { verdict: "fail", completedAt: iso(),
      sourceFilesChanged: ["data/tasks/archive/task-1.md", "src/AGENTS.md", ".kota/runtime.json"] });
    expect(aggregate()).toMatchObject({
      totalRuns: 2, byVerdict: { pass: 0, pass_with_warnings: 1, fail: 1, absent: 0 },
      passWithWarningsFollowUpCount: 0,
    });
    seed("later-source", { verdict: "fail", completedAt: iso() });
    expect(aggregate().passWithWarningsFollowUpCount).toBe(1);
    writeCritic(pass);
    writeCalibrationArtifact(context(), { criticVerdictRunDir: criticDir });
    expect(aggregate().passContradictions).toEqual([expect.objectContaining({
      base: { runId: "run-test", taskId: "task-1", sourceRevision: REVISION },
      later: expect.objectContaining({ runId: "later-source" }),
      overlappingSourcePaths: ["src/shared.ts"],
    })]);
  });
});

describe("calibration aggregation", () => {
  it.each([
    { name: "failed verdict", later: { verdict: "fail" }, contradiction: 1 },
    { name: "terminal failure despite pass", later: { terminalRunStatus: "failed" }, contradiction: 1 },
    { name: "healthy overlapping run", later: {}, contradiction: 0 },
    { name: "critic repair", later: { criticFailureCount: 2 }, contradiction: 0 },
    { name: "mechanical repair", later: { finalIterationFailures: ["test", "lint"] }, contradiction: 0 },
    { name: "unrelated failed files", later: { verdict: "fail", sourceFilesChanged: ["src/other.ts"] }, contradiction: 0 },
    { name: "simultaneous failure", later: { verdict: "fail", completedAt: iso(-HOUR) }, contradiction: 0 },
    { name: "failure outside follow-up window", later: { verdict: "fail" }, followUpWindowMs: HOUR - 1, contradiction: 0 },
  ] satisfies Array<{ name: string; later: Partial<EvaluatorCalibrationArtifact>; contradiction: number; followUpWindowMs?: number }>)(
    "$name produces $contradiction pass contradictions", ({ later, contradiction, ...row }) => {
      seed("base");
      seed("later", { completedAt: iso(), ...later });
      const result = aggregate({ followUpWindowMs: "followUpWindowMs" in row ? row.followUpWindowMs : HOUR });
      expect(result.totalRuns).toBe(2);
      expect(result.passContradictionCount).toBe(contradiction);
      expect(result.passContradictionRate).toBe(contradiction / result.byVerdict.pass);
    },
  );

  it.each([
    { name: "hedging", verdict: "pass_with_warnings", catches: 0, expected: 1 },
    { name: "failure", verdict: "fail", catches: 0, expected: 1 },
    { name: "clean pass", verdict: "pass", catches: 0, expected: 0 },
    { name: "repaired pass", verdict: "pass", catches: 2, expected: 0 },
  ] as const)("counts $name after a warning verdict", ({ verdict, catches, expected }) => {
    seed("base", { verdict: "pass_with_warnings" });
    seed("later", { completedAt: iso(), verdict, criticFailureCount: catches });
    const result = aggregate();
    expect(result.passWithWarningsFollowUpCount).toBe(expected);
    expect(result.passWithWarningsFollowUpRate).toBe(expected / result.byVerdict.pass_with_warnings);
    expect(result.passContradictionCount).toBe(0);
  });

  it("resets the gate on prompt change and excludes unversioned, expired and future evidence", () => {
    seed("base", { criticPromptHash: "old" });
    seed("later", { criticPromptHash: "old", completedAt: iso(), verdict: "fail" });
    const config = { thresholdRate: 0.25, minSample: 1, passWithWarningsThresholdRate: 0.4, passWithWarningsMinSample: 1 };
    expect(evaluateCalibrationGate(aggregate({ criticPromptHash: "old" }), config).status).toBe("gated");
    seed("unversioned");
    const path = join(runsDir, "unversioned", EVALUATOR_CALIBRATION_ARTIFACT);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    delete raw.criticPromptHash;
    writeJson(path, raw);
    seed("expired", { completedAt: iso(-8 * 24 * HOUR) });
    seed("future", { completedAt: iso(HOUR) });
    expect(aggregate().totalRuns).toBe(0);
    expect(evaluateCalibrationGate(aggregate(), config).status).toBe("insufficient-sample");
    seed("current");
    expect(aggregate()).toMatchObject({ totalRuns: 1, byVerdict: { pass: 1, fail: 0 } });
  });

  it("returns an empty sample for a missing run store", () => {
    expect(aggregateCalibration(join(root, "missing"), { criticPromptHash: PROMPT, nowMs: NOW }))
      .toMatchObject({ totalRuns: 0, passContradictionRate: 0, passWithWarningsFollowUpRate: 0 });
  });

  it.each([true, false])("binds disposition to the exact overlapping revision pair: %s", (matching) => {
    const laterRevision = "b".repeat(40);
    seed("base", { taskId: "task-base" });
    seed("unrelated", { completedAt: iso(-HOUR / 2), verdict: "fail", sourceFilesChanged: ["src/other.ts"] });
    seed("later", { taskId: "task-later", completedAt: iso(), verdict: "fail",
      terminalRunStatus: "failed", sourceRevision: laterRevision });
    const record: EvaluatorCalibrationDispositionRecord = {
      base: { runId: "base", sourceRevision: REVISION },
      later: { runId: "later", sourceRevision: matching ? laterRevision : "c".repeat(40) },
      disposition: { kind: "corrective-task", taskId: "task-correction", rationale: "Missed shared-path defect", decidedAt: iso() },
    };
    const evidenceDir = join(runDir, "evidence/artifacts");
    mkdirSync(evidenceDir, { recursive: true });
    writeJson(join(evidenceDir, EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT), {
      schemaVersion: 1, records: [record], unavailableSources: [],
    });
    expect(aggregate().passContradictions).toEqual([{
      base: { ...record.base, taskId: "task-base" },
      later: { runId: "later", sourceRevision: laterRevision, taskId: "task-later" },
      laterFailure: { verdict: "fail", terminalRunStatus: "failed" },
      overlappingSourcePaths: ["src/shared.ts"], disposition: matching ? record.disposition : null,
    }]);
  });

  it("retains unavailable provenance without manufacturing run identities", () => {
    const source = { sourceRef: "git:revision:task.md", expectedContradictionCount: 3,
      reason: "Run store unavailable to this reader", checkedAt: iso() };
    expect(decodeEvaluatorCalibrationDispositionsArtifact({
      schemaVersion: 1, records: [], unavailableSources: [source],
    })).toEqual({ schemaVersion: 1, records: [], unavailableSources: [source] });
  });
});

describe("calibration gate", () => {
  it.each([
    { name: "insufficient samples", passes: 3, warnings: 1, contradictions: 3, escalations: 1, status: "insufficient-sample", kinds: [] },
    { name: "exact thresholds", passes: 4, warnings: 5, contradictions: 1, escalations: 2, status: "under-threshold", kinds: [] },
    { name: "pass drift", passes: 4, warnings: 0, contradictions: 2, escalations: 0, status: "gated", kinds: ["pass-contradiction"] },
    { name: "warning escalation", passes: 0, warnings: 5, contradictions: 0, escalations: 3, status: "gated", kinds: ["pass-with-warnings-escalation"] },
    { name: "both signals", passes: 4, warnings: 5, contradictions: 2, escalations: 3, status: "gated", kinds: ["pass-contradiction", "pass-with-warnings-escalation"] },
    { name: "small warning sample", passes: 4, warnings: 2, contradictions: 2, escalations: 2, status: "gated", kinds: ["pass-contradiction"] },
    { name: "small pass sample", passes: 2, warnings: 5, contradictions: 2, escalations: 3, status: "gated", kinds: ["pass-with-warnings-escalation"] },
  ])("evaluates $name from observed run outcomes", ({ passes, warnings, contradictions, escalations, status, kinds }) => {
    for (let i = 0; i < passes; i++) seed(`pass-${i}`, { sourceFilesChanged: [`src/pass-${i}.ts`] });
    for (let i = 0; i < warnings; i++) seed(`warning-${i}`, { verdict: "pass_with_warnings", sourceFilesChanged: [`src/warning-${i}.ts`] });
    seed("failure", { completedAt: iso(), verdict: "fail", sourceFilesChanged: [
      ...Array.from({ length: contradictions }, (_, i) => `src/pass-${i}.ts`),
      ...Array.from({ length: escalations }, (_, i) => `src/warning-${i}.ts`),
    ] });
    const decision = evaluateCalibrationGate(aggregate(), {
      thresholdRate: 0.25, minSample: 4, passWithWarningsThresholdRate: 0.4, passWithWarningsMinSample: 5,
    });
    expect(decision.status).toBe(status);
    if (decision.status === "gated") {
      expect(decision.kinds).toEqual(kinds);
      expect(decision.reason).toContain(kinds.includes("pass-contradiction") ? "50.0%" : "60.0%");
      expect(decision.reason).toContain(kinds.includes("pass-contradiction") ? "25.0%" : "40.0%");
    }
  });
});
