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
  const clearedIssueKeys = new Set(projected.transitions
    .filter((transition) => transition.kind === "cleared").map((transition) => transition.issueKey));
  // Intermediate clears are history; only a final resolution can retire repair work.
  const taskMutations = projected.projection.issues.flatMap((issue) => {
    if (issue.status !== "resolved" || !clearedIssueKeys.has(issue.issueKey)) return [];
    const proposalKey = normalizeGeneratedWorkProposalKey(
      `autonomy-issue:${issue.issueKey}`,
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
    if (transition.kind !== "cleared" || issueByKey.get(transition.issueKey)?.status !== "resolved") return [];
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
  // Every occurrence keeps its revision, identity and chronology across merged flushes.
  const signals = [...new Map(review.signals.map((signal) => [signal.signalId, signal])).values()]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const failureCounts = new Map<string, number>();
  for (const signal of signals) {
    if (signal.observation !== "cleared") failureCounts.set(signal.dedupeKey,
      (failureCounts.get(signal.dedupeKey) ?? 0) + signal.observationCount);
  }
  const recoveredOperations = new Set([
    ...(currentProjection.moduleRecoveries ?? []).map((recovery) => JSON.stringify([recovery.module, recovery.operation])),
    ...signals.filter((signal) => signal.source.kind === "module-operation-recovery")
      .flatMap((signal) => signal.evidenceRefs.flatMap((ref) => ref.moduleOperation?.observation === "cleared"
        ? [JSON.stringify([signal.source.module, ref.moduleOperation.operation])] : [])),
  ]);
  return signals.flatMap((signal) => {
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
    const moduleObservation = signal.source.kind === "module-log" || signal.source.kind === "module-operation-recovery";
    const knownRecovery = moduleObservation && signal.evidenceRefs.some((ref) => ref.moduleOperation !== undefined &&
      recoveredOperations.has(JSON.stringify([signal.source.module, ref.moduleOperation.operation])));
    const knownIssue = currentIssueKeys.has(observation.issueKey);
    if (signal.observation === "cleared") {
      if (!moduleObservation && !knownIssue) return [];
    } else {
      if (!knownIssue && !knownRecovery && signal.severity !== "error" && signal.severity !== "critical" &&
        (failureCounts.get(signal.dedupeKey) ?? 0) <= 1) return [];
      currentIssueKeys.add(observation.issueKey);
    }
    return [observation];
  });
}
