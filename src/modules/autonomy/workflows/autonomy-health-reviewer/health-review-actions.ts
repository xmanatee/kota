import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  type AutonomyIssueObservation,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  reduceAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { findGeneratedWorkQuestion } from "#modules/autonomy/generated-work-owner-question.js";
import { normalizeGeneratedWorkProposalKey } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
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

export function planAutonomyHealthReviewActions(args: {
  workspaceRoot: string;
  currentProjection: AutonomyIssueProjection;
  scopeRoot?: string;
  review: AutonomyHealthReview;
}): AutonomyHealthReviewActionResult {
  const observations = autonomyIssueObservationsFromReview(
    args.review,
    args.currentProjection,
  );
  const projected = reduceAutonomyIssueProjection(
    args.currentProjection,
    observations,
  );
  const taskMutations = observations.flatMap((observation) => {
    if (observation.kind !== "cleared") return [];
    const proposalKey = normalizeGeneratedWorkProposalKey(
      `autonomy-issue:${observation.issueKey}`,
    );
    const existingTask = findGeneratedWorkTask(args.workspaceRoot, proposalKey);
    if (
      !existingTask ||
      existingTask.task.state === "done" ||
      existingTask.task.state === "dropped"
    ) {
      return [];
    }
    return [{ id: existingTask.task.id, state: "dropped" as const }];
  });
  return {
    taskMutations,
    dismissedOwnerQuestionIds: [],
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions, observations),
  };
}

export function applyAutonomyHealthReviewActions(args: {
  currentProjection: AutonomyIssueProjection;
  scopeRoot?: string;
  ownerQuestionQueue: OwnerQuestionQueue;
  review: AutonomyHealthReview;
  plannedActions: AutonomyHealthReviewActionResult;
}): AutonomyHealthReviewActionResult & {
  projection: AutonomyIssueProjection;
} {
  const priorIssueByKey = new Map(
    args.currentProjection.issues.map((issue) => [
      issue.issueKey,
      issue,
    ]),
  );
  const observations = autonomyIssueObservationsFromReview(
    args.review,
    args.currentProjection,
  );
  const projected = applyAutonomyIssueObservations({
    current: args.currentProjection,
    observations,
  });
  const issueByKey = new Map(
    projected.projection.issues.map((issue) => [issue.issueKey, issue]),
  );
  const clearedGeneratedWorkQuestionIds = projected.transitions.flatMap((transition) => {
    if (transition.kind !== "cleared") return [];
    const question = findGeneratedWorkQuestion(
      args.ownerQuestionQueue,
      normalizeGeneratedWorkProposalKey(`autonomy-issue:${transition.issueKey}`),
    );
    return question?.status === "pending" ? [question.id] : [];
  });
  const linkedDismissedOwnerQuestionIds = projected.transitions.flatMap((transition) => {
    if (transition.kind !== "cleared") return [];
    const issue = priorIssueByKey.get(transition.issueKey) ??
      issueByKey.get(transition.issueKey);
    if (!issue) return [];
    return issue.links.ownerQuestionIds.flatMap((questionId) => {
      const item = args.ownerQuestionQueue.get(questionId);
      if (item?.status !== "pending") return [];
      return [questionId];
    });
  });
  const dismissedOwnerQuestionIds = [...new Set([
    ...clearedGeneratedWorkQuestionIds,
    ...linkedDismissedOwnerQuestionIds,
  ])].sort((a, b) => a.localeCompare(b));
  return {
    projection: projected.projection,
    taskMutations: [...args.plannedActions.taskMutations],
    dismissedOwnerQuestionIds,
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions, observations),
  };
}

export function autonomyIssueObservationsFromReview(
  review: AutonomyHealthReview,
  currentProjection: AutonomyIssueProjection,
): AutonomyIssueObservation[] {
  const currentIssueKeys = new Set(
    currentProjection.issues.map((issue) => issue.issueKey),
  );
  return review.groups.flatMap((group) => {
    const evidenceRefs = projectAutonomyHealthEvidenceRefsForReview(
      group.evidenceRefs,
    );
    const observation = buildAutonomyIssueObservation({
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
    const alreadyDurable = currentIssueKeys.has(observation.issueKey);
    const concreteFailure = group.severity === "error" ||
      group.severity === "critical";
    const repeatedObservation = group.observationCount > 1;
    if (
      (group.observation === "cleared" && !alreadyDurable) ||
      (group.observation !== "cleared" &&
        !alreadyDurable &&
        !concreteFailure &&
        !repeatedObservation)
    ) {
      return [];
    }
    return [observation];
  });
}
