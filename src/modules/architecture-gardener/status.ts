import type { RunStateReader } from "#core/workflow/run-state-reader-provider.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { readStoredGardenerState } from "./gardener-state.js";
import type {
  ArchitectureGardenerRunState,
  ArchitectureGardenerStatus,
  ArchitectureObservation,
  CandidateStatusItem,
} from "./types.js";

/**
 * Build operator-readable status projection from observation and state records.
 */
export function buildArchitectureGardenerStatus(args: {
  repoRoot: string;
  stateDir: string;
  reader?: RunStateReader;
  currentObservations?: readonly ArchitectureObservation[];
  state?: ArchitectureGardenerRunState;
}): ArchitectureGardenerStatus {
  const state = args.state ?? readStoredGardenerState(args.repoRoot, args.stateDir, args.reader);
  const observations = args.currentObservations ?? [];

  const observationsByKind: Record<string, number> = {};
  for (const obs of observations) {
    observationsByKind[obs.kind] = (observationsByKind[obs.kind] ?? 0) + 1;
  }

  const repoTasks = listFullRepoTasks(args.repoRoot, ["open", "blocked"]);
  const candidates: CandidateStatusItem[] = Object.values(state.dispositions).map((record) => ({
    targetScope: record.targetScope,
    signals: observations.filter((o) => record.targetScope === "repo" || o.targetScope === record.targetScope)
      .map((o) => ({ kind: o.kind, summary: o.summary })),
    disposition: record.disposition,
    reason: record.reason,
    ...(record.taskId && repoTasks.some((task) => task.id === record.taskId) ? { activeTaskId: record.taskId } : {}),
  }));
  const activeTasks = repoTasks.filter((task) => state.linkedTaskIds.includes(task.id)).map((task) => ({
    taskId: task.id, title: task.title,
    targetScope: candidates.find((candidate) => candidate.activeTaskId === task.id)?.targetScope ?? "repo",
  }));

  return {
    summary: {
      totalObservations: observations.length,
      observationsByKind,
      totalCandidatesEvaluated: candidates.length,
    },
    candidates,
    activeTasks,
  };
}

/**
 * Format status for human-readable terminal output.
 */
export function formatGardenerStatusTerminal(
  status: ArchitectureGardenerStatus,
): string {
  const lines: string[] = [];

  lines.push("Architecture Gardener Status");
  lines.push("============================");
  lines.push(`Total Observations: ${status.summary.totalObservations}`);
  for (const [kind, count] of Object.entries(status.summary.observationsByKind)) {
    lines.push(`  - ${kind}: ${count}`);
  }
  lines.push("");
  lines.push(
    `Investigated targets: ${status.summary.totalCandidatesEvaluated}. Proposals are unverified expectations.`,
  );
  lines.push("");

  if (status.candidates.length > 0) {
    lines.push("Candidates & Dispositions:");
    lines.push("--------------------------");
    for (const cand of status.candidates) {
      lines.push(`[${cand.disposition.toUpperCase()}] ${cand.targetScope}`);
      lines.push(`  Reason: ${cand.reason}`);
      if (cand.signals.length > 0) {
        lines.push("  Signals:");
        for (const sig of cand.signals) {
          lines.push(`    * [${sig.kind}] ${sig.summary}`);
        }
      }
      if (cand.activeTaskId) {
        lines.push(`  Active Task: ${cand.activeTaskId}`);
      }
      lines.push("");
    }
  }

  if (status.activeTasks.length > 0) {
    lines.push("Active Implementation Tasks:");
    lines.push("----------------------------");
    for (const t of status.activeTasks) {
      lines.push(`* ${t.taskId}: ${t.title} (${t.targetScope})`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
