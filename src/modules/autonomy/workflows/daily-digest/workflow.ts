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
 * The data + render pipeline is shared with the on-demand digest, while its
 * repository and run-history scan executes through the workflow blocking
 * boundary together with cadence artifact/state writes. The code step only
 * emits the resulting operator event on the daemon thread.
 */

import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import type { DailyDigestData } from "./aggregate.js";
import {
  DAILY_DIGEST_DIGEST_JSON,
  DAILY_DIGEST_DIGEST_TXT,
  DAILY_DIGEST_STATE_FILENAME,
  dailyDigestBuildOperation,
} from "./blocking-operations.js";

export { DAILY_DIGEST_STATE_FILENAME };
export const DAILY_DIGEST_EVENT = "workflow.daily.digest";
export { DAILY_DIGEST_DIGEST_JSON, DAILY_DIGEST_DIGEST_TXT };

const buildDigest = typedCodeStep<DailyDigestData>({
  id: "build-digest",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<DailyDigestData>(raw, [
      "windowStartedAt",
      "windowEndedAt",
      "queueDelta",
      "quiet",
    ]),
  run: async ({ projectDir, workflow, emit, runBlocking }) => {
    const snapshot = await runBlocking(dailyDigestBuildOperation, {
      projectDir,
      runDirPath: workflow.runDirPath,
    });

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
