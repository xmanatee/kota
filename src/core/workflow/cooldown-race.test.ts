import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { createActiveRunHandle } from "./active-run-handle.js";
import { ensureDir, writeJsonFile } from "./run-io.js";
import type { WorkflowRunMetadata, WorkflowRuntimeState } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";
import { WorkflowQueueManager } from "./workflow-queue.js";

function readState(statePath: string): WorkflowRuntimeState {
  const state = readOptionalJsonFile<WorkflowRuntimeState>(statePath);
  return {
    completedRuns: state?.completedRuns ?? 0,
    pendingRuns: state?.pendingRuns ?? [],
    workflows: state?.workflows ?? {},
    ...(state?.activeRuns !== undefined ? { activeRuns: state.activeRuns } : {}),
    ...(state?.totalCostUsd != null ? { totalCostUsd: state.totalCostUsd } : {}),
  };
}

function writeState(statePath: string, state: WorkflowRuntimeState): void {
  writeJsonFile(statePath, state);
}

describe("cooldown race condition", () => {
  let tmpDir: string;
  let kotaDir: string;
  let runsDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `kota-cooldown-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    kotaDir = join(tmpDir, ".kota");
    runsDir = join(kotaDir, "runs");
    statePath = join(kotaDir, "workflow-state.json");
    ensureDir(kotaDir);
    ensureDir(runsDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("finish() concurrent completion", () => {
    it("preserves lastCompletedAt from a more recent concurrent completion", () => {
      // Seed initial state with two active runs
      const initialState: WorkflowRuntimeState = {
        completedRuns: 10,
        pendingRuns: [],
        workflows: {
          alpha: {
            lastCompletion: {
              runId: "prior-alpha",
              startedAt: "2026-04-11T09:30:00.000Z",
              completedAt: "2026-04-11T10:00:00.000Z",
              status: "success",
            },
          },
          beta: {
            lastCompletion: {
              runId: "prior-beta",
              startedAt: "2026-04-11T09:30:00.000Z",
              completedAt: "2026-04-11T10:00:00.000Z",
              status: "success",
            },
          },
        },
        activeRuns: [
          { runId: "run-alpha-1", workflow: "alpha", startedAt: "2026-04-11T11:00:00.000Z" },
          { runId: "run-beta-1", workflow: "beta", startedAt: "2026-04-11T11:00:00.000Z" },
        ],
      };
      writeState(statePath, initialState);

      // Create run handles for both workflows
      const runDirAlpha = join(runsDir, "run-alpha-1");
      const runDirBeta = join(runsDir, "run-beta-1");
      ensureDir(runDirAlpha);
      ensureDir(join(runDirAlpha, "steps"));
      ensureDir(runDirBeta);
      ensureDir(join(runDirBeta, "steps"));

      const metaAlpha: WorkflowRunMetadata = {
        id: "run-alpha-1",
        workflow: "alpha",
        definitionPath: "test/alpha.ts",
        trigger: { event: "test", schemaRef: null, payload: {} },
        startedAt: "2026-04-11T11:00:00.000Z",
        status: "running",
        runDir: ".kota/runs/run-alpha-1",
        steps: [],
      };
      const metaBeta: WorkflowRunMetadata = {
        id: "run-beta-1",
        workflow: "beta",
        definitionPath: "test/beta.ts",
        trigger: { event: "test", schemaRef: null, payload: {} },
        startedAt: "2026-04-11T11:00:00.000Z",
        status: "running",
        runDir: ".kota/runs/run-beta-1",
        steps: [],
      };

      const handleAlpha = createActiveRunHandle({
        id: "run-alpha-1",
        runDirPath: runDirAlpha,
        metadata: metaAlpha,
        workflowName: "alpha",
        readState: () => readState(statePath),
        writeState: (s) => writeState(statePath, s),
      });

      const handleBeta = createActiveRunHandle({
        id: "run-beta-1",
        runDirPath: runDirBeta,
        metadata: metaBeta,
        workflowName: "beta",
        readState: () => readState(statePath),
        writeState: (s) => writeState(statePath, s),
      });

      // Beta finishes first with a recent timestamp
      handleBeta.finish({
        status: "success",
        durationMs: 1000,
      });

      const stateAfterBeta = readState(statePath);
      const betaCompletedAt = stateAfterBeta.workflows.beta?.lastCompletion?.completedAt;
      expect(betaCompletedAt).toBeDefined();

      // Alpha finishes second — this used to overwrite beta's lastCompletedAt
      // because it read state before beta wrote, then wrote back the stale value.
      // With the fix, alpha re-reads state before writing and preserves beta's update.
      handleAlpha.finish({
        status: "success",
        durationMs: 2000,
      });

      const finalState = readState(statePath);

      // Both workflows should have their own completion set
      expect(finalState.workflows.alpha?.lastCompletion?.completedAt).toBeDefined();
      expect(finalState.workflows.beta?.lastCompletion?.completedAt).toBe(betaCompletedAt);
      expect(finalState.completedRuns).toBe(12); // 10 + 2
      expect(finalState.activeRuns).toEqual([]);
    });

    it("only advances lastCompletion forward, never backward", () => {
      // Seed state where alpha already has a very recent completion
      const recentCompletion = new Date(Date.now() + 60_000).toISOString(); // future to guarantee it's "more recent"
      const initialState: WorkflowRuntimeState = {
        completedRuns: 5,
        pendingRuns: [],
        workflows: {
          alpha: {
            lastCompletion: {
              runId: "run-alpha-newer",
              startedAt: "2026-04-11T11:00:00.000Z",
              completedAt: recentCompletion,
              status: "success",
            },
          },
        },
        activeRuns: [
          { runId: "run-alpha-old", workflow: "alpha", startedAt: "2026-04-11T09:00:00.000Z" },
        ],
      };
      writeState(statePath, initialState);

      const runDir = join(runsDir, "run-alpha-old");
      ensureDir(runDir);
      ensureDir(join(runDir, "steps"));

      const meta: WorkflowRunMetadata = {
        id: "run-alpha-old",
        workflow: "alpha",
        definitionPath: "test/alpha.ts",
        trigger: { event: "test", schemaRef: null, payload: {} },
        startedAt: "2026-04-11T09:00:00.000Z",
        status: "running",
        runDir: ".kota/runs/run-alpha-old",
        steps: [],
      };

      const handle = createActiveRunHandle({
        id: "run-alpha-old",
        runDirPath: runDir,
        metadata: meta,
        workflowName: "alpha",
        readState: () => readState(statePath),
        writeState: (s) => writeState(statePath, s),
      });

      // This older run finishes — its completedAt will be earlier than recentCompletion
      handle.finish({ status: "success", durationMs: 500 });

      const finalState = readState(statePath);
      // lastCompletion should NOT have been overwritten with the older timestamp
      expect(finalState.workflows.alpha?.lastCompletion?.completedAt).toBe(recentCompletion);
      // But completedRuns should still be incremented
      expect(finalState.completedRuns).toBe(6);
      // Active run should still be removed
      expect(finalState.activeRuns).toEqual([]);
    });
  });

  describe("pick() cooldown re-validation", () => {
    it("rejects a queued run whose enqueue-time notBeforeMs is stale", () => {
      // State shows workflow completed very recently (within cooldown window)
      const justNow = new Date().toISOString();
      const initialState: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: {
          explorer: {
            lastCompletion: {
              runId: "run-explorer-prev",
              startedAt: new Date(Date.now() - 60_000).toISOString(),
              completedAt: justNow,
              status: "success",
            },
          },
        },
      };
      writeState(statePath, initialState);

      const definition: WorkflowDefinition = {
        name: "explorer",
        definitionPath: "test/explorer.ts",
        moduleRoot: "/test-module-root",
        enabled: true,
        recoveryCapable: false,
        tags: [],
        triggers: [{ event: "queue.empty", cooldownMs: 1_800_000 }], // 30 min cooldown
        steps: [{ id: "explore", type: "emit", event: "explorer.done" }],
      };

      const queue = new WorkflowQueueManager({
        store: {
          readState: () => readState(statePath),
          setPendingRuns: () => {},
        } as any,
        idempotencyStore: new IdempotencyStore(join(kotaDir, "idempotency"), "scope-a"),
        getActiveBackoff: () => null,
        shouldSuppressBackoff: () => null,
        workflowUsesAgent: () => false,
        isActiveRun: () => false,
        getDefinitions: () => [definition],
        log: () => {},
      });

      // Simulate a queued run with a stale notBeforeMs (from before the workflow
      // completed, so it looks eligible based on enqueue-time data)
      queue.setRuns([
        {
          runId: "run-explorer-1",
          workflowName: "explorer",
          trigger: { event: "queue.empty", schemaRef: null, payload: {} },
          enqueuedAtMs: Date.now() - 60_000,
          notBeforeMs: Date.now() - 30_000, // stale: looks eligible
        },
      ]);

      // pick() should re-validate against current state and reject this run
      // because lastCompletedAt is within the 30-minute cooldown window
      const picked = queue.pick();
      expect(picked).toBeNull();
    });

    it("allows a queued run when cooldown has actually elapsed", () => {
      // State shows workflow completed long ago (outside cooldown window)
      const longAgo = new Date(Date.now() - 3_600_000).toISOString(); // 1 hour ago
      const initialState: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: {
          explorer: {
            lastCompletion: {
              runId: "run-explorer-prev",
              startedAt: new Date(Date.now() - 3_660_000).toISOString(),
              completedAt: longAgo,
              status: "success",
            },
          },
        },
      };
      writeState(statePath, initialState);

      const definition: WorkflowDefinition = {
        name: "explorer",
        definitionPath: "test/explorer.ts",
        moduleRoot: "/test-module-root",
        enabled: true,
        recoveryCapable: false,
        tags: [],
        triggers: [{ event: "queue.empty", cooldownMs: 1_800_000 }], // 30 min cooldown
        steps: [{ id: "explore", type: "emit", event: "explorer.done" }],
      };

      const queue = new WorkflowQueueManager({
        store: {
          readState: () => readState(statePath),
          setPendingRuns: () => {},
        } as any,
        idempotencyStore: new IdempotencyStore(join(kotaDir, "idempotency"), "scope-a"),
        getActiveBackoff: () => null,
        shouldSuppressBackoff: () => null,
        workflowUsesAgent: () => false,
        isActiveRun: () => false,
        getDefinitions: () => [definition],
        log: () => {},
      });

      queue.setRuns([
        {
          runId: "run-explorer-2",
          workflowName: "explorer",
          trigger: { event: "queue.empty", schemaRef: null, payload: {} },
          enqueuedAtMs: Date.now() - 60_000,
          notBeforeMs: Date.now() - 30_000,
        },
      ]);

      const picked = queue.pick();
      expect(picked).not.toBeNull();
      expect(picked!.runId).toBe("run-explorer-2");
    });

    it("does not preserve stale queued delays after a trigger cooldown is removed", () => {
      const initialState: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: {
          explorer: {
            lastCompletion: {
              runId: "run-explorer-prev",
              startedAt: new Date(Date.now() - 60_000).toISOString(),
              completedAt: new Date().toISOString(),
              status: "success",
            },
          },
        },
      };
      writeState(statePath, initialState);

      const definition: WorkflowDefinition = {
        name: "explorer",
        definitionPath: "test/explorer.ts",
        moduleRoot: "/test-module-root",
        enabled: true,
        recoveryCapable: false,
        tags: [],
        triggers: [{ event: "queue.empty", cooldownMs: 0 }],
        steps: [{ id: "explore", type: "emit", event: "explorer.done" }],
      };

      const queue = new WorkflowQueueManager({
        store: {
          readState: () => readState(statePath),
          setPendingRuns: () => {},
        } as any,
        idempotencyStore: new IdempotencyStore(join(kotaDir, "idempotency"), "scope-a"),
        getActiveBackoff: () => null,
        shouldSuppressBackoff: () => null,
        workflowUsesAgent: () => false,
        isActiveRun: () => false,
        getDefinitions: () => [definition],
        log: () => {},
      });

      queue.setRuns([
        {
          runId: "run-explorer-stale-delay",
          workflowName: "explorer",
          trigger: { event: "queue.empty", schemaRef: null, payload: {} },
          enqueuedAtMs: Date.now() - 60_000,
          notBeforeMs: Date.now() + 3_600_000,
        },
      ]);

      const picked = queue.pick();
      expect(picked).not.toBeNull();
      expect(picked!.runId).toBe("run-explorer-stale-delay");
    });
  });
});
