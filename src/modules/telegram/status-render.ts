import { computeCostByWorkflow, loadRecentRuns } from "#modules/autonomy/shared.js";
import type { StatusInfo } from "./status-types.js";

/** Telegram sendMessage hard limit; longer bodies must be truncated client-side. */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Default page size for the chat-side `/answer-log` projection. */
export const ANSWER_LOG_DEFAULT_LIMIT = 5;

/**
 * Fixed help body for the umbrella `/retract` command. The retract seam
 * intentionally has no classifier, so the umbrella exists only to point
 * the operator at the four explicit-target subcommands.
 */
export const RETRACT_UMBRELLA_HELP_BODY =
  "Retract removes one record from one named store. The seam has no classifier — pick the target explicitly:\n" +
  "  /retract-memory <id>\n" +
  "  /retract-knowledge <slug>\n" +
  "  /retract-tasks <id>\n" +
  "  /retract-inbox <path>";

export function buildStatusText({ runtimeState, dispatchPaused, runsDir }: StatusInfo): string {
  const activeRuns = runtimeState.activeRuns;

  let dispatchStatus: string;
  if (dispatchPaused) {
    dispatchStatus = "paused";
  } else if (activeRuns.length > 0) {
    dispatchStatus = "active";
  } else {
    dispatchStatus = "idle";
  }

  const lines: string[] = [`*Dispatch:* ${dispatchStatus}`];

  for (const run of activeRuns) {
    lines.push(`*Active run:* \`${run.runId}\` (${run.workflow})`);
  }

  const runs = loadRecentRuns(runsDir);
  const costByWorkflow = computeCostByWorkflow(runs);
  const totalCost = Object.values(costByWorkflow).reduce((a, b) => a + b, 0);
  lines.push(`*Today's spend:* $${totalCost.toFixed(4)}`);

  const workflowEntries = Object.entries(runtimeState.workflows).filter(
    ([, entry]) => entry.lastCompletion != null,
  );
  if (workflowEntries.length > 0) {
    lines.push("*Last status:*");
    for (const [name, entry] of workflowEntries) {
      lines.push(`  ${name}: ${entry.lastCompletion!.status}`);
    }
  }

  return lines.join("\n");
}

export function truncateForTelegram(body: string): string {
  if (body.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return body;
  const suffix = "\n…(truncated)";
  return `${body.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}
