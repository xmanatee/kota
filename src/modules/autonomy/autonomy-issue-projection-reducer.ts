import {
  emptyAutonomyIssueLinks,
  uniqueAutonomyIssueEvidenceRefs,
  uniqueAutonomyIssueStrings,
} from "./autonomy-issue-observation.js";
import type {
  AutonomyIssue,
  AutonomyIssueHistoryEntry,
  AutonomyIssueLinks,
  AutonomyIssueObservation,
  AutonomyIssueProjection,
  AutonomyIssueProjectionResult,
  AutonomyIssueTransition,
  AutonomyIssueTransitionKind,
} from "./autonomy-issue-projection-types.js";

function historyEntry(
  observation: AutonomyIssueObservation,
  transition: Exclude<AutonomyIssueTransitionKind, "replayed">,
  semanticRevision: number,
): AutonomyIssueHistoryEntry {
  return { ...observation, transition, semanticRevision };
}

function mergeObservationLinks(
  links: AutonomyIssueLinks,
  observation: AutonomyIssueObservation,
): AutonomyIssueLinks {
  return {
    ...links,
    deadLetterIds: uniqueAutonomyIssueStrings([
      ...links.deadLetterIds,
      ...observation.links.deadLetterIds,
    ]),
  };
}

function newIssue(
  observation: AutonomyIssueObservation,
  transition: "opened" | "cleared",
): AutonomyIssue {
  const resolved = transition === "cleared";
  const semanticRevision = resolved ? 0 : 1;
  return {
    issueKey: observation.issueKey,
    rootCauseKey: observation.rootCauseKey,
    status: resolved ? "resolved" : "needs-decision",
    firstSeenAt: observation.observedAt,
    lastSeenAt: observation.observedAt,
    occurrenceCount: resolved ? 0 : observation.observationCount,
    severity: observation.severity,
    actionability: observation.actionability,
    labels: [...observation.labels],
    summaries: [...observation.summaries],
    evidenceRefs: [...observation.evidenceRefs],
    semanticFingerprint: observation.semanticFingerprint,
    semanticRevision,
    source: { ...observation.source },
    disposition: {
      kind: resolved ? "cleared" : "needs-decision",
      updatedAt: observation.observedAt,
      semanticRevision,
    },
    links: mergeObservationLinks(emptyAutonomyIssueLinks(), observation),
    history: [historyEntry(observation, transition, semanticRevision)],
  };
}

function repeatedTransition(issue: AutonomyIssue): AutonomyIssueTransition {
  return {
    issueKey: issue.issueKey,
    rootCauseKey: issue.rootCauseKey,
    kind: "replayed",
    semanticRevision: issue.semanticRevision,
    requiresDecision: false,
  };
}

function applyClear(
  existing: AutonomyIssue | undefined,
  observation: AutonomyIssueObservation,
): { issue: AutonomyIssue; transition: AutonomyIssueTransition } {
  const issue = existing
    ? {
        ...existing,
        status: "resolved" as const,
        disposition: {
          kind: "cleared" as const,
          updatedAt: observation.observedAt,
          semanticRevision: existing.semanticRevision,
        },
        links: {
          ...mergeObservationLinks(existing.links, observation),
          taskIds: [],
          ownerQuestionIds: [],
        },
        history: [
          ...existing.history,
          historyEntry(observation, "cleared", existing.semanticRevision),
        ],
      }
    : newIssue(observation, "cleared");
  return {
    issue,
    transition: {
      issueKey: issue.issueKey,
      rootCauseKey: issue.rootCauseKey,
      kind: "cleared",
      semanticRevision: issue.semanticRevision,
      requiresDecision: false,
    },
  };
}

function applyPresent(
  existing: AutonomyIssue,
  observation: AutonomyIssueObservation,
): { issue: AutonomyIssue; transition: AutonomyIssueTransition } {
  const reopened = existing.status === "resolved";
  const revised =
    observation.kind === "changed" ||
    observation.semanticFingerprint !== existing.semanticFingerprint;
  const kind: Exclude<AutonomyIssueTransitionKind, "cleared" | "replayed"> =
    reopened ? "reopened" : revised ? "revised" : "repeated";
  const semanticRevision =
    reopened || revised ? existing.semanticRevision + 1 : existing.semanticRevision;
  const requiresDecision = reopened || revised;
  const issue: AutonomyIssue = {
    ...existing,
    status: requiresDecision ? "needs-decision" : existing.status,
    lastSeenAt: observation.observedAt,
    occurrenceCount: existing.occurrenceCount + observation.observationCount,
    severity: observation.severity,
    actionability: observation.actionability,
    labels: [...observation.labels],
    summaries: uniqueAutonomyIssueStrings([
      ...existing.summaries,
      ...observation.summaries,
    ]),
    evidenceRefs: uniqueAutonomyIssueEvidenceRefs([
      ...existing.evidenceRefs,
      ...observation.evidenceRefs,
    ]),
    semanticFingerprint: observation.semanticFingerprint,
    semanticRevision,
    source: { ...observation.source },
    disposition: requiresDecision
      ? {
          kind: "needs-decision",
          updatedAt: observation.observedAt,
          semanticRevision,
        }
      : existing.disposition,
    links: mergeObservationLinks(existing.links, observation),
    history: [
      ...existing.history,
      historyEntry(observation, kind, semanticRevision),
    ],
  };
  return {
    issue,
    transition: {
      issueKey: issue.issueKey,
      rootCauseKey: issue.rootCauseKey,
      kind,
      semanticRevision,
      requiresDecision,
    },
  };
}

function applyObservation(
  existing: AutonomyIssue | undefined,
  observation: AutonomyIssueObservation,
): { issue: AutonomyIssue; transition: AutonomyIssueTransition } {
  if (
    existing?.history.some(
      (entry) => entry.observationId === observation.observationId,
    )
  ) {
    return { issue: existing, transition: repeatedTransition(existing) };
  }
  if (observation.kind === "cleared") return applyClear(existing, observation);
  if (!existing) {
    const issue = newIssue(observation, "opened");
    return {
      issue,
      transition: {
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        kind: "opened",
        semanticRevision: issue.semanticRevision,
        requiresDecision: true,
      },
    };
  }
  return applyPresent(existing, observation);
}

export function reduceAutonomyIssueProjection(
  current: AutonomyIssueProjection,
  observations: readonly AutonomyIssueObservation[],
): AutonomyIssueProjectionResult {
  const byKey = new Map(current.issues.map((issue) => [issue.issueKey, issue]));
  const transitions: AutonomyIssueTransition[] = [];
  let updatedAt = current.updatedAt;
  for (const observation of observations) {
    const result = applyObservation(byKey.get(observation.issueKey), observation);
    byKey.set(observation.issueKey, result.issue);
    transitions.push(result.transition);
    if (result.transition.kind !== "replayed") updatedAt = observation.observedAt;
  }
  return {
    projection: {
      schemaVersion: 1,
      updatedAt,
      issues: [...byKey.values()].sort((left, right) =>
        left.issueKey.localeCompare(right.issueKey),
      ),
    },
    transitions,
  };
}
