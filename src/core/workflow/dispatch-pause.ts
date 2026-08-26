import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDispatchPauseStatus } from "./dispatch-pause-types.js";
import { PAUSE_SIGNAL_FILE } from "./runtime-signals.js";

const OPERATOR_PAUSE_MESSAGE = "Persistent operator pause.";
const RUNTIME_PAUSE_MESSAGE = "Workflow dispatch is paused in the running daemon.";

function pauseSignalPath(scopeRoot: string): string {
  return join(scopeRoot, ".kota", PAUSE_SIGNAL_FILE);
}

export function hasPersistentDispatchPause(scopeRoot: string): boolean {
  return existsSync(pauseSignalPath(scopeRoot));
}

export function writeOperatorPauseSignal(scopeRoot: string): void {
  mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
  writeFileSync(
    pauseSignalPath(scopeRoot),
    `${JSON.stringify({ kind: "operator", pausedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

export function clearWorkflowPauseSignal(scopeRoot: string): void {
  rmSync(pauseSignalPath(scopeRoot), { force: true });
}

export function resolveWorkflowDispatchPause(input: {
  scopeRoot: string;
  runtimePaused: boolean;
}): WorkflowDispatchPauseStatus {
  if (hasPersistentDispatchPause(input.scopeRoot)) {
    return {
      paused: true,
      kind: "operator",
      source: "signal",
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
