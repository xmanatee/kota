import type { WorkflowDispatchPauseStatus } from "./dispatch-pause-types.js";

const OPERATOR_PAUSE_MESSAGE = "Persistent operator pause.";
const RUNTIME_PAUSE_MESSAGE = "Workflow dispatch is paused in the running daemon.";

export function resolveWorkflowDispatchPause(input: {
  operatorPaused: boolean;
  runtimePaused: boolean;
  quotaPauseMessage?: string | null;
}): WorkflowDispatchPauseStatus {
  if (input.operatorPaused) {
    return {
      paused: true,
      kind: "operator",
      source: "database",
      message: OPERATOR_PAUSE_MESSAGE,
      nextAction: "Run `kota workflow resume` to re-enable dispatch.",
    };
  }
  if (input.runtimePaused || input.quotaPauseMessage != null) {
    return {
      paused: true,
      kind: "runtime",
      source: "runtime",
      message: input.quotaPauseMessage ?? RUNTIME_PAUSE_MESSAGE,
      nextAction: input.quotaPauseMessage != null
        ? "Quota is checked automatically every minute. Configure scheduler.quotaGuard to change the policy."
        : "Inspect the running daemon before resuming dispatch.",
    };
  }
  return { paused: false, kind: "none" };
}
