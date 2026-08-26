import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileError } from "#core/util/json-file.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-state-shape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota", "runs"), { recursive: true });
  return dir;
}

const BUILDER: WorkflowDefinition = {
  name: "builder",
  definitionPath: "src/modules/test/workflows/builder/workflow.ts",
  moduleRoot: "/test-module-root",
  description: "test",
  enabled: true,
  repository: "none",
  tags: [],
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
};

describe("workflow state shape: start / completion separation", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("start records lastStarted only; completion records lastCompletion", () => {
    const handle = store.createRun(BUILDER, { event: "runtime.idle", schemaRef: null, payload: {} });

    const afterStart = store.readState();
    const startedEntry = afterStart.workflows.builder;
    expect(startedEntry?.lastStarted?.runId).toBe(handle.metadata.id);
    expect(startedEntry?.lastStarted?.startedAt).toBe(handle.metadata.startedAt);
    expect(startedEntry?.lastCompletion).toBeUndefined();
    expect("activeRuns" in afterStart).toBe(false);
    expect("pendingRuns" in afterStart).toBe(false);

    handle.finish({ status: "success", durationMs: 500 });

    const afterFinish = store.readState();
    const finishedEntry = afterFinish.workflows.builder;
    expect(finishedEntry?.lastStarted?.runId).toBe(handle.metadata.id);
    expect(finishedEntry?.lastCompletion?.runId).toBe(handle.metadata.id);
    expect(finishedEntry?.lastCompletion?.status).toBe("success");
    expect(finishedEntry?.lastCompletion?.startedAt).toBe(handle.metadata.startedAt);
    expect(finishedEntry?.lastCompletion?.completedAt).toBeDefined();
    const persisted = JSON.parse(
      readFileSync(join(projectDir, ".kota", "workflow-state.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("activeRuns");
    expect(persisted).not.toHaveProperty("pendingRuns");
  });

  it("rejects legacy flat workflow fields", () => {
    const statePath = join(projectDir, ".kota", "workflow-state.json");

    // Simulate the bug's exact symptom: an active run's lastRunId carries
    // running-run identity while lastCompletedAt/lastStatus belong to an
    // older completed run.
    const legacy = {
      completedRuns: 10,
      workflows: {
        "active-wf": {
          lastRunId: "run-running",
          lastStartedAt: "2026-04-22T03:40:00.000Z",
          lastCompletedAt: "2026-04-22T03:20:00.000Z",
          lastStatus: "success",
        },
        "idle-wf": {
          lastRunId: "run-done",
          lastStartedAt: "2026-04-22T03:00:00.000Z",
          lastCompletedAt: "2026-04-22T03:05:00.000Z",
          lastStatus: "failed",
        },
      },
    };
    writeFileSync(statePath, JSON.stringify(legacy), "utf-8");

    expect(() => store.readState()).toThrow(JsonFileError);
    expect(() => store.readState()).toThrow(/uses legacy fields/);
  });
});
