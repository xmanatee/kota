/**
 * Daily-digest workflow — periodic operator-facing rollup of what KOTA
 * accomplished over a rolling 24h window. Reads run metadata, the task tree,
 * and the owner-question queue; emits one `workflow.daily.digest` event the
 * notification channels forward verbatim.
 *
 * The trigger is a fixed cron schedule so cadence is predictable for
 * operators. Per `workflows/AGENTS.md`, autonomy workflows must not
 * subscribe to `runtime.idle` — only the dispatcher does.
 *
 * The data + render pipeline lives in `on-demand.ts` (`computeDigestSnapshot`)
 * so the cadence path here and the telegram `/digest` path cannot drift; the
 * cadence step layers state-write and event-emit on top.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { typedCodeStep } from "#core/workflow/types.js";
import {
  type DailyDigestData,
  digestStateFromCounts,
} from "./aggregate.js";
import {
  computeDigestSnapshot,
  DAILY_DIGEST_STATE_FILENAME,
} from "./on-demand.js";

export { DAILY_DIGEST_STATE_FILENAME };
export const DAILY_DIGEST_EVENT = "workflow.daily.digest";
export const DAILY_DIGEST_DIGEST_JSON = "digest.json";
export const DAILY_DIGEST_DIGEST_TXT = "digest.txt";

const buildDigest = typedCodeStep<DailyDigestData>({
  id: "build-digest",
  type: "code",
  run: ({ projectDir, workflow, emit }) => {
    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    const snapshot = computeDigestSnapshot({ projectDir });

    writeFileSync(
      join(workflow.runDirPath, DAILY_DIGEST_DIGEST_JSON),
      JSON.stringify(snapshot.data, null, 2),
    );
    writeFileSync(
      join(workflow.runDirPath, DAILY_DIGEST_DIGEST_TXT),
      `${snapshot.text}\n`,
    );
    writeJsonFileAtomic(
      statePath,
      digestStateFromCounts(snapshot.currentCounts, snapshot.windowEndMs),
    );

    emit(DAILY_DIGEST_EVENT, {
      windowStartedAt: snapshot.data.windowStartedAt,
      windowEndedAt: snapshot.data.windowEndedAt,
      text: snapshot.text,
      quiet: snapshot.data.quiet,
    });

    return snapshot.data;
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
