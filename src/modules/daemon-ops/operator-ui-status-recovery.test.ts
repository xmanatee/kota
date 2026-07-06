import { describe, expect, it } from "vitest";
import type { WorkflowRecoveryStatus } from "#core/workflow/recovery-status-types.js";
import { renderToString } from "#modules/rendering/transport.js";
import {
  buildStatusUiSurface,
  renderUiSurface,
} from "./operator-ui.js";
import type { StatusSnapshot } from "./status-cli.js";

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "missing" },
    historicalWorkflow: {
      activeRuns: 0,
      queuedRuns: 2,
      workflowPaused: false,
    },
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
    retryAttemptedBy: [],
    updatedAt: "2026-07-07T00:00:00.000Z",
    nextAction: "Clean or stash the dirty checkout, then run `kota workflow resume`.",
  };
}

describe("operator shared Status UI recovery state", () => {
  it("renders dirty-recovery pause details and a workflow status action", () => {
    const recovery = dirtyRecoveryFixture();
    const surface = buildStatusUiSurface(
      status({
        daemonRunning: true,
        daemonPid: 4242,
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
        controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
      }),
    );

    const rendered = renderToString(renderUiSurface(surface), { width: 120 });
    expect(rendered).toContain("dirty canonical checkout recovery from builder");
    expect(rendered).toContain("2026-07-06T20-49-21-196Z-builder-rej04x, attempts 1");
    expect(rendered).toContain("M src/core/workflow/runtime.ts");
    expect(rendered).toContain("Pending recovery");
    expect(rendered).toContain("Clean or stash the dirty checkout");
    const warnings = surface.nodes.find((node) => node.kind === "list" && node.title === "Warnings");
    const dirtyRecovery = warnings?.kind === "list"
      ? warnings.items.find((item) => item.id === "dirty-recovery")
      : undefined;
    expect(dirtyRecovery?.action?.actionId).toBe("workflow.status");
  });
});
