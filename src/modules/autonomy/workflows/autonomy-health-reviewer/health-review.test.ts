import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { withWorkflowFinalization } from "#core/workflow/run-finalization.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  emptyAutonomyIssueProjection,
  readAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { seedAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.test-helpers.js";
import { reconcileGeneratedWorkQuestion } from "#modules/autonomy/generated-work-owner-question.js";
import { materializeGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import type { GeneratedWorkQuestionProposal } from "#modules/autonomy/generated-work-proposal-types.js";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import type { AutonomyHealthReview } from "./health-review.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthAttentionDigest,
  buildAutonomyHealthReviewFromSignals,
  planAutonomyHealthReviewActions,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
import { finalizeAutonomyHealthReview } from "./health-review-finalization.js";

const NOW = "2026-06-17T12:30:00.000Z";

function signal(
  overrides: Partial<AutonomyHealthSignalInput> = {},
): ReturnType<typeof normalizeHealthSignal> {
  return normalizeHealthSignal({
    observation: "present",
    source: { kind: "workflow", id: "builder", workflow: "builder" },
    severity: "error",
    labels: ["runtime", "workflow-failure"],
    summary: "Builder hit the same typed runtime failure.",
    evidenceRefs: [{ kind: "run", ref: ".kota/runs/builder-1/metadata.json" }],
    actionability: "local-code",
    dedupeKey: "workflow:builder:runtime-failure",
    observationCount: 1,
    createdAt: NOW,
    ...overrides,
  });
}

function review(signals: ReturnType<typeof signal>[], generatedAt = NOW) {
  return buildAutonomyHealthReviewFromSignals({
    signals,
    generatedAt,
    sourceEventName: "autonomy.runtime-health.audit",
    reason: "test",
  });
}

function applyReview(workspaceRoot: string, built: AutonomyHealthReview) {
  const currentProjection = readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"));
  const plannedActions = planAutonomyHealthReviewActions({
    workspaceRoot,
    currentProjection,
    scopeRoot: workspaceRoot,
    review: built,
  });
  const finalized = applyAutonomyHealthReviewActions({
    currentProjection,
    scopeRoot: workspaceRoot,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    ),
    review: built,
    plannedActions,
  });
  seedAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"), finalized.projection);
  return finalized;
}

describe("autonomy health issue projection", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-health-review-"));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("keeps one warning ephemeral and admits the repeated observation", () => {
    const first = applyReview(
      workspaceRoot,
      review([signal({ severity: "warning", observationCount: 1 })]),
    );

    expect(first.issueTransitions).toEqual([]);
    expect(readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")).issues).toEqual([]);

    const repeated = applyReview(
      workspaceRoot,
      review(
        [signal({ severity: "warning", observationCount: 2 })],
        "2026-06-17T13:00:00.000Z",
      ),
    );

    expect(repeated.issueTransitions).toEqual([
      expect.objectContaining({ kind: "opened", requiresDecision: true }),
    ]);
    expect(readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")).issues).toHaveLength(1);
  });

  it("requests one issue decision without writing tasks or owner questions", () => {
    const actions = applyReview(
      workspaceRoot,
      review([
        signal(),
        signal({
          evidenceRefs: [
            { kind: "run", ref: ".kota/runs/builder-2/metadata.json" },
          ],
          createdAt: "2026-06-17T12:31:00.000Z",
        }),
      ]),
    );

    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "workflow:builder:runtime-failure",
        semanticRevision: 1,
        transition: "opened",
      }),
    ]);
    expect(actions.taskMutations).toEqual([]);
    expect(existsSync(join(workspaceRoot, "data", "tasks"))).toBe(false);
    expect(
      readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")).issues[0]?.evidenceRefs.map(
        (ref) => ref.ref,
      ),
    ).toEqual([
      ".kota/runs/builder-1/metadata.json",
      ".kota/runs/builder-2/metadata.json",
    ]);
  });

  it("enriches repeated evidence without another decision or attention item", () => {
    const firstReview = review([signal()]);
    applyReview(workspaceRoot, firstReview);
    const repeatedReview = review(
      [
        signal({
          evidenceRefs: [
            { kind: "run", ref: ".kota/runs/builder-2/metadata.json" },
          ],
          createdAt: "2026-06-17T13:00:00.000Z",
        }),
      ],
      "2026-06-17T13:00:00.000Z",
    );
    const repeated = applyReview(workspaceRoot, repeatedReview);

    expect(repeated.issueTransitions).toEqual([
      expect.objectContaining({ kind: "repeated", requiresDecision: false }),
    ]);
    expect(repeated.applied).toEqual([]);
    expect(
      buildAutonomyHealthAttentionDigest({ review: repeatedReview, actions: repeated }),
    ).toMatchObject({ items: [], text: "Autonomy health review (0 patterns):" });
    const issue = readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")).issues[0]!;
    expect(issue.semanticRevision).toBe(1);
    expect(issue.occurrenceCount).toBe(2);
  });

  it("plans linked question dismissal without mutating before commit", () => {
    const opened = applyReview(workspaceRoot, review([signal()]));
    const issueKey = opened.applied[0]!.issueKey;
    const queue = new OwnerQuestionQueue(
      join(workspaceRoot, ".kota", "owner-questions"),
    );
    const question = queue.enqueue({
      context: "Fixture context",
      question: "What should happen?",
      reason: "Fixture reason",
      source: "fixture",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "fixture" },
    });
    seedAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"), recordAutonomyIssueDispositions({
      current: readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")),
      updates: [{
        issueKey,
        semanticRevision: 1,
        kind: "owner-question",
        decidedAt: "2026-06-17T12:45:00.000Z",
        taskIds: [],
        ownerQuestionIds: [question.id],
      }],
    }));

    const cleared = applyReview(
      workspaceRoot,
      review(
        [
          signal({
            observation: "cleared",
            createdAt: "2026-06-17T13:00:00.000Z",
          }),
        ],
        "2026-06-17T13:00:00.000Z",
      ),
    );

    expect(cleared.ownerQuestionDismissals).toEqual([
      expect.objectContaining({ questionId: question.id, questionRevision: expect.any(String) }),
    ]);
    expect(cleared.applied).toEqual([
      expect.objectContaining({ kind: "resolved", transition: "cleared" }),
    ]);
    expect(queue.get(question.id)?.status).toBe("pending");
    expect(readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")).issues[0]?.status).toBe(
      "resolved",
    );
  });

  it.each(["generated", "existing"] as const)("clears an issue while preserving task authority for a %s owner", (owner) => {
    execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
    const opened = applyReview(workspaceRoot, review([signal()]));
    const issueKey = opened.applied[0]!.issueKey;
    const task = materializeGeneratedWorkProposal({
      workspaceRoot,
      proposal: {
        kind: "task",
        proposalKey: owner === "generated" ? `autonomy-issue:${issueKey}` : "independent:repair-owner",
        title: "Repair the generated health issue",
        priority: "p1",
        body: "## Problem\n\nThe health issue is open.\n",
        provenance: {
          source: "improver",
          runId: "improver-run",
          issueKey,
          semanticRevision: 1,
          evidenceRefs: [".kota/runs/builder-1/metadata.json"],
        },
      },
    });
    seedAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"), recordAutonomyIssueDispositions({
      current: readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")),
      updates: [{
        issueKey,
        semanticRevision: 1,
        kind: "task",
        decidedAt: "2026-06-17T12:45:00.000Z",
        taskIds: [task.taskId!],
        ownerQuestionIds: [],
      }],
    }));

    const cleared = applyReview(
      workspaceRoot,
      review(
        [signal({
          observation: "cleared",
          createdAt: "2026-06-17T13:00:00.000Z",
        })],
        "2026-06-17T13:00:00.000Z",
      ),
    );

    expect(cleared.taskMutations).toEqual(owner === "generated" ? [
      { id: task.taskId, state: "dropped" },
    ] : []);
    expect(existsSync(
      join(workspaceRoot, "data", "tasks", "archive", `${task.taskId}.md`),
    )).toBe(false);
    expect(existsSync(
      join(workspaceRoot, "data", "tasks", `${task.taskId}.md`),
    )).toBe(true);
    expect(readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")).issues[0]?.status).toBe(
      "resolved",
    );
  });

  it("retires concurrent linked questions with rollback replay while preserving pinned revisions", () => {
    const opened = applyReview(workspaceRoot, review([signal()]));
    const issueKey = opened.applied[0]!.issueKey;
    const proposal: GeneratedWorkQuestionProposal = {
      kind: "owner-question",
      proposalKey: `autonomy-issue:${issueKey}`,
      question: "Which runtime policy should apply?",
      context: "The health issue requires an owner decision.",
      reason: "Choose the recovery policy.",
      proposedAnswers: ["Retry", "Pause"],
      origin: { kind: "manual", source: "improver" },
      provenance: {
        source: "improver",
        runId: "improver-run",
        issueKey,
        semanticRevision: 1,
        evidenceRefs: [".kota/runs/builder-1/metadata.json"],
      },
    };
    const initial = materializeGeneratedWorkProposal({ workspaceRoot, proposal });
    const queue = new OwnerQuestionQueue(join(workspaceRoot, ".kota", "owner-questions"));
    const questionInput = {
      context: "Prior question",
      question: "Retry the earlier failure?",
      reason: "Earlier issue",
      source: "improver",
      answerBehavior: "record-only" as const,
      origin: { kind: "manual" as const, source: "improver" },
    };
    const answered = queue.enqueue(questionInput);
    queue.answer(answered.id, "Retry");
    const pinnedInput = { ...questionInput, dedupeKey: "generated-work:pinned-question" };
    const pinned = queue.enqueue(pinnedInput);
    seedAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"), recordAutonomyIssueDispositions({
      current: readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota")),
      updates: [{
        issueKey,
        semanticRevision: 1,
        kind: "owner-question",
        decidedAt: NOW,
        taskIds: [],
        ownerQuestionIds: [initial.ownerQuestionId!, answered.id, pinned.id],
      }],
    }));
    const history = queue.list();
    const clearReview = review([signal({
      observation: "cleared",
      createdAt: "2026-06-17T13:00:00.000Z",
    })], "2026-06-17T13:00:00.000Z");
    const currentProjection = readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"));
    const cleared = applyAutonomyHealthReviewActions({
      currentProjection, ownerQuestionQueue: queue, review: clearReview,
      plannedActions: planAutonomyHealthReviewActions({
        workspaceRoot, currentProjection, review: clearReview,
      }),
    });

    expect(cleared.ownerQuestionDismissals).toHaveLength(2);
    expect(cleared.ownerQuestionDismissals).toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: initial.ownerQuestionId, questionRevision: expect.any(String) }),
      expect.objectContaining({ questionId: pinned.id, questionRevision: expect.any(String) }),
    ]));
    expect(queue.list()).toEqual(history);
    const stateDir = join(workspaceRoot, ".kota");
    const runId = "health-review-finalize";
    writeAutonomyHealthReviewArtifact(join(stateDir, "runs", runId), {
      generatedAt: clearReview.generatedAt, review: clearReview, actions: cleared,
    });
    const revised = reconcileGeneratedWorkQuestion({
      workspaceRoot, queue, input: { ...pinnedInput, question: "Retry with the revised policy?" },
    });
    const concurrent = queue.enqueue({ ...questionInput, question: "Retry the concurrent failure?" });
    seedAutonomyIssueProjection(workspaceRoot, stateDir, recordAutonomyIssueDispositions({
      current: currentProjection,
      updates: [{
        issueKey, semanticRevision: 1, kind: "owner-question", decidedAt: NOW, taskIds: [],
        ownerQuestionIds: [initial.ownerQuestionId!, answered.id, pinned.id, concurrent.id],
      }],
    }));
    // Another publisher commits after artifact planning; finalization must retain it.
    applyReview(workspaceRoot, review([signal({ dedupeKey: "workflow:other:failure" })]));
    const beforeFinalization = readAutonomyIssueProjection(workspaceRoot, stateDir);
    let database = new RunStateDatabase(stateDir);
    const scopeId = database.getScopeIdByRootPath(workspaceRoot)!;
    const { epoch } = database.beginDaemonSession(NOW);
    database.admitRun({
      id: runId, scopeId, workflow: "autonomy-health-reviewer", repository: "read",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: [], admittedAt: NOW,
    });
    database.startRun(runId, epoch, NOW);
    const finish = (crash: boolean) => {
      const outcome = withWorkflowFinalization({ kind: "terminal" as const, state: "succeeded" as const, finalize: undefined as (() => void) | undefined }, {
        definition: { finalize: finalizeAutonomyHealthReview },
        run: database.getRun(runId)!, store: database, stateDir, stepOutputs: {},
        pbus: { prepareDynamic: (_event, payload) => payload },
      });
      database.finishRun(runId, epoch, "succeeded", NOW, undefined, undefined, undefined, () => {
        outcome.finalize?.();
        if (crash) throw new Error("crash before commit");
      });
    };
    expect(() => finish(true)).toThrow("crash before commit");
    expect(queue.get(initial.ownerQuestionId!)?.status).toBe("dismissed");
    expect(queue.get(concurrent.id)?.status).toBe("dismissed");
    expect(queue.get(pinned.id)).toEqual(revised.item);
    expect(readAutonomyIssueProjection(workspaceRoot, stateDir)).toEqual(beforeFinalization);
    expect(database.getRun(runId)?.state).toBe("running");
    expect(database.listPendingPublications()).toEqual([]);
    database.close();
    database = new RunStateDatabase(stateDir);
    const historyBeforeReplay = queue.list();
    try {
      finish(false);
      expect(database.getRun(runId)?.state).toBe("succeeded");
      expect(database.listPendingPublications().map((entry) => entry.event)).toEqual([
        "workflow.attention.digest",
        "owner.question.resolved", "owner.question.dismissed", "owner.question.changed",
        "owner.question.resolved", "owner.question.dismissed", "owner.question.changed",
      ]);
      expect(queue.list()).toEqual(historyBeforeReplay);
      const finalProjection = readAutonomyIssueProjection(workspaceRoot, stateDir);
      expect(finalProjection.issues.find((issue) => issue.issueKey === issueKey)).toMatchObject({
        status: "resolved", links: { ownerQuestionIds: [] },
      });
      expect(finalProjection.issues.filter((issue) => issue.issueKey !== issueKey)).toEqual(
        beforeFinalization.issues.filter((issue) => issue.issueKey !== issueKey),
      );
    } finally {
      database.close();
    }
    const retired = queue.get(initial.ownerQuestionId!);
    const renewed = materializeGeneratedWorkProposal({ workspaceRoot, proposal });
    expect(renewed.actions).toEqual([
      { kind: "reopened-owner-question", questionId: renewed.ownerQuestionId },
    ]);
    expect(renewed.ownerQuestionId).not.toBe(initial.ownerQuestionId);
    expect(queue.get(initial.ownerQuestionId!)).toEqual(retired);
    expect(queue.get(answered.id)).toEqual(history.find((item) => item.id === answered.id));
    expect(queue.list("pending").map((item) => item.id)).toEqual([pinned.id, renewed.ownerQuestionId]);
  });

  it("persists bounded projected evidence instead of raw runtime text", () => {
    const runtimeText = "raw runtime detail that must not be copied";
    const built = review([
      signal({
        summary: runtimeText,
        evidenceRefs: [{
          kind: "run",
          ref: ".kota/runs/builder-1/metadata.json",
          summary: runtimeText,
        }],
      }),
    ]);
    const actions = planAutonomyHealthReviewActions({
      workspaceRoot,
      currentProjection: emptyAutonomyIssueProjection(),
      scopeRoot: workspaceRoot,
      review: built,
    });
    const path = writeAutonomyHealthReviewArtifact(
      join(workspaceRoot, ".kota", "runs", "health-review"),
      { generatedAt: NOW, review: built, actions },
    );
    const persisted = readFileSync(path, "utf-8");

    expect(persisted).toContain(".kota/runs/builder-1/metadata.json");
    expect(persisted).not.toContain(runtimeText);
  });
});
