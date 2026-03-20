import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEligibleAtMs } from "./workflow/run-executor.js";
import { WorkflowRunStore } from "./workflow/run-store.js";
import type { WorkflowRuntimeState } from "./workflow/types.js";

// Isolated test for the trigger command's core logic:
// cooldown checks and queue writes via WorkflowRunStore.

describe("workflow trigger command logic", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-wf-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("enqueues a workflow when queue is empty", () => {
    const now = Date.now();
    store.setPendingRuns([
      {
        workflowName: "builder",
        trigger: { event: "manual", payload: { triggeredAt: new Date().toISOString() } },
        enqueuedAtMs: now,
        notBeforeMs: now,
      },
    ]);

    const state = store.readState();
    expect(state.pendingRuns).toHaveLength(1);
    expect(state.pendingRuns[0].workflowName).toBe("builder");
    expect(state.pendingRuns[0].trigger.event).toBe("manual");
  });

  it("detects a workflow already in the queue", () => {
    const now = Date.now();
    store.setPendingRuns([
      {
        workflowName: "builder",
        trigger: { event: "manual", payload: {} },
        enqueuedAtMs: now,
        notBeforeMs: now,
      },
    ]);

    const state = store.readState();
    const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === "builder");
    expect(alreadyQueued).toBe(true);
  });

  describe("getEligibleAtMs (cooldown check)", () => {
    it("returns now when no last run exists", () => {
      const state: WorkflowRuntimeState = { completedRuns: 0, pendingRuns: [], workflows: {} };
      const before = Date.now();
      const eligibleAt = getEligibleAtMs("builder", 60_000, state);
      expect(eligibleAt).toBeGreaterThanOrEqual(before);
      expect(eligibleAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns now when cooldownMs is zero", () => {
      const lastCompleted = new Date(Date.now() - 5_000).toISOString();
      const state: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: { builder: { lastCompletedAt: lastCompleted, lastStatus: "success" } },
      };
      const eligibleAt = getEligibleAtMs("builder", 0, state);
      expect(eligibleAt).toBeLessThanOrEqual(Date.now());
    });

    it("returns a future time when cooldown has not elapsed", () => {
      const lastCompleted = new Date(Date.now() - 30_000).toISOString(); // 30s ago
      const cooldownMs = 120_000; // 2 min cooldown
      const state: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: { builder: { lastCompletedAt: lastCompleted, lastStatus: "success" } },
      };
      const eligibleAt = getEligibleAtMs("builder", cooldownMs, state);
      expect(eligibleAt).toBeGreaterThan(Date.now());
    });

    it("returns a past time when cooldown has elapsed", () => {
      const lastCompleted = new Date(Date.now() - 200_000).toISOString(); // 200s ago
      const cooldownMs = 60_000; // 1 min cooldown
      const state: WorkflowRuntimeState = {
        completedRuns: 1,
        pendingRuns: [],
        workflows: { builder: { lastCompletedAt: lastCompleted, lastStatus: "success" } },
      };
      const eligibleAt = getEligibleAtMs("builder", cooldownMs, state);
      expect(eligibleAt).toBeLessThan(Date.now());
    });
  });
});
