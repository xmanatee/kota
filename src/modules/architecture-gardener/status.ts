import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { readStoredGardenerState } from "./gardener-state.js";
import type {
  AdmissionEvaluation,
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
  currentObservations?: readonly ArchitectureObservation[];
  recentEvaluations?: readonly AdmissionEvaluation[];
  state?: ArchitectureGardenerRunState;
}): ArchitectureGardenerStatus {
  const state = args.state ?? readStoredGardenerState(args.repoRoot, args.stateDir);
  const observations = args.currentObservations ?? [];

  const observationsByKind: Record<string, number> = {};
  for (const obs of observations) {
    observationsByKind[obs.kind] = (observationsByKind[obs.kind] ?? 0) + 1;
  }

  const candidates: CandidateStatusItem[] = [];

  // If recent evaluations provided, use them; otherwise use stored dispositions
  if (args.recentEvaluations && args.recentEvaluations.length > 0) {
    for (const ev of args.recentEvaluations) {
      candidates.push({
        targetScope: ev.targetScope,
        signals: ev.signals.map((s) => ({ kind: s.kind, summary: s.summary })),
        disposition: ev.disposition,
        reason: ev.reason,
      });
    }
  } else {
    for (const [scope, rec] of Object.entries(state.dispositions)) {
      candidates.push({
        targetScope: scope,
        signals: [],
        disposition: rec.disposition,
        reason: rec.reason,
        activeTaskId: rec.taskId,
      });
    }
  }

  let acceptedCount = 0;
  let rejectedCount = 0;
  let deferredCount = 0;
  let cooledDownCount = 0;
  let suppressedCount = 0;
  let deduplicatedCount = 0;

  for (const c of candidates) {
    switch (c.disposition) {
      case "accepted":
        acceptedCount += 1;
        break;
      case "rejected":
        rejectedCount += 1;
        break;
      case "deferred":
        deferredCount += 1;
        break;
      case "cooled_down":
        cooledDownCount += 1;
        break;
      case "suppressed":
        suppressedCount += 1;
        break;
      case "deduplicated":
        deduplicatedCount += 1;
        break;
    }
  }

  // Find active gardener tasks in repository
  const repoTasks = listFullRepoTasks(args.repoRoot, ["open", "blocked"]);
  const activeTasks = repoTasks
    .filter((t) => t.id.startsWith("task-generated-") || t.body.includes("architecture-gardener"))
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      targetScope: t.body.match(/`([^`]+)`/)?.[1] ?? "repo",
    }));

  return {
    summary: {
      totalObservations: observations.length,
      observationsByKind,
      totalCandidatesEvaluated: candidates.length,
      acceptedCount,
      rejectedCount,
      deferredCount,
      cooledDownCount,
      suppressedCount,
      deduplicatedCount,
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
    `Candidates Evaluated: ${status.summary.totalCandidatesEvaluated} (${status.summary.acceptedCount} accepted, ${status.summary.suppressedCount} suppressed, ${status.summary.cooledDownCount} cooled down, ${status.summary.deduplicatedCount} deduplicated, ${status.summary.rejectedCount} rejected)`,
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
