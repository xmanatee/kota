import { createHash } from "node:crypto";

export const WORKFLOW_CONTINUATION_DECISIONS = [
  "continue",
  "decompose",
  "preserve-yield",
  "needs-owner",
] as const;

export type WorkflowContinuationDecisionKind =
  (typeof WORKFLOW_CONTINUATION_DECISIONS)[number];

export type WorkflowContinuationBoundaryKind =
  | "active-verification-churn"
  | "active-workspace-churn"
  | "higher-priority-work"
  | "material-scope-expansion"
  | "repeated-repair"
  | "unresolved-acceptance";

export type WorkflowContinuationQueueItem = Readonly<{
  id: string;
  title: string;
  priority: number;
  priorityLabel: string;
  resource: string;
}>;

export type WorkflowContinuationContext = Readonly<{
  taskContract: string;
  current: Readonly<{
    id: string;
    priority: number;
    priorityLabel: string;
  }>;
  queue: Readonly<{
    revision: string;
    available: readonly WorkflowContinuationQueueItem[];
  }>;
}>;

export type WorkflowContinuationVerificationResult = Readonly<{
  id: string;
  passed: boolean;
  output: string;
}>;

export type WorkflowContinuationRepairEvidence = Readonly<{
  attempt: number;
  source: "active" | "repair";
  verificationResults: readonly WorkflowContinuationVerificationResult[];
  workspaceFingerprint: string;
  changedPaths: readonly string[];
}>;

export type WorkflowContinuationPacket = Readonly<{
  version: 2;
  evidenceFingerprint: string;
  boundaryKey: string;
  boundaries: readonly WorkflowContinuationBoundaryKind[];
  taskContract: string;
  workspace: Readonly<{
    fingerprint: string;
    changedPaths: readonly string[];
    diffStat: string;
    diff: string;
  }>;
  verificationTrajectory: readonly WorkflowContinuationRepairEvidence[];
  remainingFailures: readonly Readonly<{ id: string; output: string }>[];
  queue: WorkflowContinuationContext["queue"];
  current: WorkflowContinuationContext["current"];
  higherPriorityWork: readonly WorkflowContinuationQueueItem[];
}>;

export type WorkflowContinuationDecision = Readonly<{
  decision: WorkflowContinuationDecisionKind;
  rationale: string;
  nextAction: string;
}>;

export type WorkflowContinuationRecord = Readonly<{
  stepId: string;
  decidedAt: string;
  packet: WorkflowContinuationPacket;
  decision: WorkflowContinuationDecision;
}>;

/**
 * Internal control signal used to stop an active writer before continuation
 * evidence is captured and judged. Harness promises must settle only after
 * their execution can no longer mutate the workspace.
 */
export class WorkflowContinuationCheckpointRequest extends Error {
  readonly sessionId: string | undefined;

  constructor(sessionId: string | undefined) {
    super("Agent continuation boundary requires a quiescent checkpoint");
    this.name = "WorkflowContinuationCheckpointRequest";
    this.sessionId = sessionId;
  }
}

export type ContinuationBoundaryInput = Readonly<{
  context: WorkflowContinuationContext;
  initialWorkspace: WorkflowContinuationRepairEvidence;
  trajectory: readonly WorkflowContinuationRepairEvidence[];
  currentWorkspace: Readonly<{
    fingerprint: string;
    changedPaths: readonly string[];
  }>;
  remainingFailureIds: readonly string[];
}>;

function compactText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = "\n[... continuation packet truncated ...]\n";
  const retained = limit - marker.length;
  const head = Math.ceil(retained / 2);
  return `${value.slice(0, head)}${marker}${value.slice(-(retained - head))}`;
}

// This object becomes both an AI prompt and durable run evidence. Bound every
// repeated or free-form surface so longer runs cannot amplify either one.
const CONTINUATION_PACKET_LIMITS = Object.freeze({
  taskContract: 4_000,
  workspaceDiffStat: 2_000,
  workspaceDiff: 10_000,
  currentChangedPaths: 20,
  trajectoryEntries: 5,
  trajectoryChangedPaths: 6,
  verificationResultsPerEntry: 3,
  verificationOutput: 800,
  remainingFailures: 6,
  remainingFailureOutput: 1_000,
  queueItems: 12,
  queueTitle: 400,
  path: 240,
});

function boundedSequence<T>(values: readonly T[], limit: number): readonly T[] {
  if (values.length <= limit) return [...values];
  const headLength = Math.ceil(limit / 2);
  return [
    ...values.slice(0, headLength),
    ...values.slice(-(limit - headLength)),
  ];
}

function compactPaths(
  paths: readonly string[],
  limit: number,
): readonly string[] {
  return boundedSequence(paths, limit).map((path) =>
    compactText(path, CONTINUATION_PACKET_LIMITS.path)
  );
}

function compactQueueItem(
  item: WorkflowContinuationQueueItem,
): WorkflowContinuationQueueItem {
  return Object.freeze({
    ...item,
    title: compactText(item.title, CONTINUATION_PACKET_LIMITS.queueTitle),
  });
}

function compactTrajectory(
  trajectory: readonly WorkflowContinuationRepairEvidence[],
): readonly WorkflowContinuationRepairEvidence[] {
  return Object.freeze(
    boundedSequence(
      trajectory,
      CONTINUATION_PACKET_LIMITS.trajectoryEntries,
    ).map((entry) =>
      Object.freeze({
        ...entry,
        verificationResults: Object.freeze(
          boundedSequence(
            entry.verificationResults,
            CONTINUATION_PACKET_LIMITS.verificationResultsPerEntry,
          ).map((result) =>
            Object.freeze({
              ...result,
              output: compactText(
                result.output,
                CONTINUATION_PACKET_LIMITS.verificationOutput,
              ),
            })
          ),
        ),
        changedPaths: Object.freeze(
          compactPaths(
            entry.changedPaths,
            CONTINUATION_PACKET_LIMITS.trajectoryChangedPaths,
          ),
        ),
      })
    ),
  );
}

function strictFailureConvergence(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  const previousSet = new Set(previous);
  return current.length < previousSet.size &&
    current.every((id) => previousSet.has(id));
}

function evidenceFailureIds(
  evidence: WorkflowContinuationRepairEvidence,
): readonly string[] {
  return evidence.verificationResults
    .filter((result) => !result.passed)
    .map((result) => result.id);
}

function hasActiveVerificationChurn(
  trajectory: readonly WorkflowContinuationRepairEvidence[],
): boolean {
  let previousFailures:
    | readonly WorkflowContinuationVerificationResult[]
    | undefined;
  for (const entry of trajectory) {
    if (entry.source !== "active" || entry.verificationResults.length === 0) {
      continue;
    }
    const currentFailures = entry.verificationResults
      .filter((result) => !result.passed)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (currentFailures.length === 0) {
      previousFailures = undefined;
      continue;
    }
    if (
      previousFailures?.every((previous) =>
        currentFailures.some(
          (current) =>
            current.id === previous.id && current.output === previous.output,
        )
      )
    ) {
      return true;
    }
    previousFailures = currentFailures;
  }
  return false;
}

function hasActiveWorkspaceChurn(
  initialWorkspace: WorkflowContinuationRepairEvidence,
  trajectory: readonly WorkflowContinuationRepairEvidence[],
): boolean {
  let lastFingerprint = initialWorkspace.workspaceFingerprint;
  let unverifiedRevisions = 0;
  for (const entry of trajectory) {
    if (entry.source !== "active") continue;
    if (entry.workspaceFingerprint !== lastFingerprint) {
      lastFingerprint = entry.workspaceFingerprint;
      unverifiedRevisions = entry.verificationResults.length > 0
        ? 0
        : unverifiedRevisions + 1;
    } else if (entry.verificationResults.length > 0) {
      unverifiedRevisions = 0;
    }
  }
  return unverifiedRevisions >= 3;
}

function materiallyExpanded(
  initialPaths: readonly string[],
  currentPaths: readonly string[],
): boolean {
  const initial = new Set(initialPaths);
  const added = currentPaths.filter((path) => !initial.has(path));
  return added.length >= 3 &&
    currentPaths.length >= Math.max(4, initial.size * 2);
}

/** Detect a semantic review boundary; the capable agent still owns the decision. */
export function continuationBoundaries(
  input: ContinuationBoundaryInput,
): readonly WorkflowContinuationBoundaryKind[] {
  const boundaries = new Set<WorkflowContinuationBoundaryKind>();
  if (hasActiveVerificationChurn(input.trajectory)) {
    boundaries.add("active-verification-churn");
    boundaries.add("unresolved-acceptance");
  }
  if (hasActiveWorkspaceChurn(input.initialWorkspace, input.trajectory)) {
    boundaries.add("active-workspace-churn");
    boundaries.add("unresolved-acceptance");
  }
  if (
    input.context.queue.available.some(
      (candidate) =>
        candidate.id !== input.context.current.id &&
        candidate.priority < input.context.current.priority,
    )
  ) {
    boundaries.add("higher-priority-work");
  }
  if (
    materiallyExpanded(
      input.initialWorkspace.changedPaths,
      input.currentWorkspace.changedPaths,
    )
  ) {
    boundaries.add("material-scope-expansion");
  }
  const repairTrajectory = input.trajectory.filter(
    (entry) => entry.source === "repair",
  );
  const previous = repairTrajectory.at(-2);
  if (
    repairTrajectory.length >= 2 &&
    previous !== undefined &&
    !strictFailureConvergence(
      evidenceFailureIds(previous),
      input.remainingFailureIds,
    )
  ) {
    boundaries.add("repeated-repair");
    boundaries.add("unresolved-acceptance");
  }
  return [...boundaries].sort((left, right) => left.localeCompare(right));
}

function boundaryKey(
  boundaries: readonly WorkflowContinuationBoundaryKind[],
  higherPriorityWork: readonly WorkflowContinuationQueueItem[],
): string {
  const boundaryKinds = [...boundaries].sort().join("|");
  if (higherPriorityWork.length === 0) return boundaryKinds;
  const higherPrioritySet = higherPriorityWork
    .map((item) => item.resource)
    .sort();
  const prioritySetFingerprint = createHash("sha256")
    .update(JSON.stringify(higherPrioritySet))
    .digest("hex")
    .slice(0, 16);
  return `${boundaryKinds}|higher-priority-set:${prioritySetFingerprint}`;
}

function continuationEvidenceFingerprint(input: {
  boundaryKey: string;
  trajectory: readonly WorkflowContinuationRepairEvidence[];
  currentWorkspace: {
    fingerprint: string;
    changedPaths: readonly string[];
    diffStat: string;
    diff: string;
  };
  remainingFailures: readonly Readonly<{ id: string; output: string }>[];
  queue: WorkflowContinuationContext["queue"];
}): string {
  const evidence = {
    boundaryKey: input.boundaryKey,
    workspace: {
      fingerprint: input.currentWorkspace.fingerprint,
      changedPaths: [...input.currentWorkspace.changedPaths].sort(),
      diffStat: input.currentWorkspace.diffStat,
      diff: input.currentWorkspace.diff,
    },
    trajectory: input.trajectory,
    remainingFailures: [...input.remainingFailures]
      .map((failure) => ({ id: failure.id, output: failure.output }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    queue: {
      revision: input.queue.revision,
      available: [...input.queue.available]
        .map((item) => ({
          id: item.id,
          priority: item.priority,
          priorityLabel: item.priorityLabel,
          resource: item.resource,
          title: item.title,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
  };
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export function createContinuationPacket(input: {
  context: WorkflowContinuationContext;
  initialWorkspace: WorkflowContinuationRepairEvidence;
  trajectory: readonly WorkflowContinuationRepairEvidence[];
  currentWorkspace: {
    fingerprint: string;
    changedPaths: readonly string[];
    diffStat: string;
    diff: string;
  };
  remainingFailures: readonly Readonly<{ id: string; output: string }>[];
}): WorkflowContinuationPacket | null {
  const boundaries = continuationBoundaries({
    context: input.context,
    initialWorkspace: input.initialWorkspace,
    trajectory: input.trajectory,
    currentWorkspace: input.currentWorkspace,
    remainingFailureIds: input.remainingFailures.map((failure) => failure.id),
  });
  if (boundaries.length === 0) return null;

  const higherPriorityWork = input.context.queue.available
    .filter(
      (candidate) =>
        candidate.id !== input.context.current.id &&
        candidate.priority < input.context.current.priority,
    )
    .sort((left, right) =>
      left.priority - right.priority || left.id.localeCompare(right.id)
    );
  const key = boundaryKey(boundaries, higherPriorityWork);
  const compactedTrajectory = compactTrajectory(input.trajectory);
  const compactedWorkspace = Object.freeze({
    fingerprint: input.currentWorkspace.fingerprint,
    changedPaths: Object.freeze(
      compactPaths(
        input.currentWorkspace.changedPaths,
        CONTINUATION_PACKET_LIMITS.currentChangedPaths,
      ),
    ),
    diffStat: compactText(
      input.currentWorkspace.diffStat,
      CONTINUATION_PACKET_LIMITS.workspaceDiffStat,
    ),
    diff: compactText(
      input.currentWorkspace.diff,
      CONTINUATION_PACKET_LIMITS.workspaceDiff,
    ),
  });
  const compactedFailures = Object.freeze(
    boundedSequence(
      [...input.remainingFailures].sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
      CONTINUATION_PACKET_LIMITS.remainingFailures,
    ).map((failure) =>
      Object.freeze({
        id: failure.id,
        output: compactText(
          failure.output,
          CONTINUATION_PACKET_LIMITS.remainingFailureOutput,
        ),
      })
    ),
  );
  const compactedQueue = Object.freeze({
    revision: input.context.queue.revision,
    available: Object.freeze(
      [...input.context.queue.available]
        .sort((left, right) =>
          left.priority - right.priority || left.id.localeCompare(right.id)
        )
        .slice(0, CONTINUATION_PACKET_LIMITS.queueItems)
        .map(compactQueueItem),
    ),
  });
  const compactedHigherPriorityWork = Object.freeze(
    higherPriorityWork
      .slice(0, CONTINUATION_PACKET_LIMITS.queueItems)
      .map(compactQueueItem),
  );
  const evidenceFingerprint = continuationEvidenceFingerprint({
    boundaryKey: key,
    trajectory: compactedTrajectory,
    currentWorkspace: compactedWorkspace,
    remainingFailures: compactedFailures,
    queue: compactedQueue,
  });

  return Object.freeze({
    version: 2,
    evidenceFingerprint,
    boundaryKey: key,
    boundaries,
    taskContract: compactText(
      input.context.taskContract,
      CONTINUATION_PACKET_LIMITS.taskContract,
    ),
    workspace: compactedWorkspace,
    verificationTrajectory: compactedTrajectory,
    remainingFailures: compactedFailures,
    queue: compactedQueue,
    current: input.context.current,
    higherPriorityWork: compactedHigherPriorityWork,
  });
}

export function continuationPacketNeedsJudgment(
  records: readonly WorkflowContinuationRecord[],
  stepId: string,
  packet: WorkflowContinuationPacket,
): boolean {
  let prior: WorkflowContinuationRecord | undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index];
    if (
      candidate.stepId === stepId &&
      candidate.packet.boundaryKey === packet.boundaryKey
    ) {
      prior = candidate;
      break;
    }
  }
  if (prior === undefined) return true;
  if (prior.packet.evidenceFingerprint === packet.evidenceFingerprint) {
    return false;
  }
  if (prior.decision.decision !== "continue") return false;
  return continuationEvidenceMateriallyWorsened(prior.packet, packet);
}

function latestTrajectoryAttempt(
  packet: WorkflowContinuationPacket,
  source: WorkflowContinuationRepairEvidence["source"],
): number {
  return packet.verificationTrajectory
    .filter((entry) => entry.source === source)
    .reduce((latest, entry) => Math.max(latest, entry.attempt), 0);
}

function trajectoryMateriallyExpanded(
  prior: WorkflowContinuationPacket,
  current: WorkflowContinuationPacket,
  source: WorkflowContinuationRepairEvidence["source"],
): boolean {
  const priorAttempt = latestTrajectoryAttempt(prior, source);
  const currentAttempt = latestTrajectoryAttempt(current, source);
  if (currentAttempt <= priorAttempt) return false;
  // Re-open a continued boundary as unresolved evidence grows geometrically.
  // This gives changing-but-unproductive runs renewed authority without
  // turning the judge into an every-iteration or fixed-cadence reviewer.
  return currentAttempt >= Math.max(2, priorAttempt * 2);
}

function failuresMateriallyWorsened(
  prior: WorkflowContinuationPacket,
  current: WorkflowContinuationPacket,
): boolean {
  const priorIds = new Set(prior.remainingFailures.map((failure) => failure.id));
  const currentIds = new Set(
    current.remainingFailures.map((failure) => failure.id),
  );
  return currentIds.size > priorIds.size &&
    [...priorIds].every((id) => currentIds.has(id));
}

function diffMateriallyExpanded(
  prior: WorkflowContinuationPacket,
  current: WorkflowContinuationPacket,
): boolean {
  const priorLength = prior.workspace.diff.length;
  const currentLength = current.workspace.diff.length;
  return currentLength >= Math.max(priorLength * 2, priorLength + 2_000);
}

/**
 * A recorded continue decision suppresses volatile churn at the same semantic
 * boundary, but not evidence that has become materially riskier since that
 * decision. Relative/geometric thresholds keep the policy evidence-driven and
 * ensure each renewed decision becomes the baseline for the next one.
 */
function continuationEvidenceMateriallyWorsened(
  prior: WorkflowContinuationPacket,
  current: WorkflowContinuationPacket,
): boolean {
  return failuresMateriallyWorsened(prior, current) ||
    materiallyExpanded(
      prior.workspace.changedPaths,
      current.workspace.changedPaths,
    ) ||
    diffMateriallyExpanded(prior, current) ||
    trajectoryMateriallyExpanded(prior, current, "repair") ||
    trajectoryMateriallyExpanded(prior, current, "active");
}

export function assertContinuationDecision(
  value: WorkflowContinuationDecision,
): WorkflowContinuationDecision {
  if (!WORKFLOW_CONTINUATION_DECISIONS.includes(value.decision)) {
    throw new Error(
      `Unknown continuation decision "${String(value.decision)}"`,
    );
  }
  if (!value.rationale.trim()) {
    throw new Error("Continuation decision rationale must not be empty");
  }
  if (!value.nextAction.trim()) {
    throw new Error("Continuation decision nextAction must not be empty");
  }
  return Object.freeze({
    decision: value.decision,
    rationale: value.rationale.trim(),
    nextAction: value.nextAction.trim(),
  });
}
