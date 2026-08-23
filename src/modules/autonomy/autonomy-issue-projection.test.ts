import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  readAutonomyIssueProjection,
  rebuildAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
  recordAutonomyIssueRecoveryDisposition,
} from "./autonomy-issue-projection.js";
import { initializeAutonomyIssueProjection } from "./autonomy-issue-projection-rebuild.js";
import type {
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
} from "./health-signal.js";

const ROOT_CAUSE = "workflow:builder:runtime-warning";

function observation(args: {
  kind?: AutonomyHealthObservation;
  runId: string;
  observedAt: string;
  severity?: AutonomyHealthSeverity;
  rootCauseKey?: string;
  evidenceKind?: "run" | "dead-letter" | "artifact";
  evidenceRef?: string;
}) {
  return buildAutonomyIssueObservation({
    kind: args.kind ?? "present",
    rootCauseKey: args.rootCauseKey ?? ROOT_CAUSE,
    observedAt: args.observedAt,
    signalIds: [`health-${args.runId}`],
    source: { kind: "workflow", id: "builder", workflow: "builder" },
    severity: args.severity ?? "warning",
    actionability: "local-code",
    labels: ["runtime"],
    summaries: ["Builder repeatedly hit the same runtime root cause."],
    evidenceRefs: [
      {
        kind: args.evidenceKind ?? "run",
        ref: args.evidenceRef ?? `.kota/runs/${args.runId}/metadata.json`,
      },
    ],
    observationCount: 1,
  });
}

describe("durable autonomy issue projection", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-autonomy-issues-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("opens, repeats, revises, clears, reopens, and deduplicates replay", () => {
    const opened = observation({
      runId: "run-1",
      observedAt: "2026-06-17T12:00:00.000Z",
    });
    const repeated = observation({
      runId: "run-2",
      observedAt: "2026-06-17T13:00:00.000Z",
    });
    const revised = observation({
      kind: "changed",
      runId: "run-3",
      observedAt: "2026-06-17T14:00:00.000Z",
      severity: "error",
    });
    const cleared = observation({
      kind: "cleared",
      runId: "clear-1",
      observedAt: "2026-06-17T15:00:00.000Z",
      severity: "error",
    });
    const reopened = observation({
      runId: "run-4",
      observedAt: "2026-06-17T16:00:00.000Z",
      severity: "error",
    });

    const result = applyAutonomyIssueObservations({
      projectDir,
      observations: [opened, repeated, revised, cleared, reopened, reopened],
    });

    expect(result.transitions.map((transition) => transition.kind)).toEqual([
      "opened",
      "repeated",
      "revised",
      "cleared",
      "reopened",
      "replayed",
    ]);
    const issue = result.projection.issues[0]!;
    expect(issue.issueKey).toBe(opened.issueKey);
    expect(issue.status).toBe("needs-decision");
    expect(issue.semanticRevision).toBe(3);
    expect(issue.occurrenceCount).toBe(4);
    expect(issue.evidenceRefs.map((ref) => ref.ref)).toEqual([
      ".kota/runs/run-1/metadata.json",
      ".kota/runs/run-2/metadata.json",
      ".kota/runs/run-3/metadata.json",
      ".kota/runs/run-4/metadata.json",
    ]);
  });

  it("keeps unrelated issues open across partial batches", () => {
    const first = observation({
      runId: "builder-1",
      observedAt: "2026-06-17T12:00:00.000Z",
    });
    const unrelated = observation({
      rootCauseKey: "module:telegram:getupdates-conflict",
      runId: "telegram-1",
      observedAt: "2026-06-17T13:00:00.000Z",
    });
    applyAutonomyIssueObservations({ projectDir, observations: [first] });
    applyAutonomyIssueObservations({ projectDir, observations: [unrelated] });

    const projection = readAutonomyIssueProjection(projectDir);
    expect(projection.issues).toHaveLength(2);
    expect(
      projection.issues.find((issue) => issue.issueKey === first.issueKey)?.status,
    ).toBe("needs-decision");
  });

  it("persists task, owner-question, DLQ, and recovery links across restart", () => {
    const observed = observation({
      runId: "recovery-1",
      observedAt: "2026-06-17T12:00:00.000Z",
      evidenceKind: "dead-letter",
      evidenceRef: ".kota/dead-letter-queue/items.json#dlq-1",
    });
    applyAutonomyIssueObservations({
      projectDir,
      observations: [observed],
    });
    recordAutonomyIssueDispositions({
      projectDir,
      updates: [
        {
          issueKey: observed.issueKey,
          kind: "owner-question",
          decidedAt: "2026-06-17T13:01:00.000Z",
          taskIds: ["task-health-builder-runtime-warning"],
          ownerQuestionIds: ["question-1"],
        },
        {
          issueKey: observed.issueKey,
          kind: "task",
          decidedAt: "2026-06-17T13:01:30.000Z",
          taskIds: ["task-health-builder-follow-up"],
          ownerQuestionIds: [],
        },
      ],
    });
    recordAutonomyIssueRecoveryDisposition({
      projectDir,
      taskId: "task-health-builder-follow-up",
      recoveryDispositionRef:
        ".kota/runs/recovery-2/workflow-state-recovery.json",
      recordedAt: "2026-06-17T13:02:00.000Z",
    });

    const restarted = readAutonomyIssueProjection(projectDir).issues[0]!;
    expect(restarted.links).toEqual({
      taskIds: ["task-health-builder-follow-up"],
      ownerQuestionIds: [],
      deadLetterIds: ["dlq-1"],
      recoveryDispositionRefs: [".kota/runs/recovery-2/workflow-state-recovery.json"],
    });
    expect(restarted.status).toBe("open");
  });

  it("rebuilds the same issue identity and semantic lifecycle from observations", () => {
    const observations = [
      observation({
        runId: "run-1",
        observedAt: "2026-06-17T12:00:00.000Z",
      }),
      observation({
        runId: "run-2",
        observedAt: "2026-06-17T13:00:00.000Z",
      }),
      observation({
        kind: "changed",
        runId: "run-3",
        observedAt: "2026-06-17T14:00:00.000Z",
        severity: "error",
      }),
    ];
    const first = applyAutonomyIssueObservations({ projectDir, observations });
    const rebuilt = rebuildAutonomyIssueProjection({ projectDir, observations });

    expect(rebuilt.projection).toEqual(first.projection);
  });

  it("rebuilds all historical unresolved issues once instead of treating the latest review as current", () => {
    const writeReview = (args: {
      runId: string;
      generatedAt: string;
      dedupeKey: string;
      action: Record<string, string>;
    }) => {
      const runDir = join(projectDir, ".kota", "runs", args.runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, "autonomy-health-review.json"),
        JSON.stringify({
          generatedAt: args.generatedAt,
          review: {
            groups: [
              {
                dedupeKey: args.dedupeKey,
                labels: ["runtime"],
                source: { kind: "workflow", id: "builder" },
                severity: "warning",
                actionability:
                  args.action.kind === "owner-question"
                    ? "owner-action"
                    : "local-code",
                signalCount: 1,
                observationCount: 1,
                signalIds: [`health-${args.runId}`],
                summaries: ["Historical health evidence."],
                evidenceRefs: [
                  {
                    kind: "run",
                    ref: `.kota/runs/${args.runId}/metadata.json`,
                  },
                ],
              },
            ],
          },
          actions: {
            applied: [{ ...args.action, dedupeKey: args.dedupeKey }],
          },
        }),
        "utf-8",
      );
    };
    writeReview({
      runId: "review-owner",
      generatedAt: "2026-06-17T12:00:00.000Z",
      dedupeKey: "module:telegram:getupdates-conflict",
      action: { kind: "owner-question", questionId: "question-1" },
    });
    writeReview({
      runId: "review-builder",
      generatedAt: "2026-06-17T13:00:00.000Z",
      dedupeKey: ROOT_CAUSE,
      action: {
        kind: "created-task",
        taskId: "task-health-workflow-builder-runtime-warning",
      },
    });

    initializeAutonomyIssueProjection(projectDir);
    const projection = readAutonomyIssueProjection(projectDir);

    expect(projection.issues).toHaveLength(2);
    expect(
      projection.issues.find(
        (issue) => issue.rootCauseKey === "module:telegram:getupdates-conflict",
      ),
    ).toMatchObject({
      status: "needs-decision",
      links: { ownerQuestionIds: ["question-1"] },
    });
    expect(
      projection.issues.find((issue) => issue.rootCauseKey === ROOT_CAUSE),
    ).toMatchObject({
      status: "open",
      links: {
        taskIds: ["task-health-workflow-builder-runtime-warning"],
      },
    });

    writeReview({
      runId: "review-ignored-after-migration",
      generatedAt: "2026-06-17T14:00:00.000Z",
      dedupeKey: "workflow:improver:new-warning",
      action: { kind: "attention" },
    });
    initializeAutonomyIssueProjection(projectDir);
    expect(readAutonomyIssueProjection(projectDir).issues).toHaveLength(2);
  });
});
