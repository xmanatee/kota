import {
  type ProcessIdentity,
  ProcessSupervisor,
  type ProcessTerminationOutcome,
} from "#core/execution/process-supervisor.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type { RestartRecoveryAttempt } from "./run-state-types.js";

export type BlockedRestartRecovery = Readonly<{
  runId: string;
  reason: string;
}>;

export async function recoverInterruptedRuns(input: {
  store: RunStateDatabase;
  daemonEpoch: number;
  attempts: readonly RestartRecoveryAttempt[];
  terminationGraceMs?: number;
  now?: () => string;
  parseIdentity?: (value: unknown) => ProcessIdentity;
  terminate?: (
    identity: ProcessIdentity,
    graceMs: number,
  ) => Promise<ProcessTerminationOutcome>;
  log?: (message: string) => void;
}): Promise<readonly BlockedRestartRecovery[]> {
  const graceMs = input.terminationGraceMs ?? 5_000;
  const now = input.now ?? (() => new Date().toISOString());
  const parseIdentity = input.parseIdentity ?? ProcessSupervisor.parsePersistedIdentity;
  const terminate = input.terminate ?? ProcessSupervisor.terminateOwnedProcess;
  const blocked: BlockedRestartRecovery[] = [];

  for (const attempt of input.attempts) {
    let reason: string | undefined;
    if (attempt.previousEpoch <= 0) {
      reason = "the interrupted run has no valid owning daemon epoch";
    } else {
      for (const persisted of attempt.processes) {
        try {
          const outcome = await terminate(parseIdentity(persisted), graceMs);
          if (outcome.status === "identity-mismatch") {
            reason = "a persisted process PID now belongs to a different process";
            break;
          }
          if (outcome.status === "still-running") {
            reason = "an owned process group remained alive after forced termination";
            break;
          }
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
          break;
        }
      }
    }

    if (reason !== undefined) {
      input.store.preserveBlockedRestartRecovery(attempt.runId);
      blocked.push({ runId: attempt.runId, reason });
      input.log?.(`Restart recovery preserved run "${attempt.runId}": ${reason}`);
      continue;
    }
    input.store.completeRestartRecovery(attempt.runId, input.daemonEpoch, now());
    input.log?.(`Restart recovery requeued run "${attempt.runId}"`);
  }

  return blocked;
}
