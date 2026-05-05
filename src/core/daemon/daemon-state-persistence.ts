import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { assertDaemonState, type DaemonState } from "./daemon-state.js";

export const STATE_FILE = "daemon-state.json";

export function loadDaemonStateFromDisk(stateDir: string): DaemonState | null {
  const path = join(stateDir, STATE_FILE);
  const state = readOptionalJsonFile<unknown>(path);
  if (state === null) return null;
  assertDaemonState(path, state);
  return state;
}

export function saveDaemonStateToDisk(stateDir: string, state: DaemonState): void {
  writeJsonFileAtomic(join(stateDir, STATE_FILE), state);
}
