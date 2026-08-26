import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  OwnerQuestionEnqueueInput,
  OwnerQuestionQueue,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  generatedWorkProvenanceContext,
  generatedWorkQuestionDedupeKey,
} from "#modules/autonomy/generated-work-owner-question.js";
import type { GeneratedWorkProposalAction } from "#modules/autonomy/generated-work-proposal.js";
import {
  dropGeneratedWorkTask,
  findGeneratedWorkTask,
  writeGeneratedWorkTask,
} from "#modules/autonomy/generated-work-task.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import {
  SCOPE_IMPROVEMENT_ARTIFACT,
  type ScopeImprovementActionResult,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementArtifact,
  type ScopeImprovementRecommendation,
} from "./scope-improvement-types.js";

export function scopeImprovementProposalKey(signature: string): string {
  const digest = createHash("sha256").update(signature.trim()).digest("hex").slice(0, 20);
  return `scope-improver:${digest}`;
}

function taskBody(args: {
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>;
}): string {
  const task = args.recommendation.task;
  return renderRepoTaskIntent({
    problem: task.problem,
    desiredOutcome: task.desiredOutcome,
    constraints: task.constraints.map((item) => `- ${item}`).join("\n"),
    howWeWillKnow: task.howWeWillKnow.map((item) => `- ${item}`).join("\n"),
    context: [
      `Created by scope-improver workflow run ${args.runId}.`,
      "",
      "Evidence ids:",
      ...args.recommendation.evidenceIds.map((id) => `- ${id}`),
    ].join("\n"),
  });
}

function taskPath(actions: readonly GeneratedWorkProposalAction[]): string | null {
  return actions.find(
    (action): action is Extract<GeneratedWorkProposalAction, { path: string }> =>
      "path" in action,
  )?.path ?? null;
}

function writeTask(args: {
  projectDir: string;
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>;
}): ScopeImprovementAppliedAction {
  const proposalKey = scopeImprovementProposalKey(args.recommendation.signature);
  const existing = findGeneratedWorkTask(args.projectDir, proposalKey);
  const actions = writeGeneratedWorkTask({
    projectDir: args.projectDir,
    proposal: {
      kind: "task",
      proposalKey,
      title: args.recommendation.title,
      summary: args.recommendation.summary,
      priority: "p2",
      area: "autonomy",
      taskClass: "Meta",
      body: taskBody(args),
      provenance: {
        source: "scope-improver",
        runId: args.runId,
        evidenceRefs: args.recommendation.evidenceIds,
      },
    },
    existing,
  });
  const created = actions.some((action) => action.kind === "created-task");
  const updated = actions.some((action) =>
    action.kind === "updated-task" || action.kind === "reopened-task"
  );
  const taskId = actions.find((action) => "taskId" in action)?.taskId ??
    existing?.task.id ?? null;
  if ((!created && !updated) || !taskId) {
    return skipped(args.recommendation.signature, "stable generated-work task is current");
  }
  return {
    kind: created ? "created-task" : "updated-task",
    taskId,
    path: taskPath(actions) ?? `data/tasks/ready/${taskId}.md`,
    signature: args.recommendation.signature,
  };
}

function stageOwnerQuestion(args: {
  projectDir: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "owner-question" }>;
}): ScopeImprovementAppliedAction[] {
  const existing = findGeneratedWorkTask(
    args.projectDir,
    scopeImprovementProposalKey(args.recommendation.signature),
  );
  const droppedTasks: ScopeImprovementAppliedAction[] = dropGeneratedWorkTask(
    args.projectDir,
    existing,
  ).flatMap(
    (action) => action.kind === "dropped-task"
      ? [{
        kind: "dropped-task" as const,
        taskId: action.taskId,
        fromState: action.fromState,
        signature: args.recommendation.signature,
      }]
      : [],
  );
  return [...droppedTasks, {
    kind: "owner-question-pending",
    signature: args.recommendation.signature,
  }];
}

function ownerQuestionInput(args: {
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "owner-question" }>;
}): OwnerQuestionEnqueueInput & { dedupeKey: string } {
  const proposalKey = scopeImprovementProposalKey(args.recommendation.signature);
  return {
    dedupeKey: generatedWorkQuestionDedupeKey(proposalKey),
    context: generatedWorkProvenanceContext(
      `Scope improvement run ${args.runId} cited evidence ids: ` +
        args.recommendation.evidenceIds.join(", "),
      proposalKey,
      {
        source: "scope-improver",
        runId: args.runId,
        evidenceRefs: args.recommendation.evidenceIds,
      },
    ),
    question: args.recommendation.question,
    reason: args.recommendation.reason,
    source: "scope-improver",
    answerBehavior: "record-only" as const,
    proposedAnswers: args.recommendation.proposedAnswers,
    origin: {
      kind: "workflow" as const,
      workflowName: "scope-improver",
      runId: args.runId,
      stepId: "apply-recommendations",
      taskId: null,
    },
  };
}

function pendingQuestion(
  queue: OwnerQuestionQueue,
  dedupeKey: string,
): PendingOwnerQuestion | null {
  const matches = queue.list("pending").filter((item) => item.dedupeKey === dedupeKey);
  if (matches.length > 1) {
    throw new Error(`scope improvement owner question ${dedupeKey} is duplicated`);
  }
  return matches[0] ?? null;
}

function questionMatches(
  existing: PendingOwnerQuestion,
  input: OwnerQuestionEnqueueInput & { dedupeKey: string },
): boolean {
  return existing.context === input.context &&
    existing.question === input.question &&
    existing.reason === input.reason &&
    existing.source === input.source &&
    existing.answerBehavior === input.answerBehavior &&
    JSON.stringify(existing.proposedAnswers ?? []) ===
      JSON.stringify(input.proposedAnswers ?? []);
}

export function applyScopeImprovementOwnerQuestionEffects(args: {
  ownerQuestionQueue: OwnerQuestionQueue;
  runId: string;
  recommendations: readonly ScopeImprovementRecommendation[];
  repositoryActions: readonly ScopeImprovementAppliedAction[];
}): ScopeImprovementAppliedAction[] {
  return args.recommendations.flatMap((recommendation) => {
    if (recommendation.kind === "create-task") {
      if (!args.repositoryActions.some((action) =>
        action.signature === recommendation.signature
      )) return [];
      const existing = pendingQuestion(
        args.ownerQuestionQueue,
        generatedWorkQuestionDedupeKey(
          scopeImprovementProposalKey(recommendation.signature),
        ),
      );
      if (existing) args.ownerQuestionQueue.dismiss(
        existing.id,
        "The scope-improvement disposition now routes through a task.",
        "scope-improver",
      );
      return [];
    }
    if (recommendation.kind !== "owner-question") return [];
    if (!args.repositoryActions.some((action) =>
      action.kind === "owner-question-pending" &&
      action.signature === recommendation.signature
    )) return [];
    const input = ownerQuestionInput({ runId: args.runId, recommendation });
    const existing = pendingQuestion(args.ownerQuestionQueue, input.dedupeKey);
    if (existing && questionMatches(existing, input)) {
      return [{
        kind: "owner-question",
        questionId: existing.id,
        signature: recommendation.signature,
      }];
    }
    if (existing) {
      args.ownerQuestionQueue.dismiss(
        existing.id,
        "The scope-improvement owner-question proposal was revised.",
        "scope-improver",
      );
    }
    const reconciled = args.ownerQuestionQueue.enqueueDeduplicated(input);
    return [{
      kind: existing ? "updated-owner-question" : "owner-question",
      questionId: reconciled.item.id,
      signature: recommendation.signature,
    }];
  });
}

function skipped(signature: string, reason: string): ScopeImprovementAppliedAction {
  return { kind: "skipped", signature, reason };
}

export type ApplyScopeImprovementRecommendationsInput = {
  projectDir: string;
  runId: string;
  inputs: ScopeImprovementArtifact["inputs"];
  recommendations: readonly ScopeImprovementRecommendation[];
};

export function applyScopeImprovementRecommendations(
  args: ApplyScopeImprovementRecommendationsInput,
): ScopeImprovementActionResult {
  const applied = args.recommendations.flatMap(
    (recommendation): ScopeImprovementAppliedAction[] => {
    if (recommendation.kind === "create-task") {
      return [writeTask({ projectDir: args.projectDir, runId: args.runId, recommendation })];
    }
    if (recommendation.kind === "owner-question") {
      return stageOwnerQuestion({ projectDir: args.projectDir, recommendation });
    }
    return [skipped(recommendation.signature, recommendation.reason)];
  });
  return summarizeActions(applied);
}

export const applyScopeImprovementRecommendationsOperation =
  defineWorkflowBlockingOperation<
    ApplyScopeImprovementRecommendationsInput,
    ScopeImprovementActionResult
  >(import.meta.url, "applyScopeImprovementRecommendations");

function summarizeActions(
  applied: ScopeImprovementAppliedAction[],
): ScopeImprovementActionResult {
  const createdTaskIds = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "created-task" }> =>
      action.kind === "created-task",
    )
    .map((action) => action.taskId);
  const ownerQuestionIds = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "owner-question" }> =>
      action.kind === "owner-question",
    )
    .map((action) => action.questionId);
  return {
    createdTaskIds,
    ownerQuestionIds,
    applied,
    requiresCommit:
      applied.some((action) =>
        action.kind === "created-task" ||
        action.kind === "updated-task" ||
        action.kind === "dropped-task"
      ),
  };
}

export function writeScopeImprovementArtifact(
  runDirPath: string,
  artifact: ScopeImprovementArtifact,
): string {
  mkdirSync(runDirPath, { recursive: true });
  const path = join(runDirPath, SCOPE_IMPROVEMENT_ARTIFACT);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return path;
}
