/**
 * On-demand digest seam — produces the same rendered body the cadence run
 * would emit for the rolling window ending at `windowEndMs`, without writing
 * the cadence snapshot file or emitting `workflow.daily.digest`.
 *
 * Operator-facing entry point only. Per the autonomy no-cost-bias contract,
 * this output must not be exposed to autonomy agents in any prompt path.
 */

import { join } from "node:path";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { countRepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  aggregateDailyDigest,
  type DailyDigestData,
  type QueueCounts,
  readDigestState,
} from "./aggregate.js";
import { renderDailyDigest } from "./render.js";

export const DAILY_DIGEST_STATE_FILENAME = "daily-digest-state.json";

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
  windowEndMs?: number;
}): DigestSnapshot {
  const windowEndMs = opts.windowEndMs ?? Date.now();
  const runsDir = join(opts.projectDir, ".kota", "runs");
  const statePath = join(opts.projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
  const previousState = readDigestState(statePath);
  const currentCounts = readQueueCounts(opts.projectDir);
  const data = aggregateDailyDigest({
    runsDir,
    projectDir: opts.projectDir,
    ownerQuestions: getOwnerQuestionQueue(),
    windowEndMs,
    previousQueueCounts: previousState?.counts ?? null,
    currentQueueCounts: currentCounts,
  });
  return { data, text: renderDailyDigest(data), currentCounts, windowEndMs };
}

/**
 * Operator-initiated digest body. Reuses the cadence aggregator and renderer
 * but does not write `.kota/daily-digest-state.json` and does not emit
 * `workflow.daily.digest`, so other notification channels do not see the
 * on-demand call as a duplicate cadence digest.
 */
export function renderOnDemandDigest(opts: {
  projectDir: string;
  windowEndMs?: number;
}): { data: DailyDigestData; text: string } {
  const snapshot = computeDigestSnapshot(opts);
  return { data: snapshot.data, text: snapshot.text };
}
