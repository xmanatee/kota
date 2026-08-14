import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  type AutonomyIssueObservation,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  readAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { initializeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection-rebuild.js";
import {
  generatedWorkTaskMutationPaths,
  materializeGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-proposal.js";
import {
  projectAutonomyHealthEvidenceRefsForReview,
  projectAutonomyHealthSummariesForReview,
} from "#modules/autonomy/health-review-evidence-policy.js";
import type {
  AutonomyHealthAppliedAction,
  AutonomyHealthReview,
  AutonomyHealthReviewActionResult,
} from "./health-review-types.js";

export function applyAutonomyHealthReviewActions(args: {
  projectDir: string;
  review: AutonomyHealthReview;
}): AutonomyHealthReviewActionResult {
  initializeAutonomyIssueProjection(args.projectDir);
  const priorIssueByKey = new Map(
    readAutonomyIssueProjection(args.projectDir).issues.map((issue) => [
      issue.issueKey,
      issue,
    ]),
  );
  const observations = autonomyIssueObservationsFromReview(args.review);
  const projected = applyAutonomyIssueObservations({
    projectDir: args.projectDir,
    observations,
  });
  const rootCauseByIssueKey = new Map(
    observations.map((observation) => [
      observation.issueKey,
      observation.rootCauseKey,
    ]),
  );
  const issueByKey = new Map(
    projected.projection.issues.map((issue) => [issue.issueKey, issue]),
  );
  const clearedGeneratedWork = observations.flatMap((observation) => {
    if (observation.kind !== "cleared") return [];
    return [materializeGeneratedWorkProposal({
      projectDir: args.projectDir,
      proposal: {
        kind: "none",
        proposalKey: `autonomy-issue:${observation.issueKey}`,
        reason: "Resolved by an explicit autonomy issue clear observation",
        source: "autonomy-health-reviewer",
      },
    })];
  });
  let ownerQuestions: OwnerQuestionQueue | null = null;
  const linkedDismissedOwnerQuestionIds = projected.transitions.flatMap((transition) => {
    if (transition.kind !== "cleared") return [];
    ownerQuestions ??= new OwnerQuestionQueue(
      join(args.projectDir, ".kota", "owner-questions"),
    );
    const queue = ownerQuestions;
    const issue = priorIssueByKey.get(transition.issueKey) ??
      issueByKey.get(transition.issueKey);
    if (!issue) return [];
    return issue.links.ownerQuestionIds.flatMap((questionId) => {
      const item = queue.get(questionId);
      if (item?.status !== "pending") return [];
      queue.dismiss(
        questionId,
        "Resolved by an explicit autonomy issue clear observation",
        "autonomy-health-reviewer",
      );
      return [questionId];
    });
  });
  const dismissedOwnerQuestionIds = [...new Set([
    ...clearedGeneratedWork.flatMap((result) =>
      result.actions.flatMap((action) =>
        action.kind === "dismissed-owner-question" ? [action.questionId] : []
      )
    ),
    ...linkedDismissedOwnerQuestionIds,
  ])].sort((a, b) => a.localeCompare(b));
  const droppedTaskIds = [...new Set(
    clearedGeneratedWork.flatMap((result) =>
      result.actions.flatMap((action) =>
        action.kind === "dropped-task" ? [action.taskId] : []
      )
    ),
  )].sort((a, b) => a.localeCompare(b));
  const taskMutationPaths = [...new Set(
    clearedGeneratedWork.flatMap((result) =>
      generatedWorkTaskMutationPaths(result.actions)
    ),
  )].sort((a, b) => a.localeCompare(b));
  const applied = projected.transitions.flatMap(
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
  return {
    createdTaskIds: [],
    droppedTaskIds,
    ownerQuestionIds: [],
    dismissedOwnerQuestionIds,
    taskMutationPaths,
    issueTransitions: projected.transitions,
    applied,
    touchedTaskQueue: taskMutationPaths.length > 0,
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
