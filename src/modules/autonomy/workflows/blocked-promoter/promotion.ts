import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, splitFrontMatter } from "#core/util/frontmatter.js";
import {
  type BlockedPrecondition,
  type BlockedPreconditionKind,
  evaluateBlockedPrecondition,
  type OperatorCaptureInstructedMarker,
  type OwnerAskMarker,
  parseBlockedPrecondition,
  promotionTargetState,
  readOperatorCaptureInstructedMarker,
  readOwnerAskMarkers,
  renderOwnerResolvedMarker,
  upsertOperatorCaptureInstructedMarker,
  upsertOwnerAskMarker,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  getRepoTaskStateDir,
  getUnfinishedTaskDependencies,
  type MoveTaskResult,
  moveTaskById,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { readTaskDependencyIds } from "#modules/repo-tasks/task-dependencies.js";

export type BlockedTaskRecord = {
  id: string;
  path: string;
  priority: string;
  body: string;
  precondition: BlockedPrecondition;
  dependsOn: string[];
  /** ISO-8601 timestamp from the task frontmatter `updated_at` field. */
  updatedAt: string;
};

/**
 * Read every parseable blocked task. Tasks whose precondition fails to parse
 * are skipped here and surface as task-queue validation errors elsewhere — the
 * promoter does not silently retry malformed bodies.
 */
export function listBlockedTasksWithPreconditions(
  projectDir: string,
): BlockedTaskRecord[] {
  const dir = getRepoTaskStateDir(projectDir, "blocked");
  const records: BlockedTaskRecord[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return records;
  }
  for (const fileName of entries) {
    if (!fileName.endsWith(".md") || fileName === "AGENTS.md") continue;
    const filePath = join(dir, fileName);
    const raw = readFileSync(filePath, "utf-8");
    const split = splitFrontMatter(raw);
    if (!split) continue;
    const { attrs } = parseFlatFrontMatter(raw);
    const id = String(attrs.id ?? "");
    const priority = String(attrs.priority ?? "");
    const updatedAt = String(attrs.updated_at ?? "");
    if (!id) continue;
    const parsed = parseBlockedPrecondition(raw);
    if (!parsed.ok) continue;
    records.push({
      id,
      path: filePath,
      priority,
      body: split.body,
      precondition: parsed.precondition,
      dependsOn: readTaskDependencyIds(attrs),
      updatedAt,
    });
  }
  return records;
}

export type PromotionAction = {
  taskId: string;
  fromState: "blocked";
  toState: "ready" | "backlog";
  reason: string;
};

export type DeterministicPromotionResult = {
  promotions: MoveTaskResult[];
};

/**
 * Walk every blocked task, evaluate its precondition, and promote the ones
 * whose preconditions are now satisfied. Idempotent: a second call finds no
 * remaining blocked tasks to promote because each is moved out of `blocked/`
 * inside this call.
 */
export function promoteSatisfiedBlockedTasks(
  projectDir: string,
): DeterministicPromotionResult {
  const records = listBlockedTasksWithPreconditions(projectDir);
  const promotions: MoveTaskResult[] = [];
  for (const record of records) {
    const waitingOn = getUnfinishedTaskDependencies(projectDir, record.dependsOn);
    if (waitingOn.length > 0) continue;
    const evaluation = evaluateBlockedPrecondition(record.precondition, {
      projectDir,
      taskBody: record.body,
    });
    if (!evaluation.satisfied) continue;
    const target = promotionTargetState(record.priority);
    promotions.push(moveTaskById(projectDir, record.id, target));
  }
  return { promotions };
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
};

const OWNER_ASK_MIN_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pick the oldest owner-decision precondition that is "due" for re-asking:
 * either no asked marker exists for the slot, or the existing marker is
 * older than the minimum cadence (14 days).
 */
export function pickOwnerAskCandidate(
  records: BlockedTaskRecord[],
  nowMs: number,
): OwnerAskCandidate | null {
  const dueCandidates: OwnerAskCandidate[] = [];
  for (const record of records) {
    const precondition = record.precondition;
    if (precondition.kind !== "owner-decision") continue;
    const markers = readOwnerAskMarkers(record.body);
    const existing = markers.find((m) => m.slot === precondition.slot);
    if (existing) {
      const askedMs = Date.parse(existing.lastAskedAt);
      if (
        !Number.isNaN(askedMs) &&
        nowMs - askedMs < OWNER_ASK_MIN_INTERVAL_MS
      ) {
        continue;
      }
    }
    dueCandidates.push({
      taskId: record.id,
      taskPath: record.path,
      slot: precondition.slot,
      question: precondition.question,
      context: precondition.context,
      proposedAnswers: precondition.proposedAnswers,
      recommendedAnswer: extractRecommendedAnswer(precondition.context),
    });
  }
  return dueCandidates.length > 0 ? dueCandidates[0] : null;
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

const APPROVAL_ANSWERS = new Set(["unblock", "promote", "approve", "yes"]);

const RECOMMENDED_LINE_RE = /(?:^|[\s.])recommended:\s*([a-z0-9][a-z0-9-_]*)/i;

/**
 * Pull a recommended-answer hint out of an owner-decision precondition's
 * free-form `context` field. Many tasks already write a `Recommended:
 * <variant-id>` sentence so a future re-ask carries the original author's
 * default. The parse is intentionally narrow: only a single ASCII slug
 * following the literal `Recommended:` is recognized; anything else returns
 * `null` so the workflow falls back to surfacing only proposed answers.
 */
export function extractRecommendedAnswer(
  context: string | null | undefined,
): string | null {
  if (!context) return null;
  const match = context.match(RECOMMENDED_LINE_RE);
  if (!match) return null;
  return match[1];
}

/**
 * Detect whether the operator's free-form answer should count as the
 * unblock signal for the slot. Conservative: only the answers explicitly
 * named on the precondition's `proposed_answers` list (intersected with the
 * approval keyword set) are treated as approvals; everything else only
 * refreshes the asked marker so we do not auto-promote on an ambiguous
 * answer.
 */
export function answerApprovesPromotion(
  answer: string,
  proposedAnswers: string[],
): boolean {
  const normalized = answer.trim().toLowerCase();
  if (APPROVAL_ANSWERS.has(normalized)) return true;
  return proposedAnswers
    .map((a) => a.trim().toLowerCase())
    .some((proposed) => proposed === normalized && APPROVAL_ANSWERS.has(proposed));
}

/**
 * Write either a resolved marker (operator approved) or refresh the asked
 * marker (everything else). The asked marker is always refreshed so the
 * next cycle does not re-ask within the cadence window.
 */
export function applyAskOutcome(args: {
  candidate: OwnerAskCandidate;
  approved: boolean;
  now: Date;
}): AskOutcomeApplication[] {
  const { candidate, approved, now } = args;
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
  writeFileSync(filePath, rebuilt);
  return applications;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Operator-capture preconditions are surfaced once they have been blocked at
 * least this long. Matches `attention-digest`'s 14-day operator-gated
 * escalation window so the workflow only acts when the digest would
 * otherwise repeat a stale alert.
 */
export const OPERATOR_CAPTURE_AGE_DAYS = 14;
/**
 * Cadence between repeated operator-capture instruction emissions for the
 * same task. Matches the owner-ask cadence so both surfaces stay in lock
 * step.
 */
export const OPERATOR_CAPTURE_INSTRUCT_INTERVAL_MS =
  14 * 24 * 60 * 60 * 1000;

export type OperatorCaptureInstructCandidate = {
  taskId: string;
  taskPath: string;
  /** Repo-relative path operator must produce. */
  capturePath: string;
  /** One-line description from the precondition. */
  description: string;
  ageDays: number;
};

function ageDays(updatedAt: string, nowMs: number): number | null {
  const ms = Date.parse(updatedAt);
  if (Number.isNaN(ms)) return null;
  return Math.floor((nowMs - ms) / MS_PER_DAY);
}

/**
 * Return every aged operator-capture blocker that is "due" for an
 * instruction refresh: blocked >= OPERATOR_CAPTURE_AGE_DAYS and either has
 * no instructed marker or one older than the cadence window.
 */
export function listOperatorCaptureInstructCandidates(
  records: BlockedTaskRecord[],
  nowMs: number,
): OperatorCaptureInstructCandidate[] {
  const candidates: OperatorCaptureInstructCandidate[] = [];
  for (const record of records) {
    if (record.precondition.kind !== "operator-capture") continue;
    const age = ageDays(record.updatedAt, nowMs);
    if (age === null || age < OPERATOR_CAPTURE_AGE_DAYS) continue;
    const marker = readOperatorCaptureInstructedMarker(record.body);
    if (marker) {
      const lastMs = Date.parse(marker.lastInstructedAt);
      if (
        !Number.isNaN(lastMs) &&
        nowMs - lastMs < OPERATOR_CAPTURE_INSTRUCT_INTERVAL_MS
      ) {
        continue;
      }
    }
    candidates.push({
      taskId: record.id,
      taskPath: record.path,
      capturePath: record.precondition.path,
      description: record.precondition.description,
      ageDays: age,
    });
  }
  return candidates;
}

export type OperatorCaptureInstruction = {
  taskId: string;
  taskPath: string;
  capturePath: string;
  description: string;
  ageDays: number;
  instructedAt: string;
};

/**
 * Refresh the operator-capture instructed marker on the task body. Returns
 * the typed instruction record so the workflow can write it into the run
 * artifact.
 */
export function applyOperatorCaptureInstruction(args: {
  candidate: OperatorCaptureInstructCandidate;
  now: Date;
}): OperatorCaptureInstruction {
  const { candidate, now } = args;
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
  writeFileSync(filePath, rebuilt);
  return {
    taskId: candidate.taskId,
    taskPath: filePath,
    capturePath: candidate.capturePath,
    description: candidate.description,
    ageDays: candidate.ageDays,
    instructedAt: stamp,
  };
}

/**
 * Per-task next-action a blocked task receives this cycle. The
 * `auto-promotable` and `still-awaiting` shapes carry no side-effect
 * follow-up; the workflow steps still drive promotion and ask/instruct
 * separately so this classifier stays a pure read against the inspected
 * records.
 */
export type BlockerAction =
  | {
      kind: "auto-promotable";
      taskId: string;
      preconditionKind: "task-done" | "owner-decision";
      reason: string;
      ageDays: number | null;
    }
  | {
      kind: "still-awaiting-dependency";
      taskId: string;
      preconditionKind: BlockedPreconditionKind;
      waitingOn: string[];
      ageDays: number | null;
    }
  | {
      kind: "still-awaiting-task";
      taskId: string;
      preconditionKind: "task-done";
      enablerRef: string;
      ageDays: number | null;
    }
  | {
      kind: "still-awaiting-capability";
      taskId: string;
      preconditionKind: "capability-installed";
      probe: string;
      ageDays: number | null;
    }
  | {
      kind: "owner-ask-due";
      taskId: string;
      preconditionKind: "owner-decision";
      slot: string;
      recommendedAnswer: string | null;
      proposedAnswers: string[];
      ageDays: number | null;
    }
  | {
      kind: "owner-ask-recent";
      taskId: string;
      preconditionKind: "owner-decision";
      slot: string;
      lastAskedAt: string;
      ageDays: number | null;
    }
  | {
      kind: "operator-capture-due";
      taskId: string;
      preconditionKind: "operator-capture";
      capturePath: string;
      description: string;
      ageDays: number | null;
    }
  | {
      kind: "operator-capture-recent";
      taskId: string;
      preconditionKind: "operator-capture";
      capturePath: string;
      lastInstructedAt: string;
      ageDays: number | null;
    }
  | {
      kind: "operator-capture-fresh";
      taskId: string;
      preconditionKind: "operator-capture";
      capturePath: string;
      ageDays: number | null;
    };

/**
 * Walk every blocked task and pick the single best-fit action label for
 * each. The classifier is pure: it inspects records, the project's `done/`
 * directory (for task-done), and existing markers — it does not mutate any
 * task body. Workflow steps consume this list to write a per-cycle
 * `blocker-actions.json` artifact and emit summary noise to operators.
 */
export function classifyBlockedActions(
  records: BlockedTaskRecord[],
  projectDir: string,
  nowMs: number,
): BlockerAction[] {
  const actions: BlockerAction[] = [];
  for (const record of records) {
    const age = ageDays(record.updatedAt, nowMs);
    const waitingOn = getUnfinishedTaskDependencies(projectDir, record.dependsOn);
    if (
      waitingOn.length > 0 &&
      !(record.precondition.kind === "task-done" && waitingOn.length === 1 && waitingOn[0] === record.precondition.ref)
    ) {
      actions.push({
        kind: "still-awaiting-dependency",
        taskId: record.id,
        preconditionKind: record.precondition.kind,
        waitingOn,
        ageDays: age,
      });
      continue;
    }
    const eval_ = evaluateBlockedPrecondition(record.precondition, {
      projectDir,
      taskBody: record.body,
    });
    switch (record.precondition.kind) {
      case "task-done": {
        if (eval_.satisfied) {
          actions.push({
            kind: "auto-promotable",
            taskId: record.id,
            preconditionKind: "task-done",
            reason: eval_.reason,
            ageDays: age,
          });
        } else {
          actions.push({
            kind: "still-awaiting-task",
            taskId: record.id,
            preconditionKind: "task-done",
            enablerRef: record.precondition.ref,
            ageDays: age,
          });
        }
        break;
      }
      case "capability-installed": {
        actions.push({
          kind: "still-awaiting-capability",
          taskId: record.id,
          preconditionKind: "capability-installed",
          probe: record.precondition.probe,
          ageDays: age,
        });
        break;
      }
      case "owner-decision": {
        const od = record.precondition;
        if (eval_.satisfied) {
          actions.push({
            kind: "auto-promotable",
            taskId: record.id,
            preconditionKind: "owner-decision",
            reason: eval_.reason,
            ageDays: age,
          });
          break;
        }
        const askMarkers = readOwnerAskMarkers(record.body);
        const existing = askMarkers.find((m) => m.slot === od.slot);
        if (existing) {
          const askedMs = Date.parse(existing.lastAskedAt);
          if (
            !Number.isNaN(askedMs) &&
            nowMs - askedMs < OPERATOR_CAPTURE_INSTRUCT_INTERVAL_MS
          ) {
            actions.push({
              kind: "owner-ask-recent",
              taskId: record.id,
              preconditionKind: "owner-decision",
              slot: od.slot,
              lastAskedAt: existing.lastAskedAt,
              ageDays: age,
            });
            break;
          }
        }
        actions.push({
          kind: "owner-ask-due",
          taskId: record.id,
          preconditionKind: "owner-decision",
          slot: od.slot,
          recommendedAnswer: extractRecommendedAnswer(od.context),
          proposedAnswers: od.proposedAnswers,
          ageDays: age,
        });
        break;
      }
      case "operator-capture": {
        const oc = record.precondition;
        if (age === null || age < OPERATOR_CAPTURE_AGE_DAYS) {
          actions.push({
            kind: "operator-capture-fresh",
            taskId: record.id,
            preconditionKind: "operator-capture",
            capturePath: oc.path,
            ageDays: age,
          });
          break;
        }
        const marker = readOperatorCaptureInstructedMarker(record.body);
        if (marker) {
          const lastMs = Date.parse(marker.lastInstructedAt);
          if (
            !Number.isNaN(lastMs) &&
            nowMs - lastMs < OPERATOR_CAPTURE_INSTRUCT_INTERVAL_MS
          ) {
            actions.push({
              kind: "operator-capture-recent",
              taskId: record.id,
              preconditionKind: "operator-capture",
              capturePath: oc.path,
              lastInstructedAt: marker.lastInstructedAt,
              ageDays: age,
            });
            break;
          }
        }
        actions.push({
          kind: "operator-capture-due",
          taskId: record.id,
          preconditionKind: "operator-capture",
          capturePath: oc.path,
          description: oc.description,
          ageDays: age,
        });
        break;
      }
    }
  }
  return actions;
}
