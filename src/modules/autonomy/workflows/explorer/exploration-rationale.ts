/**
 * Exploration rationale: the explicit, operator-inspectable record of what
 * the explorer agent decided to do this run. Lives at
 * `<run-directory>/exploration-rationale.json` and is enforced by a repair-
 * loop check. Raises the bar on new fan-out work by requiring an explicit
 * comparison against existing strategic-area blocked alternatives whenever
 * the explorer creates a new task.
 *
 * Decisions:
 *   promote      — promote/decompose an existing blocked task by id
 *   decompose    — split a blocked task into smaller subtasks
 *   create-task  — open a new task; must list `blockedAlternativesConsidered`
 *                  and a per-alternative `reasonNotChosen`
 *   noop         — explicit no-op with a stated reason (queue is healthy,
 *                  no strong external signal, etc.)
 *   watchlist-only — only watchlist updates, no task changes
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyTaskShape } from "#modules/autonomy/report/task-classification.js";
import { parseBlockedPrecondition } from "#modules/repo-tasks/blocked-precondition.js";
import {
  getRepoTaskStateDir,
  listFullRepoTasks,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type ExplorationDecisionKind =
  | "promote"
  | "decompose"
  | "create-task"
  | "noop"
  | "watchlist-only";

export type BlockedAlternativeConsidered = {
  id: string;
  reasonNotChosen: string;
};

export type ExplorationRationale = {
  decision: ExplorationDecisionKind;
  /** Free-form one-paragraph summary of what changed and why. */
  summary: string;
  /**
   * Strategic-area blocked tasks (architecture/core/modules/autonomy that are
   * not surface-parity work) the explorer considered before opening new work.
   * Required when `decision === "create-task"`. Empty array is allowed when
   * the repo has no strategic-area blocked tasks.
   */
  blockedAlternativesConsidered: BlockedAlternativeConsidered[];
  /**
   * Task ids touched by this run. For `promote` / `decompose`, the ids of the
   * blocked or backlog tasks moved or split. For `create-task`, the new task
   * ids written under `data/tasks/`. For `noop` / `watchlist-only`, empty.
   */
  taskIdsTouched: string[];
};

export const EXPLORATION_RATIONALE_FILENAME = "exploration-rationale.json";

const VALID_DECISIONS: ReadonlySet<ExplorationDecisionKind> = new Set([
  "promote",
  "decompose",
  "create-task",
  "noop",
  "watchlist-only",
]);

function listBlockedTaskIds(projectDir: string): Set<string> {
  const dir = getRepoTaskStateDir(projectDir, "blocked");
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
      .map((name) => name.slice(0, -3)),
  );
}

export type StrategicBlockedSummary = {
  id: string;
  title: string;
  priority: string;
  area: string;
  preconditionKind: string;
  ageDays: number;
};

/**
 * Strategic-area blocked tasks the explorer must consider before opening
 * unrelated narrow work. Filter:
 *   - state: blocked
 *   - classifyTaskShape result: "strategic"
 *   - precondition section parses (otherwise the task is noise the validator
 *     already flags)
 */
export function listStrategicBlockedAlternatives(
  projectDir: string,
  now: number = Date.now(),
): StrategicBlockedSummary[] {
  const records = listFullRepoTasks(projectDir, ["blocked"]);
  const summaries: StrategicBlockedSummary[] = [];
  for (const record of records) {
    const shape = classifyTaskShape({
      area: record.area,
      title: record.title,
      summary: record.summary,
    });
    if (shape !== "strategic") continue;
    const parsed = parseBlockedPrecondition(`---\n---\n${record.body}`);
    if (!parsed.ok) continue;
    summaries.push({
      id: record.id,
      title: record.title,
      priority: record.priority,
      area: record.area,
      preconditionKind: parsed.precondition.kind,
      ageDays: ageInDays(record.updatedAt, now),
    });
  }
  return summaries.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

function ageInDays(updatedAt: string, now: number): number {
  const ms = Date.parse(updatedAt);
  if (Number.isNaN(ms)) return -1;
  return Math.max(0, Math.floor((now - ms) / (24 * 60 * 60 * 1000)));
}

function priorityRank(priority: string): number {
  const order: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
  return order[priority] ?? 99;
}

export type RationaleCheckOptions = {
  /**
   * Available alternative ids on disk; supplied by the workflow at check
   * time. The check rejects rationales that cite blocked alternative ids
   * which do not exist in the repo (typo or fabrication).
   */
  blockedTaskIds: ReadonlySet<string>;
  /**
   * Strategic-area blocked alternatives that exist in the repo. When this
   * list is non-empty and the rationale's decision is `create-task`, the
   * rationale must consider every entry by id.
   */
  strategicAlternatives: readonly StrategicBlockedSummary[];
};

/**
 * Validate an `exploration-rationale.json` payload. Throws with a single
 * actionable error message on failure so the repair-loop check can surface
 * it as a critical issue. Returns the parsed rationale on success.
 */
export function validateExplorationRationale(
  raw: unknown,
  options: RationaleCheckOptions,
): ExplorationRationale {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME} must be a JSON object with at least { decision, summary, blockedAlternativesConsidered, taskIdsTouched }`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const decision = obj.decision;
  if (typeof decision !== "string" || !VALID_DECISIONS.has(decision as ExplorationDecisionKind)) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}.decision must be one of: promote, decompose, create-task, noop, watchlist-only (got ${JSON.stringify(decision)})`,
    );
  }
  const summary = obj.summary;
  if (typeof summary !== "string" || summary.trim().length < 16) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}.summary must be a substantive sentence describing the decision (>=16 chars)`,
    );
  }
  const considered = obj.blockedAlternativesConsidered;
  if (!Array.isArray(considered)) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}.blockedAlternativesConsidered must be an array (use [] when no strategic blocked tasks exist)`,
    );
  }
  const consideredTyped: BlockedAlternativeConsidered[] = [];
  for (const entry of considered) {
    if (!entry || typeof entry !== "object") {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}.blockedAlternativesConsidered entries must be { id, reasonNotChosen } objects`,
      );
    }
    const e = entry as Record<string, unknown>;
    const id = e.id;
    const reasonNotChosen = e.reasonNotChosen;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}: every blockedAlternativesConsidered entry needs a string id`,
      );
    }
    if (typeof reasonNotChosen !== "string" || reasonNotChosen.trim().length < 8) {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}: blockedAlternativesConsidered[${id}].reasonNotChosen must explain why the blocked task was not promoted/decomposed (>=8 chars)`,
      );
    }
    if (!options.blockedTaskIds.has(id)) {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}: blockedAlternativesConsidered cites "${id}" which is not present in data/tasks/blocked/. Cite real blocked task ids only.`,
      );
    }
    consideredTyped.push({ id, reasonNotChosen });
  }
  const taskIdsTouched = obj.taskIdsTouched;
  if (!Array.isArray(taskIdsTouched) || !taskIdsTouched.every((v) => typeof v === "string")) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}.taskIdsTouched must be an array of task id strings (use [] for noop/watchlist-only)`,
    );
  }

  if (decision === "create-task") {
    if (taskIdsTouched.length === 0) {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}: decision "create-task" requires taskIdsTouched to name the new task ids`,
      );
    }
    const consideredIds = new Set(consideredTyped.map((c) => c.id));
    const missing = options.strategicAlternatives
      .map((alt) => alt.id)
      .filter((id) => !consideredIds.has(id));
    if (missing.length > 0) {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}: decision "create-task" must consider every strategic-area blocked task before opening new work. Missing rationale for: ${missing.join(", ")}. Either include a per-task reasonNotChosen, or change the decision to "promote"/"decompose" and act on one of them.`,
      );
    }
  }

  if ((decision === "promote" || decision === "decompose") && taskIdsTouched.length === 0) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}: decision "${decision}" requires taskIdsTouched to name the affected task ids`,
    );
  }

  return {
    decision: decision as ExplorationDecisionKind,
    summary,
    blockedAlternativesConsidered: consideredTyped,
    taskIdsTouched: taskIdsTouched as string[],
  };
}

/**
 * Repair-loop check entry point. Reads the rationale file from the run
 * directory and validates it. Throws on missing file or invalid content so
 * the explorer's repair loop forces the agent to write a real rationale.
 */
export function checkExplorationRationale(
  projectDir: string,
  runDirPath: string,
): ExplorationRationale {
  const rationalePath = join(runDirPath, EXPLORATION_RATIONALE_FILENAME);
  if (!existsSync(rationalePath)) {
    throw new Error(
      `Missing ${EXPLORATION_RATIONALE_FILENAME} in the run directory. Every committing explorer run must write this file documenting the chosen decision (promote, decompose, create-task, noop, or watchlist-only) and, when creating new tasks, comparing against existing strategic-area blocked alternatives.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(rationalePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME} is not valid JSON: ${message}`,
    );
  }
  return validateExplorationRationale(parsed, {
    blockedTaskIds: listBlockedTaskIds(projectDir),
    strategicAlternatives: listStrategicBlockedAlternatives(projectDir),
  });
}

