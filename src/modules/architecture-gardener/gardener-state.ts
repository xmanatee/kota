import { existsSync } from "node:fs";
import { join } from "node:path";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type {
  ArchitectureGardenerRunState,
  ArchitectureObservationKind,
  CandidateDisposition,
} from "./types.js";

export const GARDENER_STATE_KEY = "architecture-gardener:state";
export const DEFAULT_COOLDOWN_HOURS = 24;

export function emptyGardenerRunState(): ArchitectureGardenerRunState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    lastRunId: "",
    fingerprints: {},
    dispositions: {},
    cooldowns: {},
  };
}

/**
 * Read the revisioned Architecture Gardener run-state projection from a daemon state root.
 */
export function readStoredGardenerState(
  scopeRoot: string,
  stateDir: string,
): ArchitectureGardenerRunState {
  const dbPath = join(stateDir, "kota.sqlite");
  if (!existsSync(dbPath)) {
    return emptyGardenerRunState();
  }

  const database = RunStateDatabase.openReadOnly(stateDir);
  try {
    const scopeId = database.getScopeIdByRootPath(scopeRoot);
    if (!scopeId) return emptyGardenerRunState();
    const stored = database.readScopeStateValue<ArchitectureGardenerRunState>(
      scopeId,
      GARDENER_STATE_KEY,
    );
    return stored.value ?? emptyGardenerRunState();
  } finally {
    database.close();
  }
}

/**
 * Update the revisioned state projection with new observations, dispositions, and cooldowns.
 */
export function updateGardenerRunState(args: {
  current: ArchitectureGardenerRunState;
  runId: string;
  newFingerprints?: ReadonlyArray<{
    readonly fingerprint: string;
    readonly targetScope: string;
    readonly observationKind: string;
  }>;
  newDispositions?: ReadonlyArray<{
    readonly targetScope: string;
    readonly disposition: CandidateDisposition;
    readonly reason: string;
    readonly taskId?: string;
  }>;
  cooldownTargets?: readonly string[];
  cooldownDurationHours?: number;
  now?: string;
}): ArchitectureGardenerRunState {
  const now = args.now ?? new Date().toISOString();
  const durationHours = args.cooldownDurationHours ?? DEFAULT_COOLDOWN_HOURS;
  const cooldownUntil = new Date(
    new Date(now).getTime() + durationHours * 3600 * 1000,
  ).toISOString();

  const fingerprints = { ...args.current.fingerprints };
  if (args.newFingerprints) {
    for (const item of args.newFingerprints) {
      const existing = fingerprints[item.fingerprint];
      fingerprints[item.fingerprint] = {
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        targetScope: item.targetScope,
        observationKind: item.observationKind as ArchitectureObservationKind,
      };
    }
  }

  const dispositions = { ...args.current.dispositions };
  if (args.newDispositions) {
    for (const item of args.newDispositions) {
      dispositions[item.targetScope] = {
        targetScope: item.targetScope,
        disposition: item.disposition,
        reason: item.reason,
        decidedAt: now,
        ...(item.taskId ? { taskId: item.taskId } : {}),
      };
    }
  }

  const cooldowns = { ...args.current.cooldowns };
  if (args.cooldownTargets) {
    for (const target of args.cooldownTargets) {
      cooldowns[target] = cooldownUntil;
    }
  }

  return {
    schemaVersion: 1,
    updatedAt: now,
    lastRunId: args.runId,
    fingerprints,
    dispositions,
    cooldowns,
  };
}
