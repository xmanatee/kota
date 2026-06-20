import {
  PROGRESS_REVIEW_AGENT_KIND_LIMITS,
  PROGRESS_REVIEW_AGENT_MAX_EVIDENCE,
  PROGRESS_REVIEW_ARTIFACT,
} from "./constants.js";
import type {
  ProgressReviewAgentEvidencePacket,
  ProgressReviewDeadLetterEvidence,
  ProgressReviewEvidenceCounts,
  ProgressReviewEvidencePacket,
  ProgressReviewEvidenceRef,
  ProgressReviewScopeEvidence,
} from "./types.js";

export function toEvidenceRef(evidence: ProgressReviewEvidenceRef): ProgressReviewEvidenceRef {
  return {
    id: evidence.id,
    kind: evidence.kind,
    summary: evidence.summary,
    ...(evidence.path ? { path: evidence.path } : {}),
  };
}

export function evidenceRefs(args: {
  runs: readonly ProgressReviewEvidenceRef[];
  tasks: readonly ProgressReviewEvidenceRef[];
  events: readonly ProgressReviewEvidenceRef[];
  artifacts: readonly ProgressReviewEvidenceRef[];
  git: readonly ProgressReviewEvidenceRef[];
  ownerQuestions: readonly ProgressReviewEvidenceRef[];
  approvals: readonly ProgressReviewEvidenceRef[];
  deadLetters: readonly ProgressReviewEvidenceRef[];
}): ProgressReviewEvidenceRef[] {
  return [
    ...args.runs,
    ...args.tasks,
    ...args.events,
    ...args.artifacts,
    ...args.git,
    ...args.ownerQuestions,
    ...args.approvals,
    ...args.deadLetters,
  ].map(toEvidenceRef);
}

export function cloneEvidenceItem<T extends ProgressReviewEvidenceRef>(item: T): T {
  return { ...item };
}

export function cloneDeadLetterEvidence(
  item: ProgressReviewDeadLetterEvidence,
): ProgressReviewDeadLetterEvidence {
  return {
    ...item,
    affectedWorkflowNames: [...item.affectedWorkflowNames],
    sourceEventIds: [...item.sourceEventIds],
  };
}

function progressReviewEvidenceCounts(
  packet: Pick<
    ProgressReviewEvidencePacket | ProgressReviewScopeEvidence,
    | "runs"
    | "tasks"
    | "events"
    | "artifacts"
    | "git"
    | "ownerQuestions"
    | "approvals"
    | "deadLetters"
    | "evidence"
    | "taskClassDistribution"
  >,
): ProgressReviewEvidenceCounts {
  return {
    runs: packet.runs.length,
    tasks: packet.tasks.length,
    events: packet.events.length,
    artifacts: packet.artifacts.length,
    git: packet.git.length,
    ownerQuestions: packet.ownerQuestions.length,
    approvals: packet.approvals.length,
    deadLetters: packet.deadLetters.length,
    evidence: packet.evidence.length,
    taskClasses: packet.taskClassDistribution,
  };
}

function agentEvidenceKindOrder(kind: ProgressReviewEvidenceRef["kind"]): number {
  switch (kind) {
    case "run":
      return 0;
    case "task":
      return 1;
    case "event":
      return 2;
    case "dead-letter":
      return 3;
    case "approval":
      return 4;
    case "owner-question":
      return 5;
    case "artifact":
      return 6;
    case "git":
      return 7;
  }
}

const HIGH_SIGNAL_ARTIFACTS = new Map<string, number>([
  ["acceptance-evidence.txt", -40],
  ["critic-review.json", -40],
  ["evaluator-calibration.json", -35],
  ["run-summary.json", -35],
  ["success-criteria-verified.txt", -30],
  ["success-criteria.txt", -30],
  ["blocker-actions.json", -25],
  ["promotion-rationale.json", -25],
  ["exploration-rationale.json", -25],
  ["error.txt", -25],
  ["commit-message.txt", -10],
]);

function artifactFileFromEvidenceId(id: string): string | null {
  const marker = ":artifact:";
  const markerIndex = id.indexOf(marker);
  const artifactRef = id.startsWith("artifact:")
    ? id.slice("artifact:".length)
    : markerIndex >= 0
      ? id.slice(markerIndex + marker.length)
      : null;
  if (artifactRef === null) return null;
  const fileSeparator = artifactRef.indexOf(":");
  if (fileSeparator < 0) return null;
  return artifactRef.slice(fileSeparator + 1);
}

function agentArtifactEvidencePriority(evidence: ProgressReviewEvidenceRef): number {
  const file = artifactFileFromEvidenceId(evidence.id);
  if (!file) return 0;
  const highSignalPriority = HIGH_SIGNAL_ARTIFACTS.get(file);
  if (highSignalPriority !== undefined) return highSignalPriority;
  if (file.startsWith("steps/")) {
    return file.endsWith(".input.md") ? 2 : 1;
  }
  return 0;
}

function agentEvidencePriority(evidence: ProgressReviewEvidenceRef): number {
  if (evidence.kind === "git" && evidence.id.includes(":file:")) return 1;
  if (evidence.kind === "artifact") return agentArtifactEvidencePriority(evidence);
  return 0;
}

function compactAgentEvidence(
  evidence: readonly ProgressReviewEvidenceRef[],
): { evidence: ProgressReviewEvidenceRef[]; omittedCount: number } {
  const buckets = new Map<ProgressReviewEvidenceRef["kind"], ProgressReviewEvidenceRef[]>();
  for (const item of evidence) {
    const bucket = buckets.get(item.kind) ?? [];
    bucket.push(item);
    buckets.set(item.kind, bucket);
  }

  const selected: ProgressReviewEvidenceRef[] = [];
  let omittedCount = 0;
  const kinds = [...buckets.keys()].sort(
    (a, b) => agentEvidenceKindOrder(a) - agentEvidenceKindOrder(b),
  );
  for (const kind of kinds) {
    const limit = PROGRESS_REVIEW_AGENT_KIND_LIMITS[kind];
    const bucket = [...(buckets.get(kind) ?? [])].sort((a, b) => {
      const byPriority = agentEvidencePriority(a) - agentEvidencePriority(b);
      return byPriority !== 0 ? byPriority : a.id.localeCompare(b.id);
    });
    const remaining = PROGRESS_REVIEW_AGENT_MAX_EVIDENCE - selected.length;
    if (remaining <= 0) {
      omittedCount += bucket.length;
      continue;
    }
    const take = Math.min(limit, remaining);
    selected.push(...bucket.slice(0, take));
    omittedCount += Math.max(0, bucket.length - take);
  }
  return { evidence: selected, omittedCount };
}

export function compactProgressReviewEvidenceForAgent(
  packet: ProgressReviewEvidencePacket,
): ProgressReviewAgentEvidencePacket {
  const compacted = compactAgentEvidence(packet.evidence);
  const excluded = [...packet.excluded];
  if (compacted.omittedCount > 0) {
    excluded.push(
      `agent evidence packet: omitted ${compacted.omittedCount} lower-detail evidence refs from the prompt; full evidence remains in ${PROGRESS_REVIEW_ARTIFACT}`,
    );
  }
  return {
    generatedAt: packet.generatedAt,
    triggerKind: packet.triggerKind,
    triggerEvent: packet.triggerEvent,
    scope: packet.scope,
    window: packet.window,
    batch: packet.batch,
    scopes: packet.scopes.map((scope) => ({
      scope: scope.scope,
      window: scope.window,
      counts: progressReviewEvidenceCounts(scope),
      excluded: scope.excluded,
    })),
    counts: progressReviewEvidenceCounts(packet),
    deadLetterCounts: packet.deadLetterCounts,
    operatorJourneyRisks: packet.operatorJourneyRisks,
    evidence: compacted.evidence,
    excluded,
  };
}
