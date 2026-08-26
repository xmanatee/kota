import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowDispatchDeadLetter } from "#core/daemon/dead-letter-queue.js";
import {
  EventedDeadLetterQueueStore,
  scopedDeadLetterChangedPublisher,
} from "#core/daemon/dead-letter-queue-events.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import {
  applyHealthReviewSignals,
  ISSUE_SOURCE_SCOPE_ID,
  wireAutonomyIssueSourceFixture,
} from "./autonomy-issue-sources.test-helpers.js";
import type { AutonomyHealthSignal } from "./health-signal.js";

const NOW = "2026-08-13T10:00:00.000Z";

describe("runtime-owned autonomy issue observations", () => {
  let scopeRoot: string;
  let pbus: ScopedEventBus;
  let signals: AutonomyHealthSignal[];

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-issue-runtime-sources-"));
    ({ pbus, signals } = wireAutonomyIssueSourceFixture(scopeRoot));
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("links the retained progress-reviewer incident runs until every canonical item is terminal", () => {
    const store = new EventedDeadLetterQueueStore(
      join(scopeRoot, ".kota", "dead-letter-queue"),
      () => new Date(NOW),
      scopedDeadLetterChangedPublisher(pbus),
    );
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
          scopeRoot,
          signals: [signal],
          generatedAt: signal.createdAt,
          reason,
        });
        applied.push(...result.applied);
      }
      processedSignalCount = signals.length;
    };
    for (const runId of productionRunIds) {
      pbus.emit("workflow.failure.alert", {
        workflow: "progress-reviewer",
        runId,
        status: "failed",
        durationMs: 1_000,
        errorSummary: failureReason,
        text: "progress-reviewer failed",
      });
      projectNewSignals("immediate-critical-failure");
    }
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
      [...productionRunIds, ...productionRunIds].map(() => "present"),
    );
    expect(new Set(signals.map((signal) => signal.dedupeKey)).size).toBe(1);
    expect(applied.filter((action) => action.kind === "decision-requested")).toEqual([
      expect.objectContaining({ kind: "decision-requested", transition: "opened" }),
    ]);
    expect(readAutonomyIssueProjection(scopeRoot).issues[0]).toMatchObject({
      semanticRevision: 1,
      occurrenceCount: 8,
    });
    store.dismiss(items.at(-1)!.id, "Fixed by commit 532ab1ae");
    projectNewSignals("final-dead-letter-dismissal");

    expect(signals.map((signal) => signal.observation)).toEqual([
      ...[...productionRunIds, ...productionRunIds].map(() => "present"),
      "cleared",
    ]);
    expect(signals[4]?.evidenceRefs[0]?.ref).toContain(items[0]!.id);
    expect(signals.at(-1)?.evidenceRefs.map((ref) => ref.ref).sort()).toEqual(
      items.map((item) => `.kota/dead-letter-queue/items.json#${item.id}`).sort(),
    );
    expect(signals.at(-1)?.summary).toContain("commit 532ab1ae");
    expect(applied.at(-1)).toMatchObject({ kind: "resolved", transition: "cleared" });
    const issue = readAutonomyIssueProjection(scopeRoot).issues[0]!;
    expect(issue.status).toBe("resolved");
    expect(issue.occurrenceCount).toBe(8);
    expect(issue.links.deadLetterIds).toEqual(items.map((item) => item.id).sort());
  });

  it("publishes trajectory diagnostics when their owning step completes", () => {
    const artifactPath = join(
      scopeRoot,
      ".kota",
      "runs",
      "builder-run",
      "steps",
      "build.trajectory-diagnostics.json",
    );
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        version: 1,
        status: "supported",
        emitsAgentMessageStream: true,
        counts: {
          warningCount: 1,
          unsupportedTrajectoryCount: 0,
          missingStreamingFramesCount: 0,
          missingFinalVerificationAfterEditCount: 1,
          repeatedIdenticalFailingCommandCount: 0,
          editAfterSuccessfulVerificationCount: 0,
          longPreambleWithoutTaskTouchCount: 0,
        },
        diagnostics: [{
          code: "missing_final_verification_after_edit",
          severity: "warning",
          summary: "A file edit was not followed by verification.",
          frameIndexes: [8],
          details: ["lastEditFrame=8"],
        }],
      }),
      "utf-8",
    );

    pbus.emit("workflow.step.completed", {
      workflow: "builder",
      runId: "builder-run",
      stepId: "build",
      stepType: "agent",
      status: "success",
      durationMs: 1000,
      runDir: ".kota/runs/builder-run",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trajectoryDiagnostics: {
        artifactPath,
        warningCount: 1,
        unsupportedTrajectoryCount: 0,
        missingStreamingFramesCount: 0,
        missingFinalVerificationAfterEditCount: 1,
        repeatedIdenticalFailingCommandCount: 0,
        editAfterSuccessfulVerificationCount: 0,
        longPreambleWithoutTaskTouchCount: 0,
      },
    });

    expect(signals).toEqual([
      expect.objectContaining({
        dedupeKey:
          "workflow:builder:trajectory:build:missing_final_verification_after_edit",
        summary: "A file edit was not followed by verification.",
      }),
    ]);
  });

  it("publishes thin scrutiny from the review step that owns the record", () => {
    const runDir = join(scopeRoot, ".kota", "runs", "review-run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "review-scrutiny.json"),
      JSON.stringify({
        runId: "review-run",
        workflow: "builder",
        surface: "critic",
        taskId: "task-reviewed",
        thinAcceptance: true,
        generatedAt: NOW,
      }),
      "utf-8",
    );

    pbus.emit("workflow.step.completed", {
      workflow: "builder",
      runId: "review-run",
      stepId: "critic",
      stepType: "code",
      status: "success",
      durationMs: 100,
      runDir,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    });

    expect(signals).toEqual([
      expect.objectContaining({
        dedupeKey: "review-scrutiny:critic:builder:task-reviewed",
        source: expect.objectContaining({ kind: "review", id: "critic" }),
      }),
    ]);
  });
});
