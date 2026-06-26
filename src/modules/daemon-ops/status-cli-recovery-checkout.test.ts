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
  it("keeps legacy recovery state readable as a dirty worktree", () => {
    const out = formatStatusOutput(
      makeSnap({
        pendingRecovery: {
          sourceWorkflow: "builder",
          sourceRunId: "run-legacy",
          worktreeSummary: "M README.md",
          attempts: 0,
        },
      }),
    );

    expect(out).toContain("dirty worktree");
  });

  it("shows workspace checkout recovery when recovery state is attributed to a workspace", () => {
    const out = formatStatusOutput(
      makeSnap({
        pendingRecovery: {
          sourceWorkflow: "builder",
          sourceRunId: "run-workspace",
          dirtyCheckout: "workspace",
          worktreeSummary: "M README.md",
          attempts: 0,
        },
      }),
    );

    expect(out).toContain("dirty workspace checkout");
  });
});
