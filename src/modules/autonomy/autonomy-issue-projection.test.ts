import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  AUTONOMY_ISSUE_PROJECTION_FILE,
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
  readAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";
import {
  AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT,
  stageAutonomyIssueProjection,
} from "./autonomy-issue-projection-publication.js";
import type {
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
} from "./health-signal.js";
import materializationWorkflow from "./workflows/autonomy-issue-projection-materialization/workflow.js";

const ROOT_CAUSE = "workflow:builder:runtime-warning";

function observation(args: {
  kind?: AutonomyHealthObservation;
  runId: string;
  observedAt: string;
  severity?: AutonomyHealthSeverity;
}) {
  return buildAutonomyIssueObservation({
    kind: args.kind ?? "present",
    rootCauseKey: ROOT_CAUSE,
    observedAt: args.observedAt,
    signalIds: [`health-${args.runId}`],
    source: { kind: "workflow", id: "builder", workflow: "builder" },
    severity: args.severity ?? "warning",
    actionability: "local-code",
    labels: ["runtime"],
    summaries: ["Builder repeatedly hit the same runtime root cause."],
    evidenceRefs: [{
      kind: "run",
      ref: `.kota/runs/${args.runId}/metadata.json`,
    }],
    observationCount: 1,
  });
}

describe("durable autonomy issue projection", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("reduces observations and dispositions without writing private state", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-autonomy-issues-"));
    scopeRoots.push(workspaceRoot);
    const observations = [
      observation({ runId: "run-1", observedAt: "2026-06-17T12:00:00.000Z" }),
      observation({ runId: "run-2", observedAt: "2026-06-17T13:00:00.000Z" }),
      observation({
        kind: "changed",
        runId: "run-3",
        observedAt: "2026-06-17T14:00:00.000Z",
        severity: "error",
      }),
    ];
    const reduced = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations,
    });
    expect(reduced.transitions.map((transition) => transition.kind)).toEqual([
      "opened",
      "repeated",
      "revised",
    ]);
    const disposed = recordAutonomyIssueDispositions({
      current: reduced.projection,
      updates: [{
        issueKey: observations[0]!.issueKey,
        kind: "task",
        decidedAt: "2026-06-17T15:00:00.000Z",
        taskIds: ["task-health-builder"],
        ownerQuestionIds: [],
      }],
    });
    expect(disposed.issues[0]).toMatchObject({
      semanticRevision: 2,
      status: "open",
      disposition: { kind: "task", semanticRevision: 2 },
      links: { taskIds: ["task-health-builder"] },
    });
    expect(existsSync(join(workspaceRoot, AUTONOMY_ISSUE_PROJECTION_FILE))).toBe(false);
  });

  it("stages one CAS and materializes only from the published state row", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-autonomy-publish-"));
    scopeRoots.push(workspaceRoot);
    const state = createTestTransactionalRunState();
    const current = emptyAutonomyIssueProjection();
    const next = applyAutonomyIssueObservations({
      current,
      observations: [observation({
        runId: "run-1",
        observedAt: "2026-06-17T12:00:00.000Z",
      })],
    }).projection;
    const emit = vi.fn();

    expect(stageAutonomyIssueProjection({
      state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: 0,
      current,
      next,
      emit,
      stepId: "publish:test",
    })).toBe(true);
    expect(existsSync(join(workspaceRoot, AUTONOMY_ISSUE_PROJECTION_FILE))).toBe(false);
    expect(emit).toHaveBeenCalledWith(
      AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT,
      {
        idempotencyKey: "autonomy-issue-projection:1",
        stateRevision: 1,
      },
      { delivery: "on-run-success", stepId: "publish:test" },
    );

    const result = await new WorkflowTestHarness(materializationWorkflow, {
      workspaceRoot,
      trigger: {
        event: AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT,
        schemaRef: null,
        payload: {
          idempotencyKey: "autonomy-issue-projection:1",
          stateRevision: 1,
        },
      },
      contextOverrides: { state },
    }).run();
    expect(result.status).toBe("success");
    expect(readAutonomyIssueProjection(workspaceRoot)).toEqual(next);
    expect(state.read<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    )).toEqual({ revision: 1, value: next });
  });

  it("rejects a stale competing projection publication", () => {
    const state = createTestTransactionalRunState();
    const current = emptyAutonomyIssueProjection();
    const next = applyAutonomyIssueObservations({
      current,
      observations: [observation({
        runId: "run-1",
        observedAt: "2026-06-17T12:00:00.000Z",
      })],
    }).projection;
    stageAutonomyIssueProjection({
      state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: 0,
      current,
      next,
      emit: vi.fn(),
      stepId: "publish:first",
    });
    expect(() => stageAutonomyIssueProjection({
      state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: 0,
      current,
      next,
      emit: vi.fn(),
      stepId: "publish:stale",
    })).toThrow(/revision mismatch/);
  });
});
