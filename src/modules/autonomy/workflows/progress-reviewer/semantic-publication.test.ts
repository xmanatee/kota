import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { materializeGeneratedWorkProposal, stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  progressReviewOwnerQuestionProposal,
  progressReviewResolutionProposal,
  progressReviewTaskProposal,
} from "./progress-review/action-writers.js";
import { applyProgressReviewActions } from "./progress-review/actions.js";
import type { ProgressReviewAgentOutput } from "./progress-review.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./progress-review.js";
import type { ProgressReviewSemanticInput } from "./semantic-input.js";
import { decodeProgressReviewConsumptionState, emptyProgressReviewConsumptionState } from "./semantic-input-state.js";
import { publishProgressReview } from "./semantic-publication.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeReview(
  scopeRoot: string,
  sourceRunId: string,
  revision: number | null,
  overrides: Partial<ProgressReviewAgentOutput> = {},
  generatedAt = "2026-09-07T12:00:00.000Z",
) {
  const runDir = join(scopeRoot, ".kota", "runs", sourceRunId);
  mkdirSync(runDir, { recursive: true });
  const semanticInput: ProgressReviewSemanticInput = {
    automatic: revision !== null,
    shouldReview: true,
    boundary: revision === null ? "explicit-request" : "parked-queue",
    inputRevision: revision,
    evidenceRefs: [],
    reason: "Review owner direction",
    deliveryAttempt: 0,
  };
  const review: ProgressReviewAgentOutput = {
    verdict: "needs-steering",
    summary: "Owner direction is needed",
    findings: {
      crossScope: { claims: [], followUpTasks: [] },
      localScope: { claims: [], followUpTasks: [] },
    },
    ownerQuestions: [{
      topicKey: "owner-direction",
      question: `Should we pursue ${sourceRunId}?`,
      reason: "The evidence requires owner direction",
      evidenceIds: [],
      proposedAnswers: [],
    }],
    ...overrides,
  };
  writeFileSync(join(runDir, PROGRESS_REVIEW_ARTIFACT), JSON.stringify({
    generatedAt,
    evidence: { semanticInput },
    review,
  }));
  return review;
}

it.each([false, true])("reconciles delayed task publication against canonical disposition (retired: %s)", (retired) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-disposition-"));
  roots.push(scopeRoot);
  writeReview(scopeRoot, "original-question", null);
  publishProgressReview({
    scopeRoot,
    sourceRunId: "original-question",
    currentState: emptyProgressReviewConsumptionState(scopeRoot),
  });
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  const originalQuestion = queue.list("pending")[0]!;
  const task = {
    topicKey: "owner-direction",
    title: "Implement the agreed direction",
    priority: "p1" as const,
    problem: "The review found actionable implementation work",
    howWeWillKnow: "The agreed behavior is observable",
    evidenceIds: [],
  };
  const review = writeReview(scopeRoot, "delayed-task", 1, {
    findings: {
      crossScope: { claims: [], followUpTasks: [] },
      localScope: { claims: [], followUpTasks: [task] },
    },
    ownerQuestions: [],
  });
  stageGeneratedWorkProposal({
    workspaceRoot: scopeRoot,
    proposal: progressReviewTaskProposal({ runId: "delayed-task", review, task }),
  });
  expect(listFullRepoTasks(scopeRoot).map((record) => record.state)).toEqual(["open"]);
  expect(queue.get(originalQuestion.id)?.status).toBe("pending");

  const newer = writeReview(scopeRoot, "newer-question", 2, {
    ownerQuestions: [{
      topicKey: retired ? "owner-direction" : "unrelated-direction",
      question: "Which direction should we choose next?",
      reason: "New evidence needs an owner decision",
      evidenceIds: [],
      proposedAnswers: [],
    }],
  });
  stageGeneratedWorkProposal({
    workspaceRoot: scopeRoot,
    proposal: progressReviewOwnerQuestionProposal({
      runId: "newer-question",
      question: newer.ownerQuestions[0]!,
    }),
  });
  const published = publishProgressReview({
    scopeRoot,
    sourceRunId: "newer-question",
    currentState: emptyProgressReviewConsumptionState(scopeRoot),
  });
  const delayed = publishProgressReview({
    scopeRoot,
    sourceRunId: "delayed-task",
    currentState: published.nextState,
  });
  expect(delayed.nextState).toEqual(published.nextState);
  expect(delayed.nextState.lastConsumedRevision).toBe(2);
  expect(listFullRepoTasks(scopeRoot).map((record) => record.state)).toEqual([
    retired ? "dropped" : "open",
  ]);
  expect(queue.get(originalQuestion.id)?.status).toBe(retired ? "pending" : "dismissed");
  expect(queue.list("pending").map((question) => question.question)).toEqual([
    "Which direction should we choose next?",
  ]);
  const settled = queue.list();
  publishProgressReview({ scopeRoot, sourceRunId: "delayed-task", currentState: delayed.nextState });
  expect(queue.list()).toEqual(settled);
});

it.each([1, 2])("preserves an owner's answer when automatic revision %s arrives after revision 2", (revision) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-publication-"));
  roots.push(scopeRoot);
  writeReview(scopeRoot, "current-review", 2);
  writeReview(scopeRoot, "delayed-review", revision);
  const published = publishProgressReview({
    scopeRoot,
    sourceRunId: "current-review",
    currentState: emptyProgressReviewConsumptionState(scopeRoot),
  });
  expect(published.nextState.lastConsumedRevision).toBe(2);
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  const question = queue.list("pending")[0]!;
  expect(question.question).toBe("Should we pursue current-review?");
  queue.answer(question.id, "Proceed", "owner");
  const answered = queue.list();

  const delayed = publishProgressReview({
    scopeRoot,
    sourceRunId: "delayed-review",
    currentState: published.nextState,
  });
  expect(delayed.nextState).toEqual(published.nextState);
  expect(queue.list()).toEqual(answered);
  expect(queue.list("pending")).toEqual([]);
});

it("publishes explicit owner requests without advancing the automatic watermark", () => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-explicit-"));
  roots.push(scopeRoot);
  writeReview(scopeRoot, "explicit-review", null);
  const currentState = { ...emptyProgressReviewConsumptionState(scopeRoot), lastConsumedRevision: 2 };
  const result = publishProgressReview({ scopeRoot, sourceRunId: "explicit-review", currentState });
  expect(result.nextState.lastConsumedRevision).toBe(currentState.lastConsumedRevision);
  expect(result.nextState.consumedExplicitRunIds).toEqual(["explicit-review"]);
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  expect(queue.list("pending").map((question) => question.question)).toEqual([
    "Should we pursue explicit-review?",
  ]);
});


it.each(["unrelated", "question", "task", "resolved"].flatMap((newerKind) =>
  [false, true].map((completed) => ({ newerKind, completed })),
))("completes a delayed disposition unless superseded by $newerKind (completed: $completed)", ({ newerKind, completed }) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-retirement-"));
  roots.push(scopeRoot);
  const task = {
    topicKey: "owner-direction", title: "Implement the direction", priority: "p1" as const,
    problem: "Implementation is needed", howWeWillKnow: "The behavior is observable", evidenceIds: [],
  };
  const original = writeReview(scopeRoot, "original-task", null, {
    findings: { crossScope: { claims: [], followUpTasks: [] }, localScope: { claims: [], followUpTasks: [task] } },
    ownerQuestions: [],
  });
  stageGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal: progressReviewTaskProposal({ runId: "original-task", review: original, task }) });
  if (completed) moveTaskById(scopeRoot, listFullRepoTasks(scopeRoot)[0]!.id, "done");
  const delayed = writeReview(scopeRoot, "delayed-question", 1);
  stageGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal: progressReviewOwnerQuestionProposal({ runId: "delayed-question", question: delayed.ownerQuestions[0]! }) });
  expect(listFullRepoTasks(scopeRoot).map((item) => item.state)).toEqual([completed ? "done" : "dropped"]);
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  expect(queue.list()).toEqual([]);
  const newer = writeReview(scopeRoot, "newer-review", 2, newerKind === "task" ? {
    findings: original.findings, ownerQuestions: [],
  } : newerKind === "resolved" ? {
    ownerQuestions: [], resolutions: [{ topicKey: "owner-direction", reason: "The finding is resolved", evidenceIds: [] }],
  } : {
    ownerQuestions: [{ ...delayed.ownerQuestions[0]!, topicKey: newerKind === "unrelated" ? "unrelated" : "owner-direction", question: "A newer decision" }],
  });
  if (newerKind === "task") {
    stageGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal: progressReviewTaskProposal({ runId: "newer-review", review: newer, task }) });
  } else if (newerKind === "resolved") {
    stageGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal: progressReviewResolutionProposal(newer.resolutions![0]!) });
  } else {
    stageGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal: progressReviewOwnerQuestionProposal({ runId: "newer-review", question: newer.ownerQuestions[0]! }) });
  }
  const current = publishProgressReview({ scopeRoot, sourceRunId: "newer-review", currentState: emptyProgressReviewConsumptionState(scopeRoot) });
  const result = publishProgressReview({ scopeRoot, sourceRunId: "delayed-question", currentState: current.nextState });
  expect(result.nextState).toEqual(current.nextState);
  expect(queue.list("pending").map((item) => item.question).sort()).toEqual(
    newerKind === "unrelated" ? ["A newer decision", "Should we pursue delayed-question?"] : newerKind === "question" ? ["A newer decision"] : [],
  );
  for (const question of queue.list("pending")) queue.answer(question.id, "Proceed", "owner");
  const answered = queue.list();
  publishProgressReview({ scopeRoot, sourceRunId: "delayed-question", currentState: result.nextState });
  expect(queue.list()).toEqual(answered);
});


it.each(["deferred", "immediate"] as const)("publishes a fresh question after task completion through %s disposition", (mode) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-completed-"));
  roots.push(scopeRoot);
  const task = {
    topicKey: "owner-direction", title: "Implement the direction", priority: "p1" as const,
    problem: "Implementation is needed", howWeWillKnow: "The behavior is observable", evidenceIds: [],
  };
  const original = writeReview(scopeRoot, "completed-task", 1, {
    findings: { crossScope: { claims: [], followUpTasks: [] }, localScope: { claims: [], followUpTasks: [task] } },
    ownerQuestions: [],
  });
  stageGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal: progressReviewTaskProposal({ runId: "completed-task", review: original, task }) });
  const taskId = listFullRepoTasks(scopeRoot)[0]!.id;
  moveTaskById(scopeRoot, taskId, "done");
  const review = writeReview(scopeRoot, "fresh-question", 2);
  const proposal = progressReviewOwnerQuestionProposal({ runId: "fresh-question", question: review.ownerQuestions[0]! });
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  if (mode === "deferred") {
    const staged = applyProgressReviewActions({ workspaceRoot: scopeRoot, runId: "fresh-question", review, evidence: { evidence: [] } });
    expect(staged.touchedTaskQueue).toBe(true);
    expect(queue.list()).toEqual([]);
  } else {
    materializeGeneratedWorkProposal({ workspaceRoot: scopeRoot, proposal });
  }
  const published = publishProgressReview({ scopeRoot, sourceRunId: "fresh-question", currentState: emptyProgressReviewConsumptionState(scopeRoot) });
  expect(published.nextState.lastConsumedRevision).toBe(2);
  expect(listFullRepoTasks(scopeRoot).map(({ id, state }) => ({ id, state }))).toEqual([{ id: taskId, state: "done" }]);
  expect(queue.list("pending").map((item) => item.question)).toEqual(["Should we pursue fresh-question?"]);
  publishProgressReview({ scopeRoot, sourceRunId: "completed-task", currentState: published.nextState });
  expect(queue.list("pending")).toHaveLength(1);
  queue.answer(queue.list("pending")[0]!.id, "Proceed", "owner");
  const answered = queue.list();
  publishProgressReview({ scopeRoot, sourceRunId: "fresh-question", currentState: published.nextState });
  expect(queue.list()).toEqual(answered);
});


it.each([false, true])("preserves answered explicit questions across a later request (same topic: %s)", (sameTopic) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-explicit-replay-"));
  roots.push(scopeRoot);
  writeReview(scopeRoot, "older-request", null, {}, "2026-09-07T10:00:00.000Z");
  writeReview(scopeRoot, "newer-request", null, {
    ownerQuestions: [{
      topicKey: sameTopic ? "owner-direction" : "unrelated",
      question: "A newer question", reason: "New evidence", evidenceIds: [], proposedAnswers: [],
    }],
  }, "2026-09-07T11:00:00.000Z");
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  let state = emptyProgressReviewConsumptionState(scopeRoot);
  for (const sourceRunId of ["older-request", "newer-request"]) {
    const result = publishProgressReview({ scopeRoot, sourceRunId, currentState: state });
    state = decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(result.nextState)), scopeRoot);
    const question = queue.list("pending")[0]!;
    expect(question).toBeDefined();
    queue.answer(question.id, "Proceed", "owner");
  }
  const answered = queue.list();
  for (const sourceRunId of ["older-request", "newer-request"]) {
    expect(publishProgressReview({ scopeRoot, sourceRunId, currentState: state }).nextState).toEqual(state);
  }
  expect(queue.list()).toEqual(answered);
  expect(queue.list("pending")).toEqual([]);
});

it.each([false, true])("consumes an out-of-order explicit request without losing unrelated work (same topic: %s)", (sameTopic) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-progress-explicit-order-"));
  roots.push(scopeRoot);
  writeReview(scopeRoot, "older-request", null, {}, "2026-09-07T10:00:00.000Z");
  writeReview(scopeRoot, "newer-request", null, {
    ownerQuestions: [{
      topicKey: sameTopic ? "owner-direction" : "unrelated",
      question: "A newer question", reason: "New evidence", evidenceIds: [], proposedAnswers: [],
    }],
  }, "2026-09-07T11:00:00.000Z");
  const newer = publishProgressReview({ scopeRoot, sourceRunId: "newer-request", currentState: emptyProgressReviewConsumptionState(scopeRoot) });
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  queue.answer(queue.list("pending")[0]!.id, "Proceed", "owner");
  const result = publishProgressReview({ scopeRoot, sourceRunId: "older-request", currentState: newer.nextState });
  expect(queue.list("pending").map((item) => item.question)).toEqual(sameTopic ? [] : ["Should we pursue older-request?"]);
  expect(result.nextState.consumedExplicitRunIds).toEqual(["newer-request", "older-request"]);
  expect(result.nextState.lastConsumedRevision).toBe(0);
  const settled = queue.list();
  publishProgressReview({ scopeRoot, sourceRunId: "older-request", currentState: result.nextState });
  expect(queue.list()).toEqual(settled);
});
