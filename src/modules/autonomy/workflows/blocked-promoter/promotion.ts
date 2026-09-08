import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { splitFrontMatter } from "#core/util/frontmatter.js";
import {
  type BlockedPrecondition,
  evaluateBlockedPrecondition,
  type OperatorCaptureInstructedMarker,
  type OwnerAskMarker,
  parseBlockedPrecondition,
  readOwnerAskMarkers,
  renderOwnerResolvedMarker,
  upsertOperatorCaptureInstructedMarker,
  upsertOwnerAskMarker,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  getRepoTaskPath,
  getUnfinishedTaskDependencies,
  listFullRepoTasks,
  type MoveTaskResult,
  moveTaskById,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { type BlockerAction, decideBlockedAction, extractRecommendedAnswer } from "./blocker-policy.js";
import { assertOwnerDecisionCandidateIsCurrent } from "./owner-decision-authorization.js";

export type BlockedTaskRecord = {
  id: string;
  path: string;
  body: string;
  precondition: BlockedPrecondition;
  dependsOn: string[];
  /** Filesystem observation time used only for operator aging hints. */
  updatedAt: string;
};

function lastChangedAt(workspaceRoot: string, filePath: string): string {
  try {
    const committedAt = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", relative(workspaceRoot, filePath)],
      { cwd: workspaceRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (committedAt && !Number.isNaN(Date.parse(committedAt))) return committedAt;
  } catch {
    // Untracked files and non-Git fixtures fall back to their observed mtime.
  }
  return statSync(filePath).mtime.toISOString();
}

/**
 * Read every parseable blocked task. Tasks whose precondition fails to parse
 * are skipped here and surface as task-queue validation errors elsewhere — the
 * promoter does not silently retry malformed bodies.
 */
export function listBlockedTasksWithPreconditions(
  workspaceRoot: string,
): BlockedTaskRecord[] {
  const records: BlockedTaskRecord[] = [];
  for (const task of listFullRepoTasks(workspaceRoot, ["blocked"])) {
    const filePath = getRepoTaskPath(workspaceRoot, "blocked", task.id);
    const parsed = parseBlockedPrecondition(task.body);
    if (!parsed.ok) continue;
    records.push({
      id: task.id,
      path: filePath,
      body: task.body,
      precondition: parsed.precondition,
      dependsOn: task.dependsOn,
      updatedAt: lastChangedAt(workspaceRoot, filePath),
    });
  }
  return records;
}

export type PromotionAction = {
  taskId: string;
  fromState: "blocked";
  toState: "open";
  reason: string;
};

export type DeterministicPromotionResult = {
  promotions: MoveTaskResult[];
};

/**
 * Walk every blocked task, evaluate its precondition, and promote the ones
 * whose preconditions are now satisfied. Idempotent: a second call finds no
 * remaining blocked tasks to promote because each task's persisted status is
 * changed to `open` inside this call.
 */
export function promoteSatisfiedBlockedTasks(
  workspaceRoot: string,
  scopeRoot: string = workspaceRoot,
): DeterministicPromotionResult {
  const actions = classifyBlockedActions(
    listBlockedTasksWithPreconditions(workspaceRoot), workspaceRoot, Date.now(), scopeRoot,
  );
  return {
    promotions: actions.flatMap((action) =>
      action.kind === "auto-promotable"
        ? [moveTaskById(workspaceRoot, action.taskId, "open")]
        : []
    ),
  };
}

export type OwnerAskCandidate = {
  taskId: string;
  taskPath: string;
  slot: string;
  question: string;
  context: string | null;
  proposedAnswers: string[];
  /**
   * Recommended answer slug pulled from the precondition `context` (a `
   * Recommended: <slug>` line). When present, the workflow surfaces it
   * first in the proposed-answers list and names it explicitly in the
   * re-ask reason so the operator can pick the default at a glance.
   */
  recommendedAnswer: string | null;
  /** Stable cadence revision used to deduplicate request and result delivery. */
  requestRevision: string;
};

/** Select from the authoritative actions used for the operator projection. */
export function pickOwnerAskCandidate(
  records: BlockedTaskRecord[],
  actions: readonly BlockerAction[],
): OwnerAskCandidate | null {
  const due = actions.find((action) => action.kind === "owner-ask-due");
  if (!due) return null;
  const record = records.find((record) => record.id === due.taskId)!;
  const precondition = record.precondition;
  if (precondition.kind !== "owner-decision") {
    throw new Error("Owner ask action does not match its task precondition");
  }
  const marker = readOwnerAskMarkers(record.body).find((m) => m.slot === precondition.slot);
  return {
    taskId: record.id,
    taskPath: record.path,
    slot: precondition.slot,
    question: precondition.question,
    context: precondition.context,
    proposedAnswers: precondition.proposedAnswers,
    recommendedAnswer: extractRecommendedAnswer(precondition.context),
    requestRevision: marker?.lastAskedAt ?? "initial",
  };
}

export type AskOutcomeApplication =
  | {
      kind: "resolved";
      slot: string;
      taskPath: string;
      resolvedAt: string;
    }
  | {
      kind: "asked";
      slot: string;
      taskPath: string;
      lastAskedAt: string;
    };

/**
 * Write either a resolved marker (operator approved) or refresh the asked
 * marker (everything else). The asked marker is always refreshed so the
 * next cycle does not re-ask within the cadence window.
 */
export function applyAskOutcome(args: {
  workspaceRoot: string;
  candidate: OwnerAskCandidate;
  approved: boolean;
  now: Date;
}): AskOutcomeApplication[] {
  const { workspaceRoot, candidate, approved, now } = args;
  const stamp = now.toISOString();
  const filePath = candidate.taskPath;
  if (!existsSync(filePath)) {
    throw new Error(`blocked-promoter: task file disappeared: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  assertOwnerDecisionCandidateIsCurrent(raw, candidate);
  const split = splitFrontMatter(raw);
  if (!split) {
    throw new Error(`blocked-promoter: task file has no frontmatter: ${filePath}`);
  }
  const askMarker: OwnerAskMarker = {
    slot: candidate.slot,
    lastAskedAt: stamp,
  };
  let body = upsertOwnerAskMarker(split.body, askMarker);
  const applications: AskOutcomeApplication[] = [
    {
      kind: "asked",
      slot: candidate.slot,
      taskPath: filePath,
      lastAskedAt: stamp,
    },
  ];
  if (approved) {
    body = `${body.replace(/\n+$/, "")}\n\n${renderOwnerResolvedMarker({
      slot: candidate.slot,
      resolvedAt: stamp,
    })}\n`;
    applications.push({
      kind: "resolved",
      slot: candidate.slot,
      taskPath: filePath,
      resolvedAt: stamp,
    });
  }
  const rebuilt = `---\n${split.frontmatter}\n---\n${body}`;
  writeRepoTaskFile(workspaceRoot, filePath, rebuilt);
  return applications;
}

export type OperatorCaptureInstructCandidate = {
  taskId: string;
  taskPath: string;
  /** Repo-relative path operator must produce. */
  capturePath: string;
  /** One-line description from the precondition. */
  description: string;
  /** Why the workflow is emitting or refreshing the instruction. */
  reason: string;
  ageDays: number;
};

/**
 * Return every operator-capture blocker that is "due" for an instruction
 * refresh: either an operator has supplied a partial capture path, or the
 * missing capture has aged past OPERATOR_CAPTURE_AGE_DAYS. A fresh instructed
 * marker still suppresses repeated emissions within the cadence window.
 */
export function listOperatorCaptureInstructCandidates(
  records: BlockedTaskRecord[],
  workspaceRoot: string,
  nowMs: number,
  scopeRoot: string = workspaceRoot,
): OperatorCaptureInstructCandidate[] {
  return classifyBlockedActions(records, workspaceRoot, nowMs, scopeRoot)
    .flatMap((action): OperatorCaptureInstructCandidate[] =>
      action.kind === "operator-capture-due" ? [{
        taskId: action.taskId,
        taskPath: records.find((record) => record.id === action.taskId)!.path,
        capturePath: action.capturePath,
        description: action.description,
        reason: action.reason,
        ageDays: action.ageDays ?? 0,
      }] : []
    );
}

export type OperatorCaptureInstruction = {
  taskId: string;
  taskPath: string;
  capturePath: string;
  description: string;
  reason: string;
  ageDays: number;
  instructedAt: string;
};

/**
 * Refresh the operator-capture instructed marker on the task body. Returns
 * the typed instruction record so the workflow can write it into the run
 * artifact.
 */
export function applyOperatorCaptureInstruction(args: {
  workspaceRoot: string;
  candidate: OperatorCaptureInstructCandidate;
  now: Date;
}): OperatorCaptureInstruction {
  const { workspaceRoot, candidate, now } = args;
  const stamp = now.toISOString();
  const filePath = candidate.taskPath;
  if (!existsSync(filePath)) {
    throw new Error(`blocked-promoter: task file disappeared: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  const split = splitFrontMatter(raw);
  if (!split) {
    throw new Error(`blocked-promoter: task file has no frontmatter: ${filePath}`);
  }
  const marker: OperatorCaptureInstructedMarker = { lastInstructedAt: stamp };
  const body = upsertOperatorCaptureInstructedMarker(split.body, marker);
  const rebuilt = `---\n${split.frontmatter}\n---\n${body}`;
  writeRepoTaskFile(workspaceRoot, filePath, rebuilt);
  return {
    taskId: candidate.taskId,
    taskPath: filePath,
    capturePath: candidate.capturePath,
    description: candidate.description,
    reason: candidate.reason,
    ageDays: candidate.ageDays,
    instructedAt: stamp,
  };
}

/** Observe external preconditions once, then delegate every action to the policy owner. */
export function classifyBlockedActions(
  records: BlockedTaskRecord[],
  workspaceRoot: string,
  nowMs: number,
  scopeRoot: string = workspaceRoot,
): BlockerAction[] {
  return records.map((record) => decideBlockedAction({
    record,
    nowMs,
    waitingOn: getUnfinishedTaskDependencies(workspaceRoot, record.dependsOn),
    evaluation: evaluateBlockedPrecondition(record.precondition, {
      workspaceRoot, scopeRoot, taskBody: record.body,
    }),
  }));
}
