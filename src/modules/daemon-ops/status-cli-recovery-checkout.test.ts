import { describe, expect, it } from "vitest";
import { formatStatusOutput, type StatusSnapshot } from "./status-cli.js";

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

describe("status pending recovery checkout attribution", () => {
  it("shows canonical checkout recovery", () => {
    const out = formatStatusOutput(
      makeSnap({
        pendingRecovery: {
          status: "pending",
          sourceWorkflow: "builder",
          sourceRunId: "run-legacy",
          dirtyCheckout: "canonical",
          worktreeFingerprint: "M README.md",
          worktreeSummary: "M README.md",
          attempts: 0,
          retryAttemptedBy: [],
          updatedAt: "2026-07-07T00:00:00.000Z",
          nextAction: "Start the daemon to run recovery, or clean the checkout before resuming dispatch.",
        },
      }),
    );

    expect(out).toContain("dirty canonical checkout");
  });

  it("shows workspace checkout recovery when recovery state is attributed to a workspace", () => {
    const out = formatStatusOutput(
      makeSnap({
        pendingRecovery: {
          status: "pending",
          sourceWorkflow: "builder",
          sourceRunId: "run-workspace",
          dirtyCheckout: "workspace",
          worktreeFingerprint: "M README.md",
          worktreeSummary: "M README.md",
          attempts: 0,
          retryAttemptedBy: [],
          updatedAt: "2026-07-07T00:00:00.000Z",
          nextAction: "Start the daemon to run recovery, or clean the checkout before resuming dispatch.",
        },
      }),
    );

    expect(out).toContain("dirty workspace checkout");
  });
});
