import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  type AutonomyIssueObservation,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  reduceAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { planGeneratedWorkQuestionDismissals } from "#modules/autonomy/generated-work-owner-question.js";
import { normalizeGeneratedWorkProposalKey } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask, planGeneratedWorkTaskRetirement } from "#modules/autonomy/generated-work-task.js";
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
): AutonomyHealthAppliedAction[] {
  return transitions.flatMap(
    (transition): AutonomyHealthAppliedAction[] => {
      const dedupeKey = transition.rootCauseKey;
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
  const taskMutations = projected.transitions.flatMap((transition) => {
    if (transition.kind !== "cleared") return [];
    const proposalKey = normalizeGeneratedWorkProposalKey(
      `autonomy-issue:${transition.issueKey}`,
    );
    const retirement = planGeneratedWorkTaskRetirement(
      findGeneratedWorkTask(args.workspaceRoot, proposalKey),
    );
    return retirement ? [{ id: retirement.taskId, state: "dropped" as const }] : [];
  });
  return {
    taskMutations,
    ownerQuestionDismissals: [],
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions),
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
  const questionDismissals = projected.transitions.flatMap((transition) => {
    if (transition.kind !== "cleared") return [];
    const issue = priorIssueByKey.get(transition.issueKey) ??
      issueByKey.get(transition.issueKey);
    return planGeneratedWorkQuestionDismissals({
      queue: args.ownerQuestionQueue,
      proposalKey: normalizeGeneratedWorkProposalKey(`autonomy-issue:${transition.issueKey}`),
      linkedQuestionIds: issue?.links.ownerQuestionIds ?? [],
      reason: "Resolved by an explicit autonomy issue clear observation",
      source: "autonomy-health-reviewer",
    });
  });
  const ownerQuestionDismissals = [...new Map(
    questionDismissals.map((dismissal) => [dismissal.questionId, dismissal]),
  ).values()].sort((a, b) => a.questionId.localeCompare(b.questionId));
  return {
    projection: projected.projection,
    taskMutations: [...args.plannedActions.taskMutations],
    ownerQuestionDismissals,
    issueTransitions: projected.transitions,
    applied: appliedActions(projected.transitions),
  };
}

export function autonomyIssueObservationsFromReview(
  review: AutonomyHealthReview,
  currentProjection: AutonomyIssueProjection,
): AutonomyIssueObservation[] {
  const currentIssueKeys = new Set(
    currentProjection.issues.map((issue) => issue.issueKey),
  );
  // Module observations must retain operation identity and occurrence time;
  // grouping different operations or stamping review time destroys recovery order.
  const moduleSignals = [...new Map(review.signals.filter((signal) =>
    signal.source.kind === "module-log" || signal.source.kind === "module-operation-recovery",
  ).map((signal) => [signal.signalId, signal])).values()];
  const recoveredOperations = new Set([
    ...(currentProjection.moduleRecoveries ?? []).map((recovery) => JSON.stringify([recovery.module, recovery.operation])),
    ...moduleSignals.filter((signal) => signal.source.kind === "module-operation-recovery")
      .flatMap((signal) => signal.evidenceRefs.flatMap((ref) => ref.moduleOperation?.observation === "cleared"
        ? [JSON.stringify([signal.source.module, ref.moduleOperation.operation])] : [])),
  ]);
  const moduleObservations = moduleSignals.flatMap((signal) => {
    const observation = buildAutonomyIssueObservation({
      kind: signal.observation,
      rootCauseKey: signal.dedupeKey,
      observedAt: signal.createdAt,
      signalIds: [signal.signalId],
      source: signal.source,
      severity: signal.severity,
      actionability: signal.actionability,
      labels: signal.labels,
      summaries: projectAutonomyHealthSummariesForReview([signal.summary], signal.evidenceRefs),
      evidenceRefs: projectAutonomyHealthEvidenceRefsForReview(signal.evidenceRefs),
      observationCount: signal.observationCount,
    });
    const knownRecovery = signal.evidenceRefs.some((ref) => ref.moduleOperation !== undefined &&
      recoveredOperations.has(JSON.stringify([signal.source.module, ref.moduleOperation.operation])));
    const repeated = moduleSignals.filter((other) => other.dedupeKey === signal.dedupeKey &&
      other.observation !== "cleared").reduce((count, other) => count + other.observationCount, 0) > 1;
    if (signal.observation !== "cleared" && !currentIssueKeys.has(observation.issueKey) && !knownRecovery &&
      signal.severity !== "error" && signal.severity !== "critical" && !repeated) return [];
    return [observation];
  }).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const groupedObservations = review.groups.filter((group) => group.source.kind !== "module-log" && group.source.kind !== "module-operation-recovery").flatMap((group) => {
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
  return [...groupedObservations, ...moduleObservations];
}
