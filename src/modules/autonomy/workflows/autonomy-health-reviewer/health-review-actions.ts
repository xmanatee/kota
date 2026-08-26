import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  type AutonomyIssueObservation,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  reduceAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { dismissGeneratedWorkQuestion } from "#modules/autonomy/generated-work-owner-question.js";
import {
  generatedWorkTaskMutationPaths,
  normalizeGeneratedWorkProposalKey,
} from "#modules/autonomy/generated-work-proposal.js";
import {
  dropGeneratedWorkTask,
  findGeneratedWorkTask,
} from "#modules/autonomy/generated-work-task.js";
import {
  projectAutonomyHealthEvidenceRefsForReview,
  projectAutonomyHealthSummariesForReview,
} from "#modules/autonomy/health-review-evidence-policy.js";
import type {
  AutonomyHealthAppliedAction,
  AutonomyHealthReview,
  AutonomyHealthReviewActionResult,
} from "./health-review-types.js";

function appliedActions(
  transitions: AutonomyHealthReviewActionResult["issueTransitions"],
  observations: readonly AutonomyIssueObservation[],
): AutonomyHealthAppliedAction[] {
  const rootCauseByIssueKey = new Map(
    observations.map((observation) => [
      observation.issueKey,
      observation.rootCauseKey,
    ]),
  );
  return transitions.flatMap(
    (transition): AutonomyHealthAppliedAction[] => {
      const dedupeKey = rootCauseByIssueKey.get(transition.issueKey);
      if (!dedupeKey) return [];
      if (transition.requiresDecision) {
        return [{
          kind: "decision-requested",
          issueKey: transition.issueKey,
          dedupeKey,
          semanticRevision: transition.semanticRevision,
          transition: transition.kind,
        }];
      }
      if (transition.kind === "cleared") {
        return [{
          kind: "resolved",
          issueKey: transition.issueKey,
          dedupeKey,
          semanticRevision: transition.semanticRevision,
          transition: "cleared",
        }];
      }
      return [];
    },
  );
}

export function planAutonomyHealthReviewFinalization(args: {
  currentProjection: AutonomyIssueProjection;
  scopeDir?: string;
  review: AutonomyHealthReview;
  repositoryActions: AutonomyHealthReviewActionResult;
}): AutonomyHealthReviewActionResult {
  const observations = autonomyIssueObservationsFromReview(args.review);
  const projected = reduceAutonomyIssueProjection(
    args.currentProjection,
    observations,
  );
  return {
    ...args.repositoryActions,
    dismissedOwnerQuestionIds: [],
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions, observations),
  };
}

export function stageAutonomyHealthReviewActions(args: {
  projectDir: string;
  currentProjection: AutonomyIssueProjection;
  scopeDir?: string;
  review: AutonomyHealthReview;
}): AutonomyHealthReviewActionResult {
  const observations = autonomyIssueObservationsFromReview(args.review);
  const projected = reduceAutonomyIssueProjection(
    args.currentProjection,
    observations,
  );
  const clearedGeneratedWork = observations.flatMap((observation) => {
    if (observation.kind !== "cleared") return [];
    const proposalKey = normalizeGeneratedWorkProposalKey(
      `autonomy-issue:${observation.issueKey}`,
    );
    const existingTask = findGeneratedWorkTask(args.projectDir, proposalKey);
    return dropGeneratedWorkTask(args.projectDir, existingTask);
  });
  const droppedTaskIds = [...new Set(
    clearedGeneratedWork.flatMap((action) =>
      action.kind === "dropped-task" ? [action.taskId] : []
    ),
  )].sort((a, b) => a.localeCompare(b));
  const taskMutationPaths = [...new Set(
    generatedWorkTaskMutationPaths(clearedGeneratedWork),
  )].sort((a, b) => a.localeCompare(b));
  return {
    createdTaskIds: [],
    droppedTaskIds,
    ownerQuestionIds: [],
    dismissedOwnerQuestionIds: [],
    taskMutationPaths,
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions, observations),
    touchedTaskQueue: taskMutationPaths.length > 0,
  };
}

export function finalizeAutonomyHealthReviewActions(args: {
  currentProjection: AutonomyIssueProjection;
  scopeDir?: string;
  ownerQuestionQueue: OwnerQuestionQueue;
  review: AutonomyHealthReview;
  repositoryActions: AutonomyHealthReviewActionResult;
}): AutonomyHealthReviewActionResult & {
  projection: AutonomyIssueProjection;
} {
  const priorIssueByKey = new Map(
    args.currentProjection.issues.map((issue) => [
      issue.issueKey,
      issue,
    ]),
  );
  const observations = autonomyIssueObservationsFromReview(args.review);
  const projected = applyAutonomyIssueObservations({
    current: args.currentProjection,
    observations,
  });
  const issueByKey = new Map(
    projected.projection.issues.map((issue) => [issue.issueKey, issue]),
  );
  const clearedGeneratedWorkQuestionIds = projected.transitions.flatMap(
    (transition) => {
      if (transition.kind !== "cleared") return [];
      const actions = dismissGeneratedWorkQuestion(
        args.ownerQuestionQueue,
        normalizeGeneratedWorkProposalKey(
          `autonomy-issue:${transition.issueKey}`,
        ),
        "Resolved by an explicit autonomy issue clear observation",
        "autonomy-health-reviewer",
      );
      return actions.flatMap((action) =>
        action.kind === "dismissed-owner-question" ? [action.questionId] : []
      );
    },
  );
  const linkedDismissedOwnerQuestionIds = projected.transitions.flatMap((transition) => {
    if (transition.kind !== "cleared") return [];
    const issue = priorIssueByKey.get(transition.issueKey) ??
      issueByKey.get(transition.issueKey);
    if (!issue) return [];
    return issue.links.ownerQuestionIds.flatMap((questionId) => {
      const item = args.ownerQuestionQueue.get(questionId);
      if (item?.status !== "pending") return [];
      args.ownerQuestionQueue.dismiss(
        questionId,
        "Resolved by an explicit autonomy issue clear observation",
        "autonomy-health-reviewer",
      );
      return [questionId];
    });
  });
  const dismissedOwnerQuestionIds = [...new Set([
    ...clearedGeneratedWorkQuestionIds,
    ...linkedDismissedOwnerQuestionIds,
  ])].sort((a, b) => a.localeCompare(b));
  return {
    projection: projected.projection,
    createdTaskIds: [...args.repositoryActions.createdTaskIds],
    droppedTaskIds: [...args.repositoryActions.droppedTaskIds],
    ownerQuestionIds: [...args.repositoryActions.ownerQuestionIds],
    dismissedOwnerQuestionIds,
    taskMutationPaths: [...args.repositoryActions.taskMutationPaths],
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions, observations),
    touchedTaskQueue: args.repositoryActions.touchedTaskQueue,
  };
}

export function autonomyIssueObservationsFromReview(
  review: AutonomyHealthReview,
): AutonomyIssueObservation[] {
  return review.groups.map((group) => {
    const evidenceRefs = projectAutonomyHealthEvidenceRefsForReview(
      group.evidenceRefs,
    );
    return buildAutonomyIssueObservation({
      kind: group.observation,
      rootCauseKey: group.dedupeKey,
      observedAt: review.generatedAt,
      signalIds: group.signalIds,
      source: group.source,
      severity: group.severity,
      actionability: group.actionability,
      labels: group.labels,
      summaries: projectAutonomyHealthSummariesForReview(
        group.summaries,
        group.evidenceRefs,
      ),
      evidenceRefs,
      observationCount: group.observationCount,
    });
  });
}
