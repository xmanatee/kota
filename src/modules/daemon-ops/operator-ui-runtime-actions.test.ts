import { describe, expect, it, vi } from "vitest";
import type { KotaClient } from "#core/server/kota-client.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { WorkflowStatusSnapshot } from "#modules/workflow-ops/client.js";
import {
  buildRuntimeUiSurface,
  executeUiAction,
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

function runtimeStatus(): WorkflowStatusSnapshot {
  return {
    activeRuns: [{ runId: "run-active-1", workflow: "builder", startedAt: "2026-07-07T00:00:00.000Z" }],
    pendingRuns: [{
      runId: "queued-run-1",
      workflowName: "improver",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      enqueuedAtMs: Date.parse("2026-07-07T00:01:00.000Z"),
      notBeforeMs: Date.parse("2026-07-07T00:01:00.000Z"),
    }],
    queueLength: 1,
    completedRuns: 2,
    workflows: {},
    paused: false,
    pendingAbort: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
  };
}

function dirtyRecovery(): Exclude<
  NonNullable<WorkflowStatusSnapshot["recovery"]>,
  { status: "none" }
> {
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

describe("operator UI runtime actions", () => {
  it("renders dirty-recovery dispatch state in the Runtime surface", () => {
    const recovery = dirtyRecovery();
    const surface = buildRuntimeUiSurface({
      status: status({
        daemonRunning: true,
        daemonPid: 4242,
        scopedProject: { projectId: "scope-main", projectDir: "/repo", displayName: "repo" },
      }),
      workflowStatus: {
        ok: true,
        value: {
          ...runtimeStatus(),
          paused: true,
          pause: {
            paused: true,
            kind: "dirty-recovery",
            source: "runtime",
            message: "Dirty recovery pause from builder.",
            nextAction: recovery.nextAction,
            recovery,
          },
          recovery,
        },
      },
      runs: { ok: true, value: { runs: [] } },
      definitions: { ok: true, value: { source: "daemon", definitions: [] } },
      approvals: { ok: true, value: { approvals: [] } },
      ownerQuestions: { ok: true, value: { questions: [] } },
      sessions: { ok: true, value: { sessions: [] } },
    });

    const rendered = renderToString(renderUiSurface(surface), { width: 120 });
    expect(rendered).toContain("dirty canonical checkout recovery from builder");
    expect(rendered).toContain("2026-07-06T20-49-21-196Z-builder-rej04x, attempts 1");
    expect(rendered).toContain("M src/core/workflow/runtime.ts");
    expect(rendered).toContain("Clean or stash the dirty checkout");
  });

  it("builds executable queued and recent run supervision controls", async () => {
    const surface = buildRuntimeUiSurface({
      status: status({
        daemonRunning: true,
        daemonPid: 4242,
        scopedProject: { projectId: "scope-main", projectDir: "/repo", displayName: "repo" },
      }),
      workflowStatus: { ok: true, value: runtimeStatus() },
      runs: {
        ok: true,
        value: {
          runs: [
            {
              id: "run-failed-1",
              workflow: "builder",
              status: "failed",
              triggerEvent: "manual",
              triggerSchemaRef: null,
              startedAt: "2026-07-07T00:02:00.000Z",
            },
            {
              id: "run-success-1",
              workflow: "builder",
              status: "success",
              triggerEvent: "manual",
              triggerSchemaRef: null,
              startedAt: "2026-07-07T00:03:00.000Z",
            },
          ],
        },
      },
      definitions: { ok: true, value: { source: "daemon", definitions: [] } },
      approvals: { ok: true, value: { approvals: [] } },
      ownerQuestions: { ok: true, value: { questions: [] } },
      sessions: { ok: true, value: { sessions: [] } },
    });

    expect(surface.actions.map((action) => action.actionId)).toEqual(expect.arrayContaining([
      "run.abort",
      "run.cancel-queued",
      "run.retry",
      "run.replay",
      "run.resume",
    ]));
    const queued = surface.nodes.find((node) => node.kind === "table" && node.title === "Queued workflow runs");
    expect(queued?.kind === "table" ? queued.rows[0]?.action?.actionId : undefined).toBe("run.cancel-queued");
    const recent = surface.nodes.find((node) => node.kind === "table" && node.title === "Recent run results");
    expect(recent?.kind === "table" ? recent.rows[0]?.action?.actionId : undefined).toBe("run.retry");
    const rendered = renderToString(renderUiSurface(surface), { width: 120 });
    expect(rendered).toContain("Cancel queued run");
    expect(rendered).toContain("Retry failed run");

    const retry = surface.actions.find((candidate) => candidate.actionId === "run.retry");
    if (!retry) throw new Error("run.retry action missing");
    const triggerByName = vi.fn(async () => ({ ok: true as const, path: "queue" as const, queued: "builder" }));
    const client = {
      workflow: {
        getRun: vi.fn(async () => ({
          found: true as const,
          run: {
            id: "run-failed-1",
            workflow: "builder",
            status: "failed",
            triggerEvent: "manual",
            triggerSchemaRef: null,
            startedAt: "2026-07-07T00:02:00.000Z",
            steps: [],
          },
        })),
        triggerByName,
      },
    } as unknown as KotaClient;
    const result = await executeUiAction({
      action: retry,
      client,
      parameters: { runId: "run-failed-1" },
    });
    expect(result).toEqual({ ok: true, message: "Queued retry of builder from run-failed-1." });
    expect(triggerByName).toHaveBeenCalledWith("builder", {
      event: "retry",
      payload: { retryOf: "run-failed-1" },
    });
  });
});
