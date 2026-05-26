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
 *                  no strong external signal, etc.). When
 *                  `inspect-queue.actionableCount === 0`, every strategic-
 *                  area blocked alternative whose precondition currently
 *                  evaluates as satisfied (`movable: true`) must appear in
 *                  `blockedAlternativesConsidered` with a `reasonNotChosen`,
 *                  so the explorer cannot silently ignore a task it could
 *                  have promoted.
 *   watchlist-only — only watchlist updates, no task changes
 *
 * `inspect-queue.strategicReadyCoverageGap` is an already-detected queue
 * health failure. When it is true, a queue-unchanged `noop` or
 * `watchlist-only` rationale is invalid even if the later coverage check
 * would also catch the final repo state.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyTaskShape } from "#modules/autonomy/report/task-classification.js";
import {
  evaluateBlockedPrecondition,
  parseBlockedPrecondition,
} from "#modules/repo-tasks/blocked-precondition.js";
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
  /**
   * The blocked-task precondition currently evaluates as satisfied — so the
   * autonomy loop could promote this task right now if the explorer chose
   * to. The explorer's noop gate uses this to distinguish "queue is
   * legitimately paused" (no movable alternatives) from "explorer punted on
   * a task it could have moved" (uncited movable alternative).
   */
  movable: boolean;
};

/**
 * Strategic-area blocked tasks the explorer must consider before opening
 * unrelated narrow work. Filter:
 *   - state: blocked
 *   - classifyTaskShape result: "strategic"
 *   - precondition section parses (otherwise the task is noise the validator
 *     already flags)
 *
 * Each summary's `movable` flag is the live result of
 * `evaluateBlockedPrecondition` against repo state, so the noop gate can
 * tell whether the explorer was right to leave this task blocked.
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
    const evaluation = evaluateBlockedPrecondition(parsed.precondition, {
      projectDir,
      taskBody: record.body,
    });
    summaries.push({
      id: record.id,
      title: record.title,
      priority: record.priority,
      area: record.area,
      preconditionKind: parsed.precondition.kind,
      ageDays: ageInDays(record.updatedAt, now),
      movable: evaluation.satisfied,
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
   * rationale must consider every entry by id. When the decision is
   * `noop` and `actionableCount === 0`, the rationale must additionally
   * cite every entry whose `movable` flag is true — leaving a movable
   * strategic alternative on the floor while declaring noop is the
   * fabricated-busywork shape this gate exists to catch.
   */
  strategicAlternatives: readonly StrategicBlockedSummary[];
  /**
   * `inspect-queue.actionableCount` (ready + doing) at the time the
   * rationale check runs. Combined with `decision === "noop"`, this
   * decides whether the noop+movable gate fires: when actionable work
   * already exists, noop is reasonable regardless of movable blocked
   * alternatives.
   */
  actionableCount: number;
  /**
   * `inspect-queue.strategicReadyCoverageGap` from the same assessment. A
   * true value means ready/ is p3-only and no strategic p0/p1/p2 actionable
   * work exists, so the explorer must change the task queue or fail before
   * the commit path.
   */
  strategicReadyCoverageGap: boolean;
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

  if ((decision === "noop" || decision === "watchlist-only") && taskIdsTouched.length > 0) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}: decision "${decision}" must leave taskIdsTouched empty. Use "promote", "decompose", or "create-task" when the run changes task state.`,
    );
  }

  if (options.strategicReadyCoverageGap && (decision === "noop" || decision === "watchlist-only")) {
    throw new Error(
      `${EXPLORATION_RATIONALE_FILENAME}: decision "${decision}" is invalid while inspect-queue.strategicReadyCoverageGap is true. Treat the gap as actionable queue work: promote, decompose, or create a p0/p1/p2 ready task, or fail before commit if no honest action exists.`,
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

  if (decision === "noop" && options.actionableCount === 0) {
    const consideredIds = new Set(consideredTyped.map((c) => c.id));
    const uncitedMovable = options.strategicAlternatives
      .filter((alt) => alt.movable)
      .map((alt) => alt.id)
      .filter((id) => !consideredIds.has(id));
    if (uncitedMovable.length > 0) {
      throw new Error(
        `${EXPLORATION_RATIONALE_FILENAME}: decision "noop" with actionableCount=0 cannot leave a movable strategic-area blocked alternative uncited. Movable alternatives currently are: ${uncitedMovable.join(", ")}. Either change the decision to "promote"/"decompose" and act on one, or rescope the blocked task and add it to blockedAlternativesConsidered with a reasonNotChosen explaining why noop is right despite the precondition being satisfied.`,
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

export type ExplorationRationaleQueueContext = {
  /**
   * `inspect-queue.actionableCount` from the explorer's earlier code step.
   * Forwarded into the rationale validator so the noop+movable gate can
   * distinguish "queue genuinely paused" from "explorer punted on a
   * movable strategic alternative".
   */
  actionableCount: number;
  /**
   * `inspect-queue.strategicReadyCoverageGap` from the explorer's earlier
   * code step. Forwarded so the rationale check can reject queue-unchanged
   * decisions before the later generic coverage check becomes the first
   * signal.
   */
  strategicReadyCoverageGap: boolean;
};

/**
 * Repair-loop check entry point. Reads the rationale file from the run
 * directory and validates it. Throws on missing file or invalid content so
 * the explorer's repair loop forces the agent to write a real rationale.
 *
 * The caller passes `queueContext.actionableCount` from the explorer
 * workflow's typed inspect-queue step so the validator can apply the
 * noop+movable gate without re-reading repo state from a second source, and
 * `strategicReadyCoverageGap` so the same inspect result blocks
 * queue-unchanged decisions before commit.
 */
export function checkExplorationRationale(
  projectDir: string,
  runDirPath: string,
  queueContext: ExplorationRationaleQueueContext,
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
    actionableCount: queueContext.actionableCount,
    strategicReadyCoverageGap: queueContext.strategicReadyCoverageGap,
  });
}
