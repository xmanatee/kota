/**
 * Daily-digest workflow — periodic operator-facing rollup of what KOTA
 * accomplished over a rolling 24h window. Reads run metadata, the task tree,
 * and the owner-question queue; emits one `workflow.daily.digest` event the
 * notification channels forward verbatim.
 *
 * The trigger is a fixed cron schedule so cadence is predictable for
 * operators. Per `workflows/AGENTS.md`, autonomy workflows must not
 * subscribe to `runtime.idle` — only the dispatcher does.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import { countRepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  aggregateDailyDigest,
  type DailyDigestData,
  digestStateFromCounts,
  type QueueCounts,
  readDigestState,
} from "./aggregate.js";
import { renderDailyDigest } from "./render.js";

export const DAILY_DIGEST_STATE_FILENAME = "daily-digest-state.json";
export const DAILY_DIGEST_EVENT = "workflow.daily.digest";
export const DAILY_DIGEST_DIGEST_JSON = "digest.json";
export const DAILY_DIGEST_DIGEST_TXT = "digest.txt";

function readQueueCounts(projectDir: string): QueueCounts {
  return {
    backlog: countRepoTaskState(projectDir, "backlog"),
    ready: countRepoTaskState(projectDir, "ready"),
    doing: countRepoTaskState(projectDir, "doing"),
    blocked: countRepoTaskState(projectDir, "blocked"),
  };
}

const buildDigest = typedCodeStep<DailyDigestData>({
  id: "build-digest",
  type: "code",
  run: ({ projectDir, workflow, emit }) => {
    const runsDir = join(projectDir, ".kota", "runs");
    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    const previousState = readDigestState(statePath);
    const currentCounts = readQueueCounts(projectDir);
    const nowMs = Date.now();
    const data = aggregateDailyDigest({
      runsDir,
      projectDir,
      ownerQuestions: getOwnerQuestionQueue(),
      windowEndMs: nowMs,
      previousQueueCounts: previousState?.counts ?? null,
      currentQueueCounts: currentCounts,
    });
    const text = renderDailyDigest(data);

    writeFileSync(
      join(workflow.runDirPath, DAILY_DIGEST_DIGEST_JSON),
      JSON.stringify(data, null, 2),
    );
    writeFileSync(
      join(workflow.runDirPath, DAILY_DIGEST_DIGEST_TXT),
      `${text}\n`,
    );
    writeJsonFileAtomic(statePath, digestStateFromCounts(currentCounts, nowMs));

    emit(DAILY_DIGEST_EVENT, {
      windowStartedAt: data.windowStartedAt,
      windowEndedAt: data.windowEndedAt,
      text,
      quiet: data.quiet,
    });

    return data;
  },
});

const dailyDigestWorkflow: WorkflowDefinitionInput = {
  name: "daily-digest",
  description:
    "Emit one operator-facing digest of completed and pending autonomy work over a rolling 24h window.",
  triggers: [
    {
      // 08:00 local — predictable morning summary; operators can override the
      // schedule per-deployment.
      schedule: "0 8 * * *",
    },
  ],
  steps: [buildDigest],
};

export default dailyDigestWorkflow;
