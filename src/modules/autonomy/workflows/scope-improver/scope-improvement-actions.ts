import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  canPublishGeneratedWorkOwnerEffects,
  finalizeGeneratedWorkOwnerEffects,
  type GeneratedWorkProposal,
  stageGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-proposal.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { hasNewerScopeImprovementSignature, isScopeImprovementSignatureFresh } from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_ARTIFACT,
  type ScopeImprovementActionResult,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementArtifact,
  type ScopeImprovementRecommendation,
  type ScopeImprovementState,
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

function generatedWorkProposal(args: {
  runId: string;
  recommendation: Exclude<ScopeImprovementRecommendation, { kind: "skipped" }>;
}): GeneratedWorkProposal {
  const { recommendation, runId } = args;
  const common = {
    proposalKey: scopeImprovementProposalKey(recommendation.signature),
    provenance: {
      source: "scope-improver",
      runId,
      evidenceRefs: recommendation.evidenceIds,
    },
  };
  if (recommendation.kind === "create-task") {
    return {
      ...common,
      kind: "task",
      title: recommendation.title,
      priority: "p2",
      body: taskBody({ runId, recommendation }),
    };
  }
  return {
    ...common,
    kind: "owner-question",
    context: `Scope improvement run ${runId} cited evidence ids: ` +
      recommendation.evidenceIds.join(", "),
    question: recommendation.question,
    reason: recommendation.reason,
    proposedAnswers: recommendation.proposedAnswers,
    origin: {
      kind: "workflow",
      workflowName: "scope-improver",
      runId,
      stepId: "apply-recommendations",
      taskId: null,
    },
  };
}

function stageRecommendation(args: {
  workspaceRoot: string;
  runId: string;
  recommendation: Exclude<ScopeImprovementRecommendation, { kind: "skipped" }>;
}): ScopeImprovementAppliedAction[] {
  const staged = stageGeneratedWorkProposal({
    workspaceRoot: args.workspaceRoot,
    proposal: generatedWorkProposal(args),
  });
  const signature = args.recommendation.signature;
  return staged.actions.flatMap((action): ScopeImprovementAppliedAction[] => {
    switch (action.kind) {
      case "created-task":
      case "updated-task":
      case "dropped-task":
      case "owner-question-pending":
        return [{ ...action, signature }];
      case "reopened-task":
        if (staged.actions.some((item) => item.kind === "updated-task")) return [];
        return [{ kind: "updated-task", taskId: action.taskId, path: action.path, signature }];
      case "noop":
        return [skipped(signature, action.reason)];
      default:
        return [];
    }
  });
}

export function applyScopeImprovementOwnerQuestionEffects(args: {
  workspaceRoot: string;
  ownerQuestionQueue: OwnerQuestionQueue;
  runId: string;
  recommendations: readonly ScopeImprovementRecommendation[];
  repositoryActions: readonly ScopeImprovementAppliedAction[];
  inputs: ScopeImprovementArtifact["inputs"];
  currentState: ScopeImprovementState;
}): ScopeImprovementAppliedAction[] {
  return args.recommendations.flatMap((recommendation): ScopeImprovementAppliedAction[] => {
    if (recommendation.kind === "skipped") return [];
    if (!args.repositoryActions.some((action) =>
      action.signature === recommendation.signature &&
      (recommendation.kind !== "owner-question" || action.kind === "owner-question-pending")
    )) return [];
    if (hasNewerScopeImprovementSignature(
      args.currentState, recommendation.signature, args.inputs.generatedAt,
    )) return [];
    const proposal = generatedWorkProposal({ runId: args.runId, recommendation });
    const fresh = isScopeImprovementSignatureFresh(
      args.currentState, args.inputs, args.runId, recommendation.signature,
    );
    // Observe questions do not replace task disposition: this posture cannot
    // stage the retirement that a repository-writing proposal would publish.
    const canPublish = proposal.kind === "owner-question" && args.inputs.config.posture === "observe"
      ? fresh
      : canPublishGeneratedWorkOwnerEffects({ workspaceRoot: args.workspaceRoot, proposal, fresh });
    if (!canPublish) return [];
    const result = finalizeGeneratedWorkOwnerEffects({
      workspaceRoot: args.workspaceRoot,
      ownerQuestionQueue: args.ownerQuestionQueue,
      proposal,
    });
    if (result.ownerQuestionId === null) return [];
    return [{
      kind: result.actions.some((action) => action.kind === "updated-owner-question")
        ? "updated-owner-question"
        : "owner-question",
      questionId: result.ownerQuestionId,
      signature: recommendation.signature,
    }];
  });
}

function skipped(signature: string, reason: string): ScopeImprovementAppliedAction {
  return { kind: "skipped", signature, reason };
}

export type ApplyScopeImprovementRecommendationsInput = {
  workspaceRoot: string;
  runId: string;
  inputs: ScopeImprovementArtifact["inputs"];
  recommendations: readonly ScopeImprovementRecommendation[];
};

export function applyScopeImprovementRecommendations(
  args: ApplyScopeImprovementRecommendationsInput,
): ScopeImprovementActionResult {
  const applied = args.recommendations.flatMap(
    (recommendation): ScopeImprovementAppliedAction[] => {
      if (recommendation.kind === "skipped") {
        return [skipped(recommendation.signature, recommendation.reason)];
      }
      if (recommendation.kind === "owner-question" && args.inputs.config.posture === "observe") {
        return [{ kind: "owner-question-pending", signature: recommendation.signature }];
      }
      return stageRecommendation({ workspaceRoot: args.workspaceRoot, runId: args.runId, recommendation });
    },
  );
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
    parkedReason: null,
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
