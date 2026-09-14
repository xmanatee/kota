import { moduleOperationLabel } from "./autonomy-issue-module-failure.js";
import {
  buildAutonomyIssueObservation,
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

function firstOccurrenceAt(observation: AutonomyIssueObservation): string {
  return [observation.observedAt, ...observation.evidenceRefs.flatMap((ref) =>
    ref.moduleOperation?.observation === "present" ? [ref.moduleOperation.observedAt] : [])]
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
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
    firstSeenAt: firstOccurrenceAt(observation),
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
        evidenceRefs: uniqueAutonomyIssueEvidenceRefs([...existing.evidenceRefs, ...observation.evidenceRefs]),
        disposition: {
          kind: "cleared" as const,
          updatedAt: observation.observedAt,
          semanticRevision: existing.semanticRevision,
        },
        links: mergeObservationLinks(existing.links, observation),
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

function moduleOperations(observation: AutonomyIssueObservation): string[] {
  const operations = observation.labels.filter((label) => label.startsWith("operation/"));
  return operations.length ? operations : ["operation/legacy-log"];
}

function retainModuleHistory(existing: AutonomyIssue, observation: AutonomyIssueObservation) {
  return {
    issue: {
      ...existing,
      firstSeenAt: Date.parse(firstOccurrenceAt(observation)) < Date.parse(existing.firstSeenAt)
        ? firstOccurrenceAt(observation) : existing.firstSeenAt,
      evidenceRefs: uniqueAutonomyIssueEvidenceRefs([...existing.evidenceRefs, ...observation.evidenceRefs]),
      summaries: uniqueAutonomyIssueStrings([...existing.summaries, ...observation.summaries]),
      history: existing.history.some((entry) => entry.observationId === observation.observationId) ? existing.history : [...existing.history, historyEntry(observation, "repeated", existing.semanticRevision)],
    },
    transition: repeatedTransition(existing),
  };
}

function moduleHistoryOccurrences(existing: AutonomyIssue): {
  occurrences: AutonomyIssueObservation[];
  hasUnattributedFailures: boolean;
  attributedFailureCount: number | null;
} {
  // Earlier auditors stamped collection time on aggregates. Cited occurrences
  // supersede that ordering; the original history remains unchanged provenance.
  const known = new Map(existing.evidenceRefs.filter((ref) => ref.moduleOperation)
    .map((ref) => [ref.ref, ref.moduleOperation!]));
  let hasUnattributedFailures = false;
  const failureRefs = new Set<string>();
  const occurrences = existing.history.flatMap((entry) => {
    const attributed = entry.evidenceRefs.flatMap((ref) => {
      const occurrence = ref.moduleOperation ?? known.get(ref.ref);
      if (occurrence?.observation === "present") failureRefs.add(`${ref.kind}:${ref.ref}`);
      return occurrence ? [{
        ...entry,
        observedAt: occurrence.observedAt,
        kind: occurrence.observation,
        labels: [moduleOperationLabel(occurrence.operation)],
      }] : [];
    });
    // Until every failure citation is attributed, aggregate labels cannot prove
    // which operations failed. This includes histories with no attributable
    // citations; neither recovery nor exact counting can rely on those labels.
    if (entry.kind !== "cleared" && (attributed.length === 0 || attributed.length < entry.evidenceRefs.length)) {
      hasUnattributedFailures = true;
    }
    // A legacy clear records a review decision, not an operation success time.
    // Preserve it in history, but only cited occurrences establish chronology.
    return attributed.length ? attributed : entry.kind === "cleared" ? [] : [entry];
  });
  return { occurrences, hasUnattributedFailures, attributedFailureCount: hasUnattributedFailures ? null : failureRefs.size };
}

function enrichModuleObservationEvidence(existing: AutonomyIssue, observation: AutonomyIssueObservation): AutonomyIssue {
  // An audit is identified by its latest failure, so backfill can add cited
  // occurrences to that same observation. Keep its identity and disposition,
  // while enrolling those citations in the history used for chronology/counts.
  const enriched = {
    ...existing,
    evidenceRefs: uniqueAutonomyIssueEvidenceRefs([...existing.evidenceRefs, ...observation.evidenceRefs]),
    history: existing.history.map((entry) => entry.observationId === observation.observationId
      ? { ...entry, evidenceRefs: uniqueAutonomyIssueEvidenceRefs([...entry.evidenceRefs, ...observation.evidenceRefs]) }
      : entry),
  };
  const history = moduleHistoryOccurrences(enriched);
  const times = history.occurrences
    .filter((entry) => entry.kind !== "cleared").map((entry) => entry.observedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return { ...enriched,
    firstSeenAt: history.hasUnattributedFailures ? existing.firstSeenAt : times[0] ?? existing.firstSeenAt,
    lastSeenAt: history.hasUnattributedFailures ? existing.lastSeenAt : times.at(-1) ?? existing.lastSeenAt };
}

function applyModuleObservation(existing: AutonomyIssue, observation: AutonomyIssueObservation) {
  const latest = new Map<string, AutonomyIssueObservation>();
  const history = moduleHistoryOccurrences(existing);
  for (const occurrence of history.occurrences) {
    for (const operation of moduleOperations(occurrence)) {
      const previous = latest.get(operation);
      if (!previous || Date.parse(occurrence.observedAt) > Date.parse(previous.observedAt) ||
        (Date.parse(occurrence.observedAt) === Date.parse(previous.observedAt) && occurrence.kind === "cleared")) latest.set(operation, occurrence);
    }
  }
  const operations = moduleOperations(observation);
  const advances = operations.some((operation) => {
    const previous = latest.get(operation);
    return !previous || Date.parse(observation.observedAt) > Date.parse(previous.observedAt) ||
      (Date.parse(observation.observedAt) === Date.parse(previous.observedAt) && observation.kind === "cleared" && previous.kind !== "cleared");
  });
  if (!advances) {
    if (observation.kind === "cleared" && existing.status !== "resolved" && !history.hasUnattributedFailures &&
      [...latest.values()].every((entry) => entry.kind === "cleared")) return applyClear(existing, observation);
    return retainModuleHistory(existing, observation);
  }
  if (observation.kind === "cleared") {
    for (const operation of operations) {
      const previous = latest.get(operation);
      if (!previous || Date.parse(observation.observedAt) >= Date.parse(previous.observedAt)) latest.set(operation, observation);
    }
    // One root cause can affect several operations. A successful poll says
    // nothing about a failed send (including unattributed legacy diagnostics).
    if (history.hasUnattributedFailures || [...latest.values()].some((entry) => entry.kind !== "cleared") || existing.status === "resolved") {
      return retainModuleHistory(existing, observation);
    }
    return applyClear(existing, observation);
  }
  const priorOperation = latest.get(operations[0]!);
  const result = applyPresent({
    ...existing,
    semanticFingerprint: priorOperation?.semanticFingerprint ?? existing.semanticFingerprint,
  }, observation);
  result.issue.firstSeenAt = Date.parse(firstOccurrenceAt(observation)) < Date.parse(existing.firstSeenAt)
    ? firstOccurrenceAt(observation) : existing.firstSeenAt;
  result.issue.lastSeenAt = Date.parse(observation.observedAt) > Date.parse(existing.lastSeenAt)
    ? observation.observedAt : existing.lastSeenAt;
  result.issue.labels = uniqueAutonomyIssueStrings([...existing.labels, ...observation.labels]);
  return result;
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
    if (observation.source.kind === "module-log" && observation.kind === "cleared" && existing.status !== "resolved") {
      return applyModuleObservation(existing, observation);
    }
    return {
      issue: observation.source.kind === "module-log"
        ? enrichModuleObservationEvidence(existing, observation) : existing,
      transition: repeatedTransition(existing),
    };
  }
  if (existing && observation.source.kind === "module-log") return applyModuleObservation(existing, observation);
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
  const recoveries = new Map((current.moduleRecoveries ?? []).map((recovery) =>
    [JSON.stringify([recovery.module, recovery.operation]), recovery]));
  for (const observation of observations) {
    if (observation.source.kind !== "module-operation-recovery") continue;
    for (const ref of observation.evidenceRefs) {
      const occurrence = ref.moduleOperation;
      if (!occurrence || occurrence.observation !== "cleared" || !observation.source.module) {
        throw new Error("operation recovery requires attributed success evidence");
      }
      const key = JSON.stringify([observation.source.module, occurrence.operation]);
      const previous = recoveries.get(key);
      if (!previous || Date.parse(occurrence.observedAt) > Date.parse(previous.observedAt)) {
        recoveries.set(key, {
          module: observation.source.module, operation: occurrence.operation,
          observedAt: occurrence.observedAt, observationId: observation.observationId,
          evidenceRefs: observation.evidenceRefs,
        });
      }
    }
  }

  const byKey = new Map(current.issues.map((issue) => [issue.issueKey, issue]));
  // Enrich old references before replay, even if the new observation is a
  // duplicate or an earlier failure. Collection time never replaces log time.
  for (const observation of observations) {
    const existing = byKey.get(observation.issueKey);
    if (!existing || observation.source.kind !== "module-log") continue;
    byKey.set(existing.issueKey, enrichModuleObservationEvidence(existing, observation));
  }

  const transitions: AutonomyIssueTransition[] = [];
  let updatedAt = current.updatedAt;
  const apply = (observation: AutonomyIssueObservation) => {
    const result = applyObservation(byKey.get(observation.issueKey), observation);
    byKey.set(observation.issueKey, result.issue);
    transitions.push(result.transition);
    return result.transition;
  };
  const applyRecoveries = (issue: AutonomyIssue) => {
    const operations = new Set([
      ...moduleHistoryOccurrences(issue).occurrences.flatMap(moduleOperations),
      // Legacy clear labels can route success evidence to an existing lineage;
      // their review timestamps never establish a recovery boundary.
      ...issue.history.filter((entry) => entry.kind === "cleared").flatMap(moduleOperations),
    ]);
    for (const recovery of recoveries.values()) {
      if (issue.source.kind !== "module-log" || issue.source.module !== recovery.module ||
        !operations.has(moduleOperationLabel(recovery.operation))) continue;
      apply(buildAutonomyIssueObservation({
        kind: "cleared", rootCauseKey: issue.rootCauseKey,
        observedAt: recovery.observedAt, signalIds: [recovery.observationId],
        source: issue.source, severity: issue.severity, actionability: issue.actionability,
        labels: [moduleOperationLabel(recovery.operation)],
        summaries: [], evidenceRefs: recovery.evidenceRefs, observationCount: 1,
      }));
    }
  };
  // Reconcile already-persisted issues before handling newer failures.
  for (const issue of byKey.values()) applyRecoveries(issue);
  for (const observation of observations) {
    let changed = observation.source.kind === "module-operation-recovery";
    if (!changed) {
      const transition = apply(observation);
      changed = transition.kind !== "replayed" || observation.source.kind === "module-log";
      applyRecoveries(byKey.get(observation.issueKey)!);
    }
    if (changed && (updatedAt === null || Date.parse(observation.observedAt) > Date.parse(updatedAt))) updatedAt = observation.observedAt;
  }
  return {
    projection: {
      schemaVersion: 1, updatedAt,
      issues: [...byKey.values()].map((issue) => {
        const history = issue.source.kind === "module-log" ? moduleHistoryOccurrences(issue) : null;
        const recoveredAt = history?.occurrences.filter((entry) => entry.kind === "cleared")
          .map((entry) => entry.observedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
        return {
          ...issue,
          occurrenceCount: history?.attributedFailureCount ?? issue.occurrenceCount,
          disposition: issue.status === "resolved" && recoveredAt
            ? { ...issue.disposition, updatedAt: recoveredAt } : issue.disposition,
          // Link retirement is a batch outcome. An intermediate recovery must not
          // orphan a pending question when other failures keep the issue active.
          links: issue.status === "resolved" ? { ...issue.links, ownerQuestionIds: [] } : issue.links,
        };
      }).sort((left, right) => left.issueKey.localeCompare(right.issueKey)),
      ...(recoveries.size ? { moduleRecoveries: [...recoveries.values()].sort((a, b) =>
        a.module.localeCompare(b.module) || a.operation.localeCompare(b.operation)) } : {}),
    },
    transitions: transitions.filter((transition) => {
      const issue = byKey.get(transition.issueKey)!;
      if (issue.source.kind !== "module-log") return true;
      const relevant = transitions.filter((item) => item.issueKey === transition.issueKey &&
        (issue.status === "resolved" ? item.kind === "cleared" : item.requiresDecision));
      const selected = relevant.at(-1);
      return selected ? transition === selected : transition === transitions.filter((item) => item.issueKey === transition.issueKey).at(-1);
    }),
  };
}
