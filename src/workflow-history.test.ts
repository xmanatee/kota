import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "./workflow/run-store.js";
import type { WorkflowStepResult } from "./workflow/run-types.js";
import type { WorkflowDefinition } from "./workflow/types.js";
import { computeHistoryStats, loadRunsInWindow } from "./workflow-history.js";

const minimalWorkflow = (name: string): WorkflowDefinition => ({
  name,
  tags: [],
  enabled: true,
  definitionPath: `src/workflows/${name}/workflow.ts`,
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
});

function makeAgentStep(id: string, costUsd: number, durationMs: number): WorkflowStepResult {
  return {
    id,
    type: "agent",
    status: "success",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs,
    output: { content: "ok", totalCostUsd: costUsd },
  };
}

describe("workflow history", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-wf-hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("loadRunsInWindow", () => {
    it("returns all recent runs within the time window", () => {
      const trigger = { event: "test", payload: {} };
      const run1 = store.createRun(minimalWorkflow("builder"), trigger);
      run1.finish({ status: "success", durationMs: 1000 });
      const run2 = store.createRun(minimalWorkflow("explorer"), trigger);
      run2.finish({ status: "failed", durationMs: 2000 });

      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const runs = loadRunsInWindow(store.runsDir, cutoff);
      expect(runs).toHaveLength(2);
    });

    it("excludes runs when cutoff is in the future", () => {
      const trigger = { event: "test", payload: {} };
      const run = store.createRun(minimalWorkflow("builder"), trigger);
      run.finish({ status: "success", durationMs: 1000 });

      const futureMs = Date.now() + 10_000;
      const runs = loadRunsInWindow(store.runsDir, futureMs);
      expect(runs).toHaveLength(0);
    });

    it("returns empty array when runs directory does not exist", () => {
      const runs = loadRunsInWindow("/nonexistent/path", Date.now() - 86400_000);
      expect(runs).toHaveLength(0);
    });
  });

  describe("computeHistoryStats", () => {
    it("computes correct counts and success rate", () => {
      const trigger = { event: "test", payload: {} };

      const run1 = store.createRun(minimalWorkflow("builder"), trigger);
      run1.recordStep(makeAgentStep("s1", 0.10, 10_000));
      run1.finish({ status: "success", durationMs: 10_000 });

      const run2 = store.createRun(minimalWorkflow("builder"), trigger);
      run2.recordStep(makeAgentStep("s1", 0.20, 20_000));
      run2.finish({ status: "failed", durationMs: 20_000 });

      const run3 = store.createRun(minimalWorkflow("builder"), trigger);
      run3.recordStep(makeAgentStep("s1", 0.30, 30_000));
      run3.finish({ status: "success", durationMs: 30_000 });

      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const runs = loadRunsInWindow(store.runsDir, cutoff);
      const stats = computeHistoryStats(runs);

      expect(stats.total).toBe(3);
      expect(stats.successes).toBe(2);
      expect(stats.failures).toBe(1);
      expect(stats.interrupted).toBe(0);
      expect(stats.successRate).toBeCloseTo(66.67, 1);
    });

    it("computes cost stats correctly", () => {
      const trigger = { event: "test", payload: {} };

      const run1 = store.createRun(minimalWorkflow("builder"), trigger);
      run1.recordStep(makeAgentStep("s1", 0.10, 1000));
      run1.finish({ status: "success", durationMs: 1000 });

      const run2 = store.createRun(minimalWorkflow("builder"), trigger);
      run2.recordStep(makeAgentStep("s1", 0.30, 3000));
      run2.finish({ status: "success", durationMs: 3000 });

      const runs = loadRunsInWindow(store.runsDir, Date.now() - 86400_000);
      const stats = computeHistoryStats(runs);

      expect(stats.totalCostUsd).toBeCloseTo(0.40);
      expect(stats.avgCostUsd).toBeCloseTo(0.20);
    });

    it("computes duration stats including p95", () => {
      const trigger = { event: "test", payload: {} };
      const durations = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000];

      for (const dur of durations) {
        const run = store.createRun(minimalWorkflow("builder"), trigger);
        run.finish({ status: "success", durationMs: dur });
      }

      const runs = loadRunsInWindow(store.runsDir, Date.now() - 86400_000);
      const stats = computeHistoryStats(runs);

      expect(stats.avgDurationMs).toBeCloseTo(5500);
      // p95 of 10 values: ceil(0.95*10)-1 = ceil(9.5)-1 = 10-1 = 9 → sorted[9] = 10_000
      expect(stats.p95DurationMs).toBe(10_000);
    });

    it("handles missing cost data by treating as zero", () => {
      const trigger = { event: "test", payload: {} };
      const run = store.createRun(minimalWorkflow("builder"), trigger);
      run.finish({ status: "success", durationMs: 5000 });

      const runs = loadRunsInWindow(store.runsDir, Date.now() - 86400_000);
      const stats = computeHistoryStats(runs);
      expect(stats.totalCostUsd).toBe(0);
      expect(stats.avgCostUsd).toBe(0);
    });

    it("returns null durations when no finished runs have durationMs", () => {
      const stats = computeHistoryStats([]);
      expect(stats.total).toBe(0);
      expect(stats.avgDurationMs).toBeNull();
      expect(stats.p95DurationMs).toBeNull();
    });
  });
});
