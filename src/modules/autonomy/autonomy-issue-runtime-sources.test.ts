import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowDispatchDeadLetter } from "#core/daemon/dead-letter-queue.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import type { StoredRun } from "#core/workflow/run-state-database.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import {
  applyHealthReviewSignals,
  ISSUE_SOURCE_SCOPE_ID,
  wireAutonomyIssueSourceFixture,
} from "./autonomy-issue-sources.test-helpers.js";
import { workflowHealthContractLabel } from "./autonomy-issue-workflow-source.js";
import type { AutonomyHealthSignal } from "./health-signal.js";

const NOW = "2026-08-13T10:00:00.000Z";

describe("runtime-owned autonomy issue observations", () => {
  let scopeRoot: string;
  let pbus: ScopedEventBus;
  let signals: AutonomyHealthSignal[];
  let runtime: ReturnType<typeof wireAutonomyIssueSourceFixture>["runtime"];

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-issue-runtime-sources-"));
    ({ pbus, signals, runtime } = wireAutonomyIssueSourceFixture(scopeRoot));
  });

  afterEach(() => {
    runtime.runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("derives workflow health contracts without volatile schedule timestamps", () => {
    const run = (payload: Record<string, unknown>): StoredRun => ({
      id: "scheduled-run",
      scopeId: ISSUE_SOURCE_SCOPE_ID,
      workflow: "runtime-health-auditor",
      trigger: {
        event: "schedule.fire",
        schemaRef: null,
        payload,
      },
      repository: "read",
      state: "succeeded",
      resources: [],
      admittedAt: NOW,
      attempt: 1,
      processes: [],
    });

    expect(workflowHealthContractLabel(run({
      scheduleId: "runtime-health-audit",
      idempotencyKey: "runtime-health-audit:first",
      scheduledAt: "2026-08-13T10:00:00.000Z",
      timestamp: "2026-08-13T10:00:00.000Z",
    }))).toBe(workflowHealthContractLabel(run({
      scheduleId: "runtime-health-audit",
      idempotencyKey: "runtime-health-audit:second",
      scheduledAt: "2026-08-13T16:00:00.000Z",
      timestamp: "2026-08-13T16:00:00.000Z",
    })));
    expect(workflowHealthContractLabel(run({ scheduleId: "another-schedule" })))
      .not.toBe(workflowHealthContractLabel(run({
        scheduleId: "runtime-health-audit",
      })));
  });

  it("links the retained progress-reviewer incident runs until every canonical item is terminal", () => {
    const store = runtime.deadLetterQueue;
    const productionRunIds = [
      "2026-08-06T12-00-00-031Z-progress-reviewer-zrvmul",
      "2026-08-06T13-58-27-896Z-progress-reviewer-v0ge1r",
      "2026-08-06T14-25-33-083Z-progress-reviewer-w67c27",
      "2026-08-06T18-44-27-907Z-progress-reviewer-2hdefe",
    ];
    const failureReason =
      'Agent harness "codex" cannot honor requested run option(s): autonomyMode="passive". autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA\'s passive contract.';
    let processedSignalCount = 0;
    const applied: ReturnType<typeof applyHealthReviewSignals>["applied"] = [];
    const projectNewSignals = (reason: string) => {
      for (const signal of signals.slice(processedSignalCount)) {
        const result = applyHealthReviewSignals({
          workspaceRoot: scopeRoot,
          signals: [signal],
          generatedAt: signal.createdAt,
          reason,
        });
        applied.push(...result.applied);
      }
      processedSignalCount = signals.length;
    };
    const items = productionRunIds.map((runId) =>
      createWorkflowDispatchDeadLetter({
        store,
        scopeId: ISSUE_SOURCE_SCOPE_ID,
        workflowName: "progress-reviewer",
        trigger: {
          event: "autonomy.progress-review.requested",
          schemaRef: null,
          payload: { runId },
        },
        reason: failureReason,
        errorClass: "execution",
        failedRun: {
          id: runId,
          workflow: "progress-reviewer",
          definitionPath: "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
          trigger: {
            event: "autonomy.progress-review.requested",
            schemaRef: null,
            payload: { runId },
          },
          startedAt: NOW,
          completedAt: NOW,
          status: "failed",
          runDir: `.kota/runs/${runId}`,
          steps: [],
        },
      })
    );
    projectNewSignals("later-workflow-dispatch-dead-letter");
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
    expect(items.map((item) => item.source)).toEqual(
      productionRunIds.map((runId) => expect.objectContaining({ failedRunId: runId })),
    );
    for (const item of items.slice(0, -1)) {
      store.dismiss(item.id, "Fixed by commit 532ab1ae");
    }
    projectNewSignals("partial-dead-letter-dismissal");
    expect(signals.map((signal) => signal.observation)).toEqual(
      productionRunIds.map(() => "present"),
    );
    expect(new Set(signals.map((signal) => signal.dedupeKey)).size).toBe(1);
    expect(applied.filter((action) => action.kind === "decision-requested")).toEqual([
      expect.objectContaining({ kind: "decision-requested", transition: "opened" }),
    ]);
    expect(readAutonomyIssueProjection(scopeRoot).issues[0]).toMatchObject({
      semanticRevision: 1,
      occurrenceCount: 4,
    });
    store.dismiss(items.at(-1)!.id, "Fixed by commit 532ab1ae");
    projectNewSignals("final-dead-letter-dismissal");

    expect(signals.map((signal) => signal.observation)).toEqual([
      ...productionRunIds.map(() => "present"),
      "cleared",
    ]);
    expect(signals[0]?.evidenceRefs[0]?.ref).toContain(items[0]!.id);
    expect(signals.at(-1)?.evidenceRefs.map((ref) => ref.ref).sort()).toEqual(
      items.map((item) => `.kota/dead-letter-queue/items.json#${item.id}`).sort(),
    );
    expect(signals.at(-1)?.summary).toContain("commit 532ab1ae");
    expect(applied.at(-1)).toMatchObject({ kind: "resolved", transition: "cleared" });
    const issue = readAutonomyIssueProjection(scopeRoot).issues[0]!;
    expect(issue.status).toBe("resolved");
    expect(issue.occurrenceCount).toBe(4);
    expect(issue.links.deadLetterIds).toEqual(items.map((item) => item.id).sort());
  });

  it("publishes real eval regressions as grouped outcome observations", () => {
    const regression = {
      baseline: { fixtureCount: 8, repeatCount: 3, passAtK: 0.9, passHatK: 0.8 },
      candidate: { fixtureCount: 8, repeatCount: 3, passAtK: 0.7, passHatK: 0.6 },
      hostClass: "local-darwin-arm64",
      noiseBandPercentagePoints: 2,
      dropPercentagePoints: 20,
      runArtifactBaseDir: ".kota/evals/regression-1",
      reason: "Candidate outcome quality dropped by 20 percentage points.",
    } as const;
    pbus.emit("eval-harness.regression.detected", regression);

    expect(signals).toEqual([
      expect.objectContaining({
        dedupeKey: "eval-harness:regression:local-darwin-arm64",
        source: expect.objectContaining({
          kind: "workflow",
          id: "eval-harness-cadence",
        }),
        summary: "Candidate outcome quality dropped by 20 percentage points.",
      }),
    ]);

    pbus.emit("eval-harness.regression.detected", {
      ...regression,
      runArtifactBaseDir: ".kota/evals/regression-2",
    });
    const review = applyHealthReviewSignals({
      workspaceRoot: scopeRoot,
      signals,
      generatedAt: NOW,
      reason: "repeated-eval-regression",
    });
    expect(review.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        transition: "opened",
      }),
    ]);
    expect(readAutonomyIssueProjection(scopeRoot).issues[0]).toMatchObject({
      occurrenceCount: 2,
      status: "needs-decision",
    });
  });

  it("routes typed workflow and module failures without waiting for log reconciliation", () => {
    const admit = (runId: string, triggerEvent: string, request: string) => {
      runtime.runState.admitRun({
        id: runId,
        scopeId: ISSUE_SOURCE_SCOPE_ID,
        workflow: "builder",
        trigger: {
          event: triggerEvent,
          schemaRef: null,
          payload: { request },
        },
        repository: "write",
        resources: [],
        admittedAt: NOW,
      });
    };
    admit(
      "builder-direct-failure",
      "autonomy.queue.available",
      "original-task",
    );
    pbus.emit("workflow.completed", {
      workflow: "builder",
      runId: "builder-direct-failure",
      status: "failed",
      triggerEvent: "autonomy.queue.available",
      durationMs: 1_000,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runDir: ".kota/runs/builder-direct-failure",
      tags: [],
      failureKind: "runtime",
    });
    createWorkflowDispatchDeadLetter({
      store: runtime.deadLetterQueue,
      scopeId: ISSUE_SOURCE_SCOPE_ID,
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: { request: "original-task" },
      },
      reason: "",
      errorClass: "runtime",
      failedRun: {
        id: "builder-direct-failure",
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: {
          event: "autonomy.queue.available",
          schemaRef: null,
          payload: { request: "original-task" },
        },
        startedAt: NOW,
        completedAt: NOW,
        status: "failed",
        runDir: ".kota/runs/builder-direct-failure",
        steps: [],
      },
    });
    pbus.emit("module.operation.failed", {
      module: "telegram",
      operation: "poll-loop",
      failureKind: "duplicate-consumer",
      causeKey: "getupdates-conflict",
      observedAt: NOW,
    });

    expect(signals).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ workflow: "builder" }),
        dedupeKey: "workflow:builder:failure:runtime",
        evidenceRefs: [expect.objectContaining({ kind: "run" })],
      }),
      expect.objectContaining({
        source: expect.objectContaining({ workflow: "builder" }),
        dedupeKey: "workflow:builder:failure:runtime",
        labels: expect.arrayContaining([expect.stringMatching(/^contract\//)]),
        evidenceRefs: [expect.objectContaining({ kind: "dead-letter" })],
      }),
      expect.objectContaining({
        source: expect.objectContaining({ module: "telegram" }),
        dedupeKey: "module:telegram:getupdates-conflict",
        evidenceRefs: [expect.objectContaining({ kind: "module-log" })],
      }),
    ]);

    expect(signals[1]).toMatchObject({
      severity: signals[0]!.severity,
      actionability: signals[0]!.actionability,
      labels: signals[0]!.labels,
      labelsKey: signals[0]!.labelsKey,
    });

    const firstReview = applyHealthReviewSignals({
      workspaceRoot: scopeRoot,
      signals: [signals[0]!],
      generatedAt: NOW,
      reason: "direct-workflow-failure-boundary",
    });
    const workflowReviewedAgain = applyHealthReviewSignals({
      workspaceRoot: scopeRoot,
      signals: [signals[1]!],
      generatedAt: "2026-08-13T10:01:00.000Z",
      reason: "matching-dead-letter-boundary",
    });
    expect(firstReview.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        semanticRevision: 1,
        transition: "opened",
      }),
    ]);
    expect(workflowReviewedAgain.applied).toEqual([]);
    expect(workflowReviewedAgain.projection.issues[0]).toMatchObject({
      semanticRevision: 1,
      occurrenceCount: 2,
    });

    const moduleReview = applyHealthReviewSignals({
      workspaceRoot: scopeRoot,
      signals: [signals[2]!],
      generatedAt: "2026-08-13T10:02:00.000Z",
      reason: "module-failure-boundary",
    });

    runtime.runState.compareAndSetScopeStateValue({
      scopeId: ISSUE_SOURCE_SCOPE_ID,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      expectedRevision: 0,
      value: moduleReview.projection,
      updatedAt: NOW,
    });
    pbus.emit("module.operation.recovered", {
      module: "telegram",
      operation: "poll-loop",
      observedAt: "2026-08-13T10:05:00.000Z",
    });
    expect(signals.at(-1)).toMatchObject({
      observation: "cleared",
      dedupeKey: "module:telegram:getupdates-conflict",
    });

    const signalCountBeforeProbe = signals.length;
    admit("builder-unrelated-success", "manual.retry", "unrelated-task");
    pbus.emit("workflow.completed", {
      workflow: "builder",
      runId: "builder-unrelated-success",
      status: "success",
      triggerEvent: "manual.retry",
      durationMs: 1_000,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runDir: ".kota/runs/builder-unrelated-success",
      tags: [],
    });
    expect(signals).toHaveLength(signalCountBeforeProbe);

    admit(
      "builder-direct-recovery",
      "autonomy.queue.available",
      "original-task",
    );
    pbus.emit("workflow.completed", {
      workflow: "builder",
      runId: "builder-direct-recovery",
      status: "success",
      triggerEvent: "autonomy.queue.available",
      durationMs: 1_000,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runDir: ".kota/runs/builder-direct-recovery",
      tags: [],
    });
    expect(signals.at(-1)).toMatchObject({
      observation: "cleared",
      dedupeKey: "workflow:builder:failure:runtime",
      evidenceRefs: [{
        kind: "run",
        ref: ".kota/runs/builder-direct-recovery/metadata.json",
      }],
    });
  });
});
