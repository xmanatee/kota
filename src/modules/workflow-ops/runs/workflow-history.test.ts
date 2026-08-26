import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  computeHistoryStats,
  listStoredWorkflowRuns,
  loadRunsInWindow,
} from "./workflow-history.js";

const minimalWorkflow = (name: string): WorkflowDefinition => ({
  name,
  enabled: true,
  repository: "none",
  tags: [],
  definitionPath: `src/modules/test/workflows/${name}/workflow.ts`,
  moduleRoot: "/test-module-root",
  triggers: [{ event: "runtime.idle", cooldownMs: 0 }],
  steps: [],
});

function storedMetadata(
  id: string,
  workflow: string,
  startedAt: string,
): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: `src/modules/test/workflows/${workflow}/workflow.ts`,
    trigger: { event: "test", schemaRef: null, payload: {} },
    startedAt,
    status: "success",
    runDir: id,
    steps: [],
  };
}

function makeAgentStep(
  id: string,
  measuredCostUsd: number,
  durationMs: number,
): Extract<WorkflowStepResult, { type: "agent" }> {
  return {
    id,
    type: "agent",
    status: "success",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs,
    output: { content: "ok" },
    usage: {
      tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
      cost: { state: "complete", usd: measuredCostUsd },
    },
  };
}

describe("workflow history", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-wf-hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  describe("loadRunsInWindow", () => {
    it("returns all recent runs within the time window", () => {
      const trigger = { event: "test", schemaRef: null, payload: {} };
      const run1 = store.createRun(minimalWorkflow("builder"), trigger);
      run1.finish({ status: "success", durationMs: 1000 });
      const run2 = store.createRun(minimalWorkflow("explorer"), trigger);
      run2.finish({ status: "failed", durationMs: 2000 });

      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const runs = loadRunsInWindow(store.runsDir, cutoff);
      expect(runs).toHaveLength(2);
    });

    it("excludes runs when cutoff is in the future", () => {
      const trigger = { event: "test", schemaRef: null, payload: {} };
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

    it("continues past older metadata in non-chronological directories", () => {
      const sampleDir = join(store.runsDir, "sample-run");
      mkdirSync(sampleDir, { recursive: true });
      writeFileSync(
        join(sampleDir, "metadata.json"),
        JSON.stringify(
          storedMetadata(
            "sample-run",
            "sample",
            new Date(Date.now() - 30 * 86400_000).toISOString(),
          ),
        ),
      );

      const trigger = { event: "test", schemaRef: null, payload: {} };
      const run = store.createRun(minimalWorkflow("builder"), trigger);
      run.finish({ status: "success", durationMs: 1000 });

      const runs = loadRunsInWindow(store.runsDir, Date.now() - 86400_000);
      expect(runs.map((item) => item.workflow)).toEqual(["builder"]);
    });

    it("rejects mismatched, alternate-run, traversal, and noncanonical directory identities", () => {
      const startedAt = new Date().toISOString();
      const cases = [
        ["mismatched-directory", "different-run"],
        ["forged-alternate-directory", "authentic-alternate-run"],
        ["posix-traversal-directory", "../authentic-alternate-run"],
        ["windows-traversal-directory", "..\\authentic-alternate-run"],
        ["unsafe directory", "unsafe directory"],
      ] as const;
      for (const [directoryName, metadataId] of cases) {
        const runDir = join(store.runsDir, directoryName);
        mkdirSync(runDir, { recursive: true });
        writeFileSync(
          join(runDir, "metadata.json"),
          JSON.stringify(storedMetadata(metadataId, "builder", startedAt)),
        );
      }

      const authenticRunDir = join(store.runsDir, "authentic-alternate-run");
      mkdirSync(authenticRunDir, { recursive: true });
      writeFileSync(
        join(authenticRunDir, "metadata.json"),
        JSON.stringify(
          storedMetadata("authentic-alternate-run", "builder", startedAt),
        ),
      );

      expect(listStoredWorkflowRuns(store.runsDir).map((run) => run.id)).toEqual([
        "authentic-alternate-run",
      ]);
    });
  });

  describe("computeHistoryStats", () => {
    it("computes correct counts and success rate", () => {
      const trigger = { event: "test", schemaRef: null, payload: {} };

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
      const trigger = { event: "test", schemaRef: null, payload: {} };

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
      expect(stats.measuredCostRuns).toBe(2);
      expect(stats.unavailableCostRuns).toBe(0);
      expect(stats.unknownCostRuns).toBe(0);
    });

    it("computes duration stats including p95", () => {
      const trigger = { event: "test", schemaRef: null, payload: {} };
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

    it("does not represent runs without agent usage as zero cost", () => {
      const trigger = { event: "test", schemaRef: null, payload: {} };
      const run = store.createRun(minimalWorkflow("builder"), trigger);
      run.finish({ status: "success", durationMs: 5000 });

      const runs = loadRunsInWindow(store.runsDir, Date.now() - 86400_000);
      const stats = computeHistoryStats(runs);
      expect(stats.totalCostUsd).toBeNull();
      expect(stats.avgCostUsd).toBeNull();
      expect(stats.measuredCostRuns).toBe(0);
      expect(stats.unavailableCostRuns).toBe(0);
      expect(stats.unknownCostRuns).toBe(0);
    });

    it("counts unavailable and unknown agent costs separately", () => {
      const trigger = { event: "test", schemaRef: null, payload: {} };
      const unavailableRun = store.createRun(minimalWorkflow("builder"), trigger);
      unavailableRun.recordStep({
        ...makeAgentStep("unavailable", 1, 1000),
        usage: {
          tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
          cost: { state: "unavailable", reason: "provider-does-not-report" },
        },
      });
      unavailableRun.finish({ status: "success", durationMs: 1000 });

      const unknownRun = store.createRun(minimalWorkflow("builder"), trigger);
      unknownRun.recordStep({
        ...makeAgentStep("unknown", 1, 1000),
        usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } },
      });
      unknownRun.finish({ status: "success", durationMs: 1000 });

      const stats = computeHistoryStats(
        loadRunsInWindow(store.runsDir, Date.now() - 86400_000),
      );
      expect(stats.totalCostUsd).toBeNull();
      expect(stats.avgCostUsd).toBeNull();
      expect(stats.measuredCostRuns).toBe(0);
      expect(stats.unavailableCostRuns).toBe(1);
      expect(stats.unknownCostRuns).toBe(1);
    });

    it("returns null durations when no finished runs have durationMs", () => {
      const stats = computeHistoryStats([]);
      expect(stats.total).toBe(0);
      expect(stats.avgDurationMs).toBeNull();
      expect(stats.p95DurationMs).toBeNull();
    });
  });
});
