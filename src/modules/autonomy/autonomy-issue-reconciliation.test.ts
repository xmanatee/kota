import { describe, expect, it } from "vitest";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { StoredRun } from "#core/workflow/run-state-database.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";
import {
  planAutonomyIssueOwnerReconciliation,
  publishExhaustedInvestigationAttention,
} from "./autonomy-issue-reconciliation.js";

const NOW = "2026-09-03T10:00:00.000Z";

function openProjection() {
  const first = buildAutonomyIssueObservation({
    kind: "present",
    rootCauseKey: "module:telegram:getupdates-conflict",
    observedAt: NOW,
    signalIds: ["health-telegram-1"],
    source: { kind: "module", id: "telegram", module: "telegram" },
    severity: "error",
    actionability: "local-code",
    labels: ["module-failure", "telegram"],
    summaries: ["Telegram channel operation failed."],
    evidenceRefs: [{
      kind: "module-log",
      ref: ".kota/modules/telegram/logs.jsonl",
    }],
    observationCount: 1,
  });
  const repeated = buildAutonomyIssueObservation({
    ...first,
    kind: "present",
    observedAt: "2026-09-03T10:30:00.000Z",
    signalIds: ["health-telegram-2"],
    observationCount: 43,
  });
  return applyAutonomyIssueObservations({
    current: emptyAutonomyIssueProjection(),
    observations: [first, repeated],
  }).projection;
}

function improverRun(
  id: string,
  state: StoredRun["state"],
  issueKey: string,
  semanticRevision: number,
): StoredRun {
  return {
    id,
    scopeId: "scope-a",
    workflow: "improver",
    trigger: {
      event: "autonomy.issue.decision-requested",
      schemaRef: null,
      payload: { issueKey, semanticRevision },
    },
    repository: "write",
    state,
    resources: [],
    admittedAt: NOW,
    attempt: 1,
    processes: [],
  };
}

describe("autonomy issue disposition-owner reconciliation", () => {
  it("re-admits one failed investigation for the unchanged semantic revision", () => {
    const projection = openProjection();
    const issue = projection.issues[0]!;
    const failed = improverRun(
      "2026-09-01T20-18-58-775Z-improver-zxg0n9",
      "failed",
      issue.issueKey,
      issue.semanticRevision,
    );

    const requests = planAutonomyIssueOwnerReconciliation({
      projection,
      runs: [failed],
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T11:00:00.000Z",
    });

    expect(issue.semanticRevision).toBe(1);
    expect(issue.occurrenceCount).toBe(44);
    expect(requests).toEqual([expect.objectContaining({
      issueKey: issue.issueKey,
      semanticRevision: 1,
      transition: "replayed",
      requestKind: "reconciliation",
      idempotencyKey:
        `autonomy-issue-investigation:${issue.issueKey}:1:1`,
      phase: "retrying-investigation",
    })]);

    const queuedRetry = improverRun(
      "2026-09-03T11-00-00-000Z-improver-retry",
      "queued",
      issue.issueKey,
      issue.semanticRevision,
    );
    expect(planAutonomyIssueOwnerReconciliation({
      projection,
      runs: [failed, queuedRetry],
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T11:01:00.000Z",
    })).toEqual([]);
  });

  it("keeps one durable repair or owner question as the current owner", () => {
    const projection = openProjection();
    const issue = projection.issues[0]!;
    const task: RepoTaskFullRecord = {
      id: "task-generated-repair",
      title: "Repair Telegram delivery",
      state: "done",
      priority: null,
      body: "Repair complete; original signal still needs a clear probe.",
      dependsOn: [],
    };
    const taskProjection = recordAutonomyIssueDispositions({
      current: projection,
      updates: [{
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        kind: "task",
        decidedAt: NOW,
        taskIds: [task.id],
        ownerQuestionIds: [],
      }],
    });
    expect(planAutonomyIssueOwnerReconciliation({
      projection: taskProjection,
      runs: [],
      tasks: [task],
      questions: [],
      requestedAt: "2026-09-03T11:00:00.000Z",
    })).toEqual([]);

    expect(planAutonomyIssueOwnerReconciliation({
      projection: taskProjection,
      runs: [],
      tasks: [],
      questions: [],
      requestedAt: NOW,
    })).toEqual([expect.objectContaining({
      issueKey: issue.issueKey,
      phase: "awaiting-investigation",
    })]);

    const question: PendingOwnerQuestion = {
      id: "question-1",
      seq: 1,
      dedupeKey: "generated-work:telegram",
      context: "Telegram setup is unavailable.",
      question: "Which credential should KOTA use?",
      reason: "Owner authority is required.",
      source: "improver",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "fixture" },
      createdAt: NOW,
      status: "pending",
    };
    const questionProjection = recordAutonomyIssueDispositions({
      current: projection,
      updates: [{
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        kind: "owner-question",
        decidedAt: NOW,
        taskIds: [],
        ownerQuestionIds: [question.id],
      }],
    });
    expect(planAutonomyIssueOwnerReconciliation({
      projection: questionProjection,
      runs: [],
      tasks: [],
      questions: [question],
      requestedAt: "2026-09-03T11:00:00.000Z",
    })).toEqual([]);
  });

  it("re-admits a completed investigation only when disposition publication is absent", () => {
    const projection = openProjection();
    const issue = projection.issues[0]!;
    const completed = improverRun(
      "2026-09-03T11-00-00-000Z-improver-complete",
      "succeeded",
      issue.issueKey,
      issue.semanticRevision,
    );
    const requests = planAutonomyIssueOwnerReconciliation({
      projection,
      runs: [completed],
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T11:00:00.000Z",
    });
    expect(requests).toEqual([
      expect.objectContaining({
        issueKey: issue.issueKey,
        idempotencyKey:
          `autonomy-issue-investigation:${issue.issueKey}:1:1`,
      }),
    ]);

    const publication: StoredRun = {
      ...completed,
      id: "2026-09-03T11-01-00-000Z-improver-publication",
      workflow: "improver-disposition-publication",
      state: "queued",
      trigger: {
        event: "autonomy.improver.disposition-publication-requested",
        schemaRef: null,
        payload: { sourceRunId: completed.id },
      },
    };
    expect(planAutonomyIssueOwnerReconciliation({
      projection,
      runs: [completed, publication],
      tasks: [],
      questions: [],
      requestedAt: NOW,
    })).toEqual([]);
  });

  it("backs off failures and publishes durable attention after three terminal attempts", () => {
    const projection = openProjection();
    const issue = projection.issues[0]!;
    const attention = {
      ...improverRun("improver-attention", "needs_attention", issue.issueKey, 1),
      admittedAt: "2026-09-03T10:40:00.000Z",
    };
    expect(planAutonomyIssueOwnerReconciliation({
      projection,
      runs: [attention],
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T10:41:00.000Z",
    })).toEqual([expect.objectContaining({
      idempotencyKey: `autonomy-issue-investigation:${issue.issueKey}:1:1`,
      notBeforeAt: "2026-09-03T10:45:00.000Z",
      phase: "retrying-investigation",
    })]);
    expect(planAutonomyIssueOwnerReconciliation({
      projection,
      runs: [attention],
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T10:46:00.000Z",
    })).toEqual([expect.objectContaining({
      idempotencyKey: `autonomy-issue-investigation:${issue.issueKey}:1:1`,
    })]);

    const attempts = [0, 1, 2].map((index) => ({
      ...improverRun(`failed-${index}`, "failed", issue.issueKey, 1),
      admittedAt: `2026-09-03T0${7 + index}:00:00.000Z`,
    }));
    expect(planAutonomyIssueOwnerReconciliation({
      projection,
      runs: attempts,
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T12:00:00.000Z",
    })).toEqual([]);

    const attended = publishExhaustedInvestigationAttention({
      projection,
      runs: attempts,
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T12:00:00.000Z",
    });
    expect(attended.issues[0]).toMatchObject({
      status: "open",
      disposition: {
        kind: "attention",
        semanticRevision: issue.semanticRevision,
      },
    });
    expect(publishExhaustedInvestigationAttention({
      projection: attended,
      runs: attempts,
      tasks: [],
      questions: [],
      requestedAt: "2026-09-03T12:01:00.000Z",
    })).toBe(attended);
  });
});
