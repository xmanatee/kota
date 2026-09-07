import { workflowRunMetadataAuthorityCriticalIds } from "#core/workflow/run-metadata.js";
import type { WorkflowRunMetadataAuthorityRepair } from "#core/workflow/run-metadata-repair.js";
import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";

/**
 * Reconcile authority-critical retained runs at daemon startup. Terminal
 * history remains inspection evidence and keeps its quarantinable parsing
 * contract unless an undelivered publication still makes it authoritative.
 * Runs touched by restart recovery stay in scope even when recovery has already
 * moved them back to queued before this reconciliation pass.
 */
export function repairRetainedRunMetadataAtDaemonStartup(args: {
  scopeId: string;
  runState: RunStateDatabase;
  runStore: WorkflowRunStore;
  restartRecoveryRunIds?: ReadonlySet<string>;
  log?: (message: string) => void;
}): WorkflowRunMetadataAuthorityRepair[] {
  const durableRuns = args.runState.listRuns(args.scopeId);
  const repairRunIds = new Set(
    workflowRunMetadataAuthorityCriticalIds(
      durableRuns,
      args.runState.listPendingPublicationHeads().filter(
        (publication) => publication.scopeId === args.scopeId,
      ),
    ),
  );
  for (const run of durableRuns) {
    if (args.restartRecoveryRunIds?.has(run.id)) repairRunIds.add(run.id);
  }

  const repairs: WorkflowRunMetadataAuthorityRepair[] = [];
  for (const runId of repairRunIds) {
    const run = args.runState.getRun(runId);
    if (run === null) {
      throw new Error(
        `Durable workflow run "${runId}" disappeared before metadata reconciliation`,
      );
    }
    const repair = args.runStore.repairMetadataFromDurableAuthority(run);
    repairs.push(repair);
    if (repair.kind === "repaired") {
      args.log?.(
        `Repaired workflow run metadata "${run.id}" from durable workflow and trigger authority`,
      );
    }
  }
  return repairs;
}
