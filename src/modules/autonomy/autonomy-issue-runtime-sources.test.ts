import { mkdtempSync, rmSync } from "node:fs";
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
});
