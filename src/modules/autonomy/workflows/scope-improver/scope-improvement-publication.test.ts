import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { applyScopeImprovementRecommendations, writeScopeImprovementArtifact } from "./scope-improvement-actions.js";
import { publishScopeImprovement } from "./scope-improvement-publication.js";
import { decodeScopeImprovementState, emptyScopeImprovementState } from "./scope-improvement-state.js";
import type { ScopeImprovementArtifact, ScopeImprovementRecommendation } from "./scope-improvement-types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["2026-09-07T10:00:00.000Z", "2026-09-07T11:00:00.000Z"])(
  "publishes distinct explicit requests independently of timestamp order (%s)",
  (olderTime) => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-explicit-publication-"));
    roots.push(scopeRoot);
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    let state = emptyScopeImprovementState(scopeId);
    const newerTime = "2026-09-07T11:00:00.000Z";
    for (const [sourceRunId, generatedAt] of [["request-a", olderTime], ["request-b", newerTime]] as const) {
      const scope = { scopeId, displayName: "Publication fixture", directoryRoot: scopeRoot };
      const artifact: ScopeImprovementArtifact = {
        schemaVersion: 1,
        generatedAt,
        preflight: { worktree: { available: false, dirty: false, entries: [], summary: "Observe scope" } },
        inputs: {
          generatedAt, triggerKind: "explicit-request", triggerEvent: "autonomy.scope-improvement.requested",
          scope, config: { enabled: true, maxActionsPerRun: 2, posture: "observe" },
          taskProposalAuthority: { outcome: "deny", reason: "Observe scope" },
          state, instructions: [], changedFiles: [], evidence: [],
          semanticInput: { automatic: false, fingerprint: "same-guidance", evidenceRefs: [] },
          alreadyConsumed: false,
        },
        evidence: { generatedAt, scope, triggerKind: "explicit-request", triggerEvent: "autonomy.scope-improvement.requested", evidence: [], candidates: [] },
        recommendations: [{ kind: "owner-question", signature: sourceRunId, question: `Should we pursue ${sourceRunId}?`, reason: "An explicit request requires owner direction.", evidenceIds: [], proposedAnswers: [] }],
        actions: { createdTaskIds: [], ownerQuestionIds: [], applied: [{ kind: "owner-question-pending", signature: sourceRunId }], requiresCommit: false, parkedReason: null },
        consumption: { disposition: "consume", reason: null },
      };
      writeScopeImprovementArtifact(join(scopeRoot, ".kota", "runs", sourceRunId), artifact);
    }
    for (const sourceRunId of ["request-b", "request-a"]) {
      const result = publishScopeImprovement({ scopeRoot, sourceRunId, currentState: state });
      expect(result.disposition).toBe("published");
      state = decodeScopeImprovementState(JSON.parse(JSON.stringify(result.nextState)), scopeId);
    }
    const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
    expect(queue.list("pending").map((item) => item.question).sort()).toEqual([
      "Should we pursue request-a?", "Should we pursue request-b?",
    ]);
    expect(state.lastRunAt).toBe(newerTime);
    expect(state.consumedFingerprint).toBeNull();
    const first = queue.list("pending")[0]!;
    queue.answer(first.id, "Proceed", "owner");
    queue.enqueue({ ...first, question: "A later revised question", answerBehavior: "record-only" });
    const beforeReplay = queue.list();
    for (const sourceRunId of ["request-a", "request-b"]) {
      expect(publishScopeImprovement({ scopeRoot, sourceRunId, currentState: state }).nextState).toEqual(state);
    }
    expect(queue.list()).toEqual(beforeReplay);
  },
);


it.each([false, true])("publishes delayed automatic task effects unless a later disposition retired the task (%s)", (retired) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-delayed-scope-publication-"));
  roots.push(scopeRoot);
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  let state = emptyScopeImprovementState(scopeId);
  function publish(sourceRunId: string) {
    const result = publishScopeImprovement({ scopeRoot, sourceRunId, currentState: state });
    expect(result.disposition).toBe("published");
    state = decodeScopeImprovementState(JSON.parse(JSON.stringify(result.nextState)), scopeId);
  }
  const question = (signature: string, text: string): ScopeImprovementRecommendation => ({
    kind: "owner-question", signature, question: text, reason: "Owner direction required", evidenceIds: [], proposedAnswers: [],
  });
  stageReview(scopeRoot, state, "original-question", "2026-09-07T09:00:00.000Z", false, question("direction", "Should we implement this direction?"));
  publish("original-question");
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  const original = queue.list("pending")[0]!;
  stageReview(scopeRoot, state, "delayed-task", "2026-09-07T10:00:00.000Z", true, {
    kind: "create-task", signature: "direction", title: "Implement the agreed direction", summary: "Actionable scope work", evidenceIds: [],
    task: { problem: "The direction requires implementation", desiredOutcome: "The agreed behavior is available", constraints: [], howWeWillKnow: ["The behavior is observable"] },
  });
  expect(listFullRepoTasks(scopeRoot).map((task) => task.state)).toEqual(["open"]);
  expect(queue.get(original.id)?.status).toBe("pending");
  stageReview(scopeRoot, state, "newer-question", "2026-09-07T11:00:00.000Z", false, question(retired ? "direction" : "unrelated", "Which direction should we choose next?"));
  publish("newer-question");
  const newerState = state;
  publish("delayed-task");
  expect(state).toEqual(newerState);
  expect(listFullRepoTasks(scopeRoot).map((task) => task.state)).toEqual([retired ? "dropped" : "open"]);
  expect(queue.get(original.id)?.status).toBe(retired ? "pending" : "dismissed");
  expect(queue.list("pending").map((item) => item.question)).toEqual(["Which direction should we choose next?"]);
  const beforeReplay = queue.list();
  publish("delayed-task");
  expect(queue.list()).toEqual(beforeReplay);
});

it.each(["integrated-task", "published-task", "question", "unrelated"])(
  "consumes a delayed explicit request while preserving a newer %s disposition",
  (newerKind) => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-explicit-supersession-"));
    roots.push(scopeRoot);
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    let state = emptyScopeImprovementState(scopeId);
    const question: ScopeImprovementRecommendation = {
      kind: "owner-question", signature: "direction", question: "An older question",
      reason: "Owner direction needed", evidenceIds: [], proposedAnswers: [],
    };
    stageReview(scopeRoot, state, "older-request", "2026-09-07T10:00:00.000Z", false, question);
    const newerTask = newerKind === "integrated-task" || newerKind === "published-task";
    stageReview(scopeRoot, state, "newer-request", "2026-09-07T11:00:00.000Z", false,
      newerTask ? {
        kind: "create-task", signature: "direction", title: "Implement direction", summary: "Actionable work", evidenceIds: [],
        task: { problem: "Implementation is needed", desiredOutcome: "Observable behavior", constraints: [], howWeWillKnow: ["Behavior works"] },
      } : {
        ...question, signature: newerKind === "unrelated" ? "unrelated" : "direction", question: "A newer question",
      });
    function publish(sourceRunId: string) {
      const result = publishScopeImprovement({ scopeRoot, sourceRunId, currentState: state });
      expect(result.disposition).toBe("published");
      state = decodeScopeImprovementState(JSON.parse(JSON.stringify(result.nextState)), scopeId);
    }
    if (newerKind !== "integrated-task") publish("newer-request");
    publish("older-request");
    const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
    expect(queue.list("pending").map((item) => item.question).sort()).toEqual(
      newerTask ? [] : newerKind === "unrelated"
        ? ["A newer question", "An older question"] : ["A newer question"],
    );
    expect(listFullRepoTasks(scopeRoot).map((item) => item.state)).toEqual(newerTask ? ["open"] : []);
    expect(state.consumedExplicitRunIds).toContain("older-request");
    if (newerKind === "integrated-task") publish("newer-request");
    expect([...state.consumedExplicitRunIds].sort()).toEqual(["newer-request", "older-request"]);
    expect(state.recentSignatures.find((entry) => entry.signature === "direction")).toMatchObject({
      lastSeenAt: newerKind === "unrelated" ? "2026-09-07T10:00:00.000Z" : "2026-09-07T11:00:00.000Z",
    });
    for (const item of queue.list("pending")) queue.answer(item.id, "Proceed", "owner");
    const answered = queue.list();
    const consumed = state;
    publish("older-request");
    expect(state).toEqual(consumed);
    expect(queue.list()).toEqual(answered);
  },
);

function stageReview(scopeRoot: string, state: ScopeImprovementArtifact["inputs"]["state"], sourceRunId: string, generatedAt: string, automatic: boolean, recommendation: ScopeImprovementRecommendation, posture: "build" | "observe" = "build") {
    const scope = { scopeId: deriveDirectoryScopeId(scopeRoot), displayName: "Publication fixture", directoryRoot: scopeRoot };
    const triggerKind = automatic ? "content-policy-changed" : "explicit-request";
    const inputs: ScopeImprovementArtifact["inputs"] = {
      generatedAt, triggerKind, triggerEvent: "autonomy.scope-improvement.requested",
      scope, config: { enabled: true, maxActionsPerRun: 2, posture },
      taskProposalAuthority: { outcome: posture === "observe" ? "deny" : "allow", reason: "Posture authority" },
      state, instructions: [], changedFiles: [], evidence: [],
      semanticInput: { automatic, fingerprint: sourceRunId, evidenceRefs: [] }, alreadyConsumed: false,
    };
    const artifact: ScopeImprovementArtifact = {
      schemaVersion: 1, generatedAt, inputs,
      preflight: { worktree: { available: true, dirty: false, entries: [], summary: "Integrated fixture" } },
      evidence: { generatedAt, scope, triggerKind, triggerEvent: inputs.triggerEvent, evidence: [], candidates: [] },
      recommendations: [recommendation],
      actions: applyScopeImprovementRecommendations({ workspaceRoot: scopeRoot, runId: sourceRunId, inputs, recommendations: [recommendation] }),
      consumption: { disposition: "consume", reason: null },
    };
    writeScopeImprovementArtifact(join(scopeRoot, ".kota", "runs", sourceRunId), artifact);
  }


it.each(["unrelated", "question", "task"])("completes delayed task-to-question publication unless superseded by %s", (newerKind) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-scope-retirement-"));
  roots.push(scopeRoot);
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  let state = emptyScopeImprovementState(scopeId);
  const task: ScopeImprovementRecommendation = {
    kind: "create-task", signature: "direction", title: "Implement direction", summary: "Actionable work", evidenceIds: [],
    task: { problem: "Implementation is needed", desiredOutcome: "Observable behavior", constraints: [], howWeWillKnow: ["Behavior works"] },
  };
  const question: ScopeImprovementRecommendation = {
    kind: "owner-question", signature: "direction", question: "Should we pursue this direction?", reason: "Owner direction needed", evidenceIds: [], proposedAnswers: [],
  };
  stageReview(scopeRoot, state, "original-task", "2026-09-07T09:00:00.000Z", true, task);
  stageReview(scopeRoot, state, "delayed-question", "2026-09-07T10:00:00.000Z", true, question);
  expect(listFullRepoTasks(scopeRoot).map((item) => item.state)).toEqual(["dropped"]);
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  expect(queue.list()).toEqual([]);
  stageReview(scopeRoot, state, "newer-review", "2026-09-07T11:00:00.000Z", true, newerKind === "task" ? task : {
    ...question, signature: newerKind === "unrelated" ? "unrelated" : "direction", question: "A newer decision",
  });
  const current = publishScopeImprovement({ scopeRoot, sourceRunId: "newer-review", currentState: state });
  state = decodeScopeImprovementState(JSON.parse(JSON.stringify(current.nextState)), scopeId);
  const result = publishScopeImprovement({ scopeRoot, sourceRunId: "delayed-question", currentState: state });
  expect(result.nextState).toEqual(state);
  expect(queue.list("pending").map((item) => item.question).sort()).toEqual(
    newerKind === "unrelated" ? ["A newer decision", "Should we pursue this direction?"] : newerKind === "question" ? ["A newer decision"] : [],
  );
  for (const item of queue.list("pending")) queue.answer(item.id, "Proceed", "owner");
  const answered = queue.list();
  publishScopeImprovement({ scopeRoot, sourceRunId: "delayed-question", currentState: state });
  expect(queue.list()).toEqual(answered);
});


it.each(["open", "done", "dropped"] as const)("publishes a fresh observe question beside an existing %s task without changing it", (taskState) => {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-observe-existing-task-"));
  roots.push(scopeRoot);
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  let state = emptyScopeImprovementState(scopeId);
  const task: ScopeImprovementRecommendation = {
    kind: "create-task", signature: "direction", title: "Implement direction", summary: "Actionable work", evidenceIds: [],
    task: { problem: "Implementation is needed", desiredOutcome: "Observable behavior", constraints: [], howWeWillKnow: ["Behavior works"] },
  };
  stageReview(scopeRoot, state, "original-task", "2026-09-07T09:00:00.000Z", true, task);
  state = publishScopeImprovement({ scopeRoot, sourceRunId: "original-task", currentState: state }).nextState!;
  if (taskState !== "open") moveTaskById(scopeRoot, listFullRepoTasks(scopeRoot)[0]!.id, taskState);
  const tasks = listFullRepoTasks(scopeRoot);
  const question: ScopeImprovementRecommendation = {
    kind: "owner-question", signature: "direction", question: "Should we reconsider the direction?",
    reason: "New owner evidence", evidenceIds: [], proposedAnswers: [],
  };
  stageReview(scopeRoot, state, "observe-question", "2026-09-07T10:00:00.000Z", false, question, "observe");
  expect(listFullRepoTasks(scopeRoot)).toEqual(tasks);
  const result = publishScopeImprovement({ scopeRoot, sourceRunId: "observe-question", currentState: state });
  state = decodeScopeImprovementState(JSON.parse(JSON.stringify(result.nextState)), scopeId);
  const queue = new OwnerQuestionQueue(join(scopeRoot, ".kota", "owner-questions"));
  expect(queue.list("pending").map((item) => item.question)).toEqual([question.question]);
  expect(listFullRepoTasks(scopeRoot)).toEqual(tasks);
  expect(state.consumedExplicitRunIds).toContain("observe-question");
  publishScopeImprovement({ scopeRoot, sourceRunId: "original-task", currentState: state });
  expect(queue.list("pending").map((item) => item.question)).toEqual([question.question]);
  queue.answer(queue.list("pending")[0]!.id, "Proceed", "owner");
  const answered = queue.list();
  publishScopeImprovement({ scopeRoot, sourceRunId: "observe-question", currentState: state });
  expect(queue.list()).toEqual(answered);
});
