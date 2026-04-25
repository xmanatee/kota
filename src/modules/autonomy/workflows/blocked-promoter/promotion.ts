import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, splitFrontMatter } from "#core/util/frontmatter.js";
import {
  type BlockedPrecondition,
  evaluateBlockedPrecondition,
  type OwnerAskMarker,
  parseBlockedPrecondition,
  promotionTargetState,
  readOwnerAskMarkers,
  renderOwnerResolvedMarker,
  upsertOwnerAskMarker,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  getRepoTaskStateDir,
  type MoveTaskResult,
  moveTaskById,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type BlockedTaskRecord = {
  id: string;
  path: string;
  priority: string;
  body: string;
  precondition: BlockedPrecondition;
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
    if (!id) continue;
    const parsed = parseBlockedPrecondition(raw);
    if (!parsed.ok) continue;
    records.push({
      id,
      path: filePath,
      priority,
      body: split.body,
      precondition: parsed.precondition,
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
