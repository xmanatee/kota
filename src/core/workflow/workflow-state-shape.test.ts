import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  recoveryCapable: false,
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
    const handle = store.createRun(BUILDER, { event: "runtime.idle", payload: {} });

    const afterStart = store.readState();
    const startedEntry = afterStart.workflows.builder;
    expect(startedEntry?.lastStarted?.runId).toBe(handle.metadata.id);
    expect(startedEntry?.lastStarted?.startedAt).toBe(handle.metadata.startedAt);
    expect(startedEntry?.lastCompletion).toBeUndefined();
    expect(afterStart.activeRuns?.some((r) => r.runId === handle.metadata.id)).toBe(true);

    handle.finish({ status: "success", durationMs: 500 });

    const afterFinish = store.readState();
    const finishedEntry = afterFinish.workflows.builder;
    expect(finishedEntry?.lastStarted?.runId).toBe(handle.metadata.id);
    expect(finishedEntry?.lastCompletion?.runId).toBe(handle.metadata.id);
    expect(finishedEntry?.lastCompletion?.status).toBe("success");
    expect(finishedEntry?.lastCompletion?.startedAt).toBe(handle.metadata.startedAt);
    expect(finishedEntry?.lastCompletion?.completedAt).toBeDefined();
    expect(afterFinish.activeRuns ?? []).toEqual([]);
  });

  it("interruption records lastCompletion without conflating a newer run", () => {
    const firstHandle = store.createRun(BUILDER, { event: "runtime.idle", payload: {} });
    firstHandle.finish({ status: "success", durationMs: 500 });

    const secondHandle = store.createRun(BUILDER, { event: "runtime.idle", payload: {} });

    const midRunState = store.readState();
    // lastStarted points at the new run; lastCompletion is still the first run.
    expect(midRunState.workflows.builder?.lastStarted?.runId).toBe(secondHandle.metadata.id);
    expect(midRunState.workflows.builder?.lastCompletion?.runId).toBe(firstHandle.metadata.id);
    expect(midRunState.workflows.builder?.lastCompletion?.status).toBe("success");

    store.recoverInterruptedRuns();

    const afterRecovery = store.readState();
    const recoveredEntry = afterRecovery.workflows.builder;
    // lastStarted still describes the second run; lastCompletion now describes
    // its interruption, not the earlier success.
    expect(recoveredEntry?.lastStarted?.runId).toBe(secondHandle.metadata.id);
    expect(recoveredEntry?.lastCompletion?.runId).toBe(secondHandle.metadata.id);
    expect(recoveredEntry?.lastCompletion?.status).toBe("interrupted");
    expect(afterRecovery.activeRuns ?? []).toEqual([]);
  });

  it("migrates legacy flat fields: active run keeps lastStarted only, completed run keeps both", () => {
    const statePath = join(projectDir, ".kota", "workflow-state.json");

    // Simulate the bug's exact symptom: an active run's lastRunId carries
    // running-run identity while lastCompletedAt/lastStatus belong to an
    // older completed run.
    const legacy = {
      completedRuns: 10,
      pendingRuns: [],
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
      activeRuns: [
        {
          runId: "run-running",
          workflow: "active-wf",
          startedAt: "2026-04-22T03:40:00.000Z",
        },
      ],
    };
    writeFileSync(statePath, JSON.stringify(legacy), "utf-8");

    const migrated = store.readState();

    const activeEntry = migrated.workflows["active-wf"];
    expect(activeEntry?.lastStarted).toEqual({
      runId: "run-running",
      startedAt: "2026-04-22T03:40:00.000Z",
    });
    // The stale completion fields belonged to a different run and are dropped.
    expect(activeEntry?.lastCompletion).toBeUndefined();

    const idleEntry = migrated.workflows["idle-wf"];
    expect(idleEntry?.lastStarted).toEqual({
      runId: "run-done",
      startedAt: "2026-04-22T03:00:00.000Z",
    });
    expect(idleEntry?.lastCompletion).toEqual({
      runId: "run-done",
      startedAt: "2026-04-22T03:00:00.000Z",
      completedAt: "2026-04-22T03:05:00.000Z",
      status: "failed",
    });
  });
});
