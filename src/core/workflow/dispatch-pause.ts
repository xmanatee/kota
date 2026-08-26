import type { WorkflowDispatchPauseStatus } from "./dispatch-pause-types.js";

const OPERATOR_PAUSE_MESSAGE = "Persistent operator pause.";
const RUNTIME_PAUSE_MESSAGE = "Workflow dispatch is paused in the running daemon.";

export function resolveWorkflowDispatchPause(input: {
  operatorPaused: boolean;
  runtimePaused: boolean;
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
  if (input.runtimePaused) {
    return {
      paused: true,
      kind: "runtime",
      source: "runtime",
      message: RUNTIME_PAUSE_MESSAGE,
      nextAction: "Inspect the running daemon before resuming dispatch.",
    };
  }
  return { paused: false, kind: "none" };
}
