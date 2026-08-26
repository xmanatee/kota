/**
 * On-demand digest seam — produces the same rendered body the cadence run
 * would emit for the rolling window ending at `windowEndMs`, without advancing
 * cadence state or emitting `workflow.daily.digest`.
 *
 * Operator-facing entry point only. Per the autonomy no-cost-bias contract,
 * this output must not be exposed to autonomy agents in any prompt path.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { countRepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  aggregateDailyDigest,
  type DailyDigestData,
  type DigestState,
  type QueueCounts,
} from "./aggregate.js";
import { renderDailyDigest } from "./render.js";

export const DAILY_DIGEST_STATE_KEY = "daily-digest/window";

export type DigestSnapshot = {
  data: DailyDigestData;
  text: string;
  currentCounts: QueueCounts;
  windowEndMs: number;
};

export function readQueueCounts(projectDir: string): QueueCounts {
  return {
    backlog: countRepoTaskState(projectDir, "backlog"),
    ready: countRepoTaskState(projectDir, "ready"),
    doing: countRepoTaskState(projectDir, "doing"),
    blocked: countRepoTaskState(projectDir, "blocked"),
  };
}

/**
 * Produce a digest snapshot — aggregated data, rendered text, and the queue
 * counts captured for it — without persisting anything to disk or emitting
 * any bus event. The cadence workflow and the on-demand telegram path both
 * call this so the two outputs cannot drift.
 */
export function computeDigestSnapshot(opts: {
  projectDir: string;
  stateDir: string;
  windowEndMs?: number;
  previousQueueCounts?: QueueCounts | null;
}): DigestSnapshot {
  const windowEndMs = opts.windowEndMs ?? Date.now();
  const runsDir = join(opts.stateDir, "runs");
  const currentCounts = readQueueCounts(opts.projectDir);
  const ownerQuestions = new OwnerQuestionQueue(
    join(opts.stateDir, "owner-questions"),
  );
  const data = aggregateDailyDigest({
    runsDir,
    projectDir: opts.projectDir,
    ownerQuestions,
    windowEndMs,
    previousQueueCounts: opts.previousQueueCounts ?? null,
    currentQueueCounts: currentCounts,
  });
  return { data, text: renderDailyDigest(data), currentCounts, windowEndMs };
}

function readPreviousQueueCounts(
  projectDir: string,
  stateDir: string,
): QueueCounts | null {
  if (!existsSync(join(stateDir, "kota.sqlite"))) return null;
  const store = new RunStateDatabase(stateDir);
  try {
    const snapshot = store.readProjectStateValue<DigestState>(
      store.getProjectIdByRootPath(projectDir) ?? deriveDirectoryScopeId(projectDir),
      DAILY_DIGEST_STATE_KEY,
    );
    return snapshot.value?.counts ?? null;
  } finally {
    store.close();
  }
}

/**
 * Operator-initiated digest body. Reuses the cadence aggregator and renderer
 * but does not mutate runtime-owned cadence state and does not emit
 * `workflow.daily.digest`, so other notification channels do not see the
 * on-demand call as a duplicate cadence digest.
 */
export function renderOnDemandDigest(opts: {
  projectDir: string;
  stateDir: string;
  windowEndMs?: number;
}): { data: DailyDigestData; text: string } {
  const snapshot = computeDigestSnapshot({
    ...opts,
    previousQueueCounts: readPreviousQueueCounts(opts.projectDir, opts.stateDir),
  });
  return { data: snapshot.data, text: snapshot.text };
}
