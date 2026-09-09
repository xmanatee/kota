import { existsSync } from "node:fs";
import { join } from "node:path";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { RunStateReader } from "#core/workflow/run-state-reader-provider.js";
import type { ArchitectureGardenerRunState } from "./types.js";

// A new decision contract gets a new revisioned projection. Old score-based
// dispositions cannot establish that an agent investigated an evidence cohort.
export const GARDENER_STATE_KEY = "architecture-gardener:investigations";

export function emptyGardenerRunState(): ArchitectureGardenerRunState {
  return {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    lastRunId: "",
    reviewedTaskEvidence: [],
    linkedTaskIds: [],
    reviewedCohorts: {},
    dispositions: {},
  };
}

export function readStoredGardenerState(
  scopeRoot: string,
  stateDir: string,
  reader?: RunStateReader,
): ArchitectureGardenerRunState {
  if (reader) {
    const scopeId = reader.getScopeIdByRootPath(scopeRoot);
    return scopeId ? reader.readScopeStateValue<ArchitectureGardenerRunState>(scopeId, GARDENER_STATE_KEY).value ?? emptyGardenerRunState() : emptyGardenerRunState();
  }
  if (!existsSync(join(stateDir, "kota.sqlite"))) return emptyGardenerRunState();
  const database = RunStateDatabase.openReadOnly(stateDir);
  try {
    const scopeId = database.getScopeIdByRootPath(scopeRoot);
    if (!scopeId) return emptyGardenerRunState();
    return database.readScopeStateValue<ArchitectureGardenerRunState>(
      scopeId, GARDENER_STATE_KEY,
    ).value ?? emptyGardenerRunState();
  } finally {
    database.close();
  }
}
