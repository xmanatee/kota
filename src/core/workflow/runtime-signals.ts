import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinition } from "./types.js";

export const ABORT_SIGNAL_FILE = "abort-request";
export const PAUSE_SIGNAL_FILE = "dispatch-paused";
export const RELOAD_SIGNAL_FILE = "definitions-reload-request";

export function checkAbortSignal(
  projectDir: string,
  activeRuns: ReadonlyMap<string, { abortController: AbortController }>,
  log: (message: string) => void,
): void {
  const signalPath = join(projectDir, ".kota", ABORT_SIGNAL_FILE);
  if (!existsSync(signalPath)) return;
  try {
    rmSync(signalPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to clear abort signal: ${message}`);
  }
  if (activeRuns.size > 0) {
    log("Abort signal received — aborting active run(s)");
    for (const { abortController } of activeRuns.values()) {
      abortController.abort();
    }
  }
}

export function checkReloadSignal(
  projectDir: string,
  loadDefinitions: () => WorkflowDefinition[],
  onReloaded: (defs: WorkflowDefinition[]) => void,
  log: (message: string) => void,
): void {
  const signalPath = join(projectDir, ".kota", RELOAD_SIGNAL_FILE);
  if (!existsSync(signalPath)) return;
  try {
    rmSync(signalPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to clear workflow reload signal: ${message}`);
  }
  try {
    const newDefinitions = loadDefinitions();
    onReloaded(newDefinitions);
    log(`Workflow definitions reloaded (${newDefinitions.length} definition(s))`);
  } catch (err) {
    log(`Failed to reload workflow definitions: ${(err as Error).message}`);
  }
}
