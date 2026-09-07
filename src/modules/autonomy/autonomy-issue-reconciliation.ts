import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { StoredRun } from "#core/workflow/run-state-database.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type AutonomyIssueDecisionRequest,
  autonomyIssueDecisionRequested,
  autonomyIssueInvestigationKey,
} from "./autonomy-issue-events.js";
import {
  type AutonomyIssue,
  type AutonomyIssueProjection,
  recordAutonomyIssueDispositions,
} from "./autonomy-issue-projection.js";

const ACTIVE_RUN_STATES = new Set<StoredRun["state"]>([
  "queued",
  "running",
  "waiting",
  "integrating",
]);

export const AUTONOMY_ISSUE_MAX_INVESTIGATION_ATTEMPTS = 3;
export const AUTONOMY_ISSUE_RETRY_INITIAL_DELAY_MS = 5 * 60 * 1000;
const AUTONOMY_ISSUE_RETRY_BACKOFF_FACTOR = 6;

export type AutonomyIssueLifecyclePhase =
  | "detected"
  | "awaiting-investigation"
  | "retrying-investigation"
  | "owned-remediation"
  | "validating"
  | "resolved"
  | "genuinely-blocked";

export type AutonomyIssueOwnerStatus = {
  issueKey: string;
  semanticRevision: number;
  phase: AutonomyIssueLifecyclePhase;
  owned: boolean;
  reason: string;
  investigationAttempts: number;
  retryAt?: string;
};

export function autonomyIssueOwnerFingerprint(issue: AutonomyIssue): string {
  return JSON.stringify({
    status: issue.status,
    disposition: issue.disposition,
    taskIds: [...issue.links.taskIds].sort(),
    ownerQuestionIds: [...issue.links.ownerQuestionIds].sort(),
  });
}

function triggerIssueIdentity(
  run: StoredRun,
): { issueKey: string; semanticRevision: number } | null {
  if (
    run.workflow !== "improver" ||
    run.trigger.event !== autonomyIssueDecisionRequested.name
  ) {
    return null;
  }
  const issueKey = run.trigger.payload.issueKey;
  const semanticRevision = run.trigger.payload.semanticRevision;
  return typeof issueKey === "string" && typeof semanticRevision === "number"
    ? { issueKey, semanticRevision }
    : null;
}

function investigationRuns(issue: AutonomyIssue, runs: readonly StoredRun[]) {
  return runs.filter((run) => {
    const identity = triggerIssueIdentity(run);
    return identity?.issueKey === issue.issueKey &&
      identity.semanticRevision === issue.semanticRevision;
  });
}

function activePublicationFor(
  attempts: readonly StoredRun[],
  runs: readonly StoredRun[],
): boolean {
  const sourceRunIds = new Set(attempts.map((run) => run.id));
  return runs.some((run) =>
    run.workflow === "improver-disposition-publication" &&
    ACTIVE_RUN_STATES.has(run.state) &&
    typeof run.trigger.payload.sourceRunId === "string" &&
    sourceRunIds.has(run.trigger.payload.sourceRunId)
  );
}

function taskOwner(
  issue: AutonomyIssue,
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): AutonomyIssueOwnerStatus | null {
  if (issue.disposition.kind !== "task") return null;
  if (issue.links.taskIds.length !== 1) {
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: "awaiting-investigation",
      owned: false,
      reason: "task disposition does not link exactly one repair task",
      investigationAttempts: 0,
    };
  }
  const task = taskById.get(issue.links.taskIds[0]!);
  if (!task || task.state === "dropped") {
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: "awaiting-investigation",
      owned: false,
      reason: "linked repair task is missing or dropped",
      investigationAttempts: 0,
    };
  }
  return {
    issueKey: issue.issueKey,
    semanticRevision: issue.semanticRevision,
    phase: task.state === "done"
      ? "validating"
      : task.state === "blocked"
        ? "genuinely-blocked"
        : "owned-remediation",
    owned: true,
    reason: `linked repair task is ${task.state}`,
    investigationAttempts: 0,
  };
}

function questionOwner(
  issue: AutonomyIssue,
  questionById: ReadonlyMap<string, PendingOwnerQuestion>,
): AutonomyIssueOwnerStatus | null {
  if (issue.disposition.kind !== "owner-question") return null;
  if (issue.links.ownerQuestionIds.length !== 1) {
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: "awaiting-investigation",
      owned: false,
      reason: "owner-question disposition does not link exactly one question",
      investigationAttempts: 0,
    };
  }
  const question = questionById.get(issue.links.ownerQuestionIds[0]!);
  return question?.status === "pending"
    ? {
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        phase: "genuinely-blocked",
        owned: true,
        reason: "linked owner question is pending",
        investigationAttempts: 0,
      }
    : {
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        phase: "awaiting-investigation",
        owned: false,
        reason: "linked owner question is missing or terminal",
        investigationAttempts: 0,
      };
}

export function inspectAutonomyIssueOwner(args: {
  issue: AutonomyIssue;
  runs: readonly StoredRun[];
  taskById: ReadonlyMap<string, RepoTaskFullRecord>;
  questionById: ReadonlyMap<string, PendingOwnerQuestion>;
  requestedAt: string;
}): AutonomyIssueOwnerStatus {
  const { issue, runs } = args;
  if (issue.status === "resolved") {
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: "resolved",
      owned: true,
      reason: "issue has a verified clear observation",
      investigationAttempts: 0,
    };
  }

  const attempts = investigationRuns(issue, runs);
  const activeAttempt = attempts.some((run) => ACTIVE_RUN_STATES.has(run.state));
  if (activeAttempt || activePublicationFor(attempts, runs)) {
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: attempts.length > 1
        ? "retrying-investigation"
        : "awaiting-investigation",
      owned: true,
      reason: activeAttempt
        ? "investigation is queued or active"
        : "disposition publication is queued or active",
      investigationAttempts: attempts.length,
    };
  }

  const task = taskOwner(issue, args.taskById);
  if (task) return { ...task, investigationAttempts: attempts.length };
  const question = questionOwner(issue, args.questionById);
  if (question) return { ...question, investigationAttempts: attempts.length };

  if (issue.disposition.kind !== "needs-decision") {
    if (issue.disposition.kind === "attention") {
      return {
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        phase: "genuinely-blocked",
        owned: true,
        reason: "investigation exhaustion is published as durable operator attention",
        investigationAttempts: attempts.length,
      };
    }
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: "validating",
      owned: true,
      reason: `explicit ${issue.disposition.kind} disposition awaits a clear observation`,
      investigationAttempts: attempts.length,
    };
  }

  if (attempts.length >= AUTONOMY_ISSUE_MAX_INVESTIGATION_ATTEMPTS) {
    return {
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      phase: "genuinely-blocked",
      owned: false,
      reason:
        `investigation retry budget exhausted after ${attempts.length} attempts; ` +
        "durable operator attention must be published",
      investigationAttempts: attempts.length,
    };
  }

  const lastAttemptAt = attempts
    .flatMap((run) => [run.finishedAt ?? run.startedAt ?? run.admittedAt])
    .sort()
    .at(-1);
  if (lastAttemptAt !== undefined) {
    const delayMs = AUTONOMY_ISSUE_RETRY_INITIAL_DELAY_MS *
      AUTONOMY_ISSUE_RETRY_BACKOFF_FACTOR ** Math.max(0, attempts.length - 1);
    const retryAt = new Date(Date.parse(lastAttemptAt) + delayMs).toISOString();
    if (Date.parse(args.requestedAt) < Date.parse(retryAt)) {
      return {
        issueKey: issue.issueKey,
        semanticRevision: issue.semanticRevision,
        phase: "retrying-investigation",
        owned: false,
        reason: `investigation requires a durable queued retry at ${retryAt}`,
        investigationAttempts: attempts.length,
        retryAt,
      };
    }
  }

  return {
    issueKey: issue.issueKey,
    semanticRevision: issue.semanticRevision,
    phase: attempts.length === 0 ? "detected" : "retrying-investigation",
    owned: false,
    reason: attempts.length === 0
      ? "issue revision has no investigation"
      : "every investigation and disposition publication is terminal",
    investigationAttempts: attempts.length,
  };
}

export function publishExhaustedInvestigationAttention(args: {
  projection: AutonomyIssueProjection;
  runs: readonly StoredRun[];
  tasks: readonly RepoTaskFullRecord[];
  questions: readonly PendingOwnerQuestion[];
  requestedAt: string;
}): AutonomyIssueProjection {
  const taskById = new Map(args.tasks.map((task) => [task.id, task]));
  const questionById = new Map(
    args.questions.map((question) => [question.id, question]),
  );
  const updates = args.projection.issues.flatMap((issue) => {
    const owner = inspectAutonomyIssueOwner({
      issue,
      runs: args.runs,
      taskById,
      questionById,
      requestedAt: args.requestedAt,
    });
    if (
      owner.owned ||
      owner.phase !== "genuinely-blocked" ||
      owner.investigationAttempts < AUTONOMY_ISSUE_MAX_INVESTIGATION_ATTEMPTS
    ) {
      return [];
    }
    return [{
      issueKey: issue.issueKey,
      semanticRevision: issue.semanticRevision,
      kind: "attention" as const,
      decidedAt: args.requestedAt,
      taskIds: [],
      ownerQuestionIds: [],
    }];
  });
  return recordAutonomyIssueDispositions({
    current: args.projection,
    updates,
  });
}

export function planAutonomyIssueOwnerReconciliation(args: {
  projection: AutonomyIssueProjection;
  runs: readonly StoredRun[];
  tasks: readonly RepoTaskFullRecord[];
  questions: readonly PendingOwnerQuestion[];
  requestedAt: string;
}): Array<AutonomyIssueDecisionRequest & {
  phase: AutonomyIssueLifecyclePhase;
  notBeforeAt?: string;
}> {
  const taskById = new Map(args.tasks.map((task) => [task.id, task]));
  const questionById = new Map(
    args.questions.map((question) => [question.id, question]),
  );
  return args.projection.issues.flatMap((issue) => {
    const owner = inspectAutonomyIssueOwner({
      issue,
      runs: args.runs,
      taskById,
      questionById,
      requestedAt: args.requestedAt,
    });
    if (
      owner.owned ||
      (owner.phase === "genuinely-blocked" &&
        owner.investigationAttempts >= AUTONOMY_ISSUE_MAX_INVESTIGATION_ATTEMPTS)
    ) {
      return [];
    }
    return [{
      issueKey: issue.issueKey,
      rootCauseKey: issue.rootCauseKey,
      semanticRevision: issue.semanticRevision,
      transition: "replayed" as const,
      observedAt: args.requestedAt,
      requestKind: "reconciliation" as const,
      ownerFingerprint: autonomyIssueOwnerFingerprint(issue),
      idempotencyKey: autonomyIssueInvestigationKey(
        issue.issueKey,
        issue.semanticRevision,
        owner.investigationAttempts,
      ),
      phase: owner.phase,
      ...(owner.retryAt === undefined ? {} : { notBeforeAt: owner.retryAt }),
    }];
  });
}
