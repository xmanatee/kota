import { describe, expect, it } from "vitest";
import type { WorkflowRecoveryStatus } from "#core/workflow/recovery-status-types.js";
import {
  formatStatusOutput,
  type StatusSnapshot,
} from "./status-cli.js";

function makeSnap(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/Users/op/Desktop/mono/apps/kota",
    projectName: "kota",
    controlFile: { kind: "missing" },
    ...overrides,
  };
}

function dirtyRecoveryFixture(): Exclude<WorkflowRecoveryStatus, { status: "none" }> {
  return {
    status: "pending",
    sourceWorkflow: "builder",
    sourceRunId: "2026-07-06T20-49-21-196Z-builder-rej04x",
    dirtyCheckout: "canonical",
    worktreeFingerprint: "M src/core/workflow/runtime.ts",
    worktreeSummary: "M src/core/workflow/runtime.ts",
    attempts: 1,
    retryAttemptedBy: [
      {
        workflow: "builder",
        runId: "2026-07-06T20-49-21-196Z-builder-retry",
        attemptedAt: "2026-07-07T00:01:00.000Z",
      },
    ],
    updatedAt: "2026-07-07T00:00:00.000Z",
    nextAction: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
  };
}

describe("formatStatusOutput recovery pause rendering", () => {
  it("shows dirty-recovery dispatch pause with a concrete next action", () => {
    const recovery = dirtyRecoveryFixture();
    const out = formatStatusOutput(makeSnap({
      daemonRunning: true,
      daemonPid: 12345,
      workflowPaused: true,
      workflowPause: {
        paused: true,
        kind: "dirty-recovery",
        source: "runtime",
        message: "Dirty recovery pause from builder.",
        nextAction: recovery.nextAction,
        recovery,
      },
      pendingRecovery: recovery,
      controlFile: { kind: "fresh", pid: 12345, baseURL: "http://127.0.0.1:8765" },
    }));

    expect(out).toContain("paused for dirty recovery");
    expect(out).toContain("builder");
    expect(out).toContain("2026-07-06T20-49-21-196Z-builder-rej04x");
    expect(out).toContain("Pending recovery");
    expect(out).toContain("Clean or stash the dirty checkout");
  });

  it("shows offline dirty-recovery pause separately from an operator pause", () => {
    const recovery = dirtyRecoveryFixture();
    const out = formatStatusOutput(makeSnap({
      workflowPaused: true,
      workflowPause: {
        paused: true,
        kind: "dirty-recovery",
        source: "signal",
        message: "Dirty recovery pause from builder.",
        nextAction: recovery.nextAction,
        recovery,
      },
      pendingRecovery: recovery,
      historicalWorkflow: {
        activeRuns: 0,
        queuedRuns: 0,
        workflowPaused: true,
      },
    }));

    expect(out).toContain("dirty recovery pause signal present");
    expect(out).not.toContain("operator pause signal present");
  });
});
