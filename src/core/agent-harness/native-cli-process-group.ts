import type { ChildProcess } from "node:child_process";

export const NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS = {
  detached: true,
} as const;

/**
 * Signal the isolated process group created for a native CLI run. Waiting for
 * only the group leader to close is insufficient: a CLI-spawned tool can keep
 * mutating after its parent has been cancelled.
 */
export function signalNativeCliProcessGroup(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) {
    // Spawn failed before a process group existed.
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
  }
}
