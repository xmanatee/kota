import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { readWorkflowOperationalState } from "#core/workflow/run-operational-projection.js";
import type {
  WorkflowQueuedRun,
  WorkflowRunMetadata,
} from "#core/workflow/run-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { PROGRESS_REVIEW_MAX_RUNS } from "./constants.js";
import { listPrunedRuns } from "./pruned-run-evidence.js";
import { isSafeRunIdBasename } from "./run-id.js";
import {
  batchPayload,
  eventScopeId,
  sourceEvidenceId,
  sourceSummary,
} from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewRunEvidence,
  ScopedRunEvidence,
} from "./types.js";

function readRunTrigger(stateDir: string, runId: string): WorkflowRunTrigger | null {
  return readOptionalJsonFile<WorkflowRunTrigger>(
    join(stateDir, "runs", runId, "trigger.json"),
  );
}

function validatedMetadataRunId(
  metadata: WorkflowRunMetadata,
  runDirName: string,
): string | null {
  if (!isSafeRunIdBasename(metadata.id)) return null;
  if (metadata.id !== runDirName) return null;
  return metadata.id;
}

function summarizeRun(
  source: ProgressReviewDirectorySource,
  runDirName: string,
  metadata: WorkflowRunMetadata,
): ProgressReviewRunEvidence {
  const trigger = readRunTrigger(source.stateDir, runDirName);
  return {
    id: sourceEvidenceId(source, `run:${runDirName}`),
    kind: "run",
    workflow: metadata.workflow,
    status: metadata.status,
    startedAt: metadata.startedAt,
    ...(metadata.completedAt ? { completedAt: metadata.completedAt } : {}),
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    ...(trigger ? { triggerEvent: trigger.event } : {}),
    path: join(".kota", "runs", runDirName, "metadata.json"),
    summary: sourceSummary(
      source,
      `${metadata.workflow} ${metadata.status} (${runDirName})`,
    ),
  };
}

function summarizePendingRun(
  source: ProgressReviewDirectorySource,
  runId: string,
  queued: WorkflowQueuedRun,
): ProgressReviewRunEvidence {
  const queuedAt = new Date(queued.enqueuedAtMs).toISOString();
  const eligibleAt =
    Number.isFinite(queued.notBeforeMs) && queued.notBeforeMs > queued.enqueuedAtMs
      ? `; eligible at ${new Date(queued.notBeforeMs).toISOString()}`
      : "";
  return {
    id: sourceEvidenceId(source, `run:${runId}`),
    kind: "run",
    workflow: queued.workflowName,
    status: "pending",
    startedAt: queuedAt,
    triggerEvent: queued.trigger.event,
    path: join(".kota", "kota.sqlite"),
    summary: sourceSummary(
      source,
      `${queued.workflowName} pending (${runId}) from ${queued.trigger.event}${eligibleAt}`,
    ),
  };
}

function readScopedRunEvidence(
  source: ProgressReviewDirectorySource,
  runDirName: string,
  excluded: string[],
): ScopedRunEvidence | null {
  const metadata = readWorkflowRunMetadataFile(
    join(source.stateDir, "runs", runDirName, "metadata.json"),
  );
  if (!metadata) return null;
  const runId = validatedMetadataRunId(metadata, runDirName);
  if (!runId) {
    excluded.push(
      `${source.displayName} workflow run ${runDirName}: metadata id is not a safe basename matching the run directory`,
    );
    return null;
  }
  const startedMs = Date.parse(metadata.startedAt);
  if (!Number.isFinite(startedMs)) {
    excluded.push(
      `${source.displayName} workflow run ${runDirName}: metadata startedAt is invalid`,
    );
    return null;
  }
  return {
    source,
    runId,
    startedMs,
    evidence: summarizeRun(source, runDirName, metadata),
  };
}

function listRecentRuns(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ScopedRunEvidence[] {
  const runsDir = join(source.stateDir, "runs");
  if (!existsSync(runsDir)) {
    excluded.push(`${source.displayName} workflow runs: .kota/runs does not exist`);
    return [];
  }
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))
    .flatMap((entry) => {
      const run = readScopedRunEvidence(source, entry.name, excluded);
      return run && run.startedMs >= windowStartMs ? [run] : [];
    });
}

function listPendingRuns(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ScopedRunEvidence[] {
  const state = readWorkflowOperationalState({
    stateDir: source.stateDir,
    scopeRoot: source.scopeRoot,
  });

  const pending: ScopedRunEvidence[] = [];
  for (const queued of state.pendingRuns) {
    const enqueuedMs = queued.enqueuedAtMs;
    if (!Number.isFinite(enqueuedMs)) {
      excluded.push(
        `${source.displayName} workflow queue: skipped ${queued.workflowName} with invalid enqueuedAtMs`,
      );
      continue;
    }
    if (enqueuedMs < windowStartMs) continue;
    if (!queued.runId || !isSafeRunIdBasename(queued.runId)) {
      excluded.push(
        `${source.displayName} workflow queue: skipped ${queued.workflowName} pending run with missing or unsafe runId`,
      );
      continue;
    }
    if (existsSync(join(source.stateDir, "runs", queued.runId, "metadata.json"))) {
      continue;
    }
    pending.push({
      source,
      runId: queued.runId,
      startedMs: enqueuedMs,
      evidence: summarizePendingRun(source, queued.runId, queued),
    });
  }
  return pending;
}

export function listRecentRunsForSources(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  trigger: WorkflowRunTrigger,
  excluded: string[],
): ScopedRunEvidence[] {
  const recentRuns = sources
    .flatMap((source) => [
      ...listRecentRuns(source, windowStartMs, excluded),
      ...listPendingRuns(source, windowStartMs, excluded),
      ...listPrunedRuns(source, windowStartMs, excluded),
    ])
    .sort((a, b) => b.startedMs - a.startedMs || a.evidence.id.localeCompare(b.evidence.id));
  const runs = mergeScopedRuns([
    ...listBatchReferencedRunEvidence(trigger, sources, excluded),
    ...recentRuns,
  ]);
  if (runs.length > PROGRESS_REVIEW_MAX_RUNS) {
    excluded.push(`workflow runs: truncated after ${PROGRESS_REVIEW_MAX_RUNS} most recent runs`);
  }
  return runs.slice(0, PROGRESS_REVIEW_MAX_RUNS);
}

function mergeScopedRuns(runs: readonly ScopedRunEvidence[]): ScopedRunEvidence[] {
  const seen = new Set<string>();
  const merged: ScopedRunEvidence[] = [];
  for (const run of runs) {
    if (seen.has(run.evidence.id)) continue;
    seen.add(run.evidence.id);
    merged.push(run);
  }
  return merged;
}

function batchRunSource(
  sources: readonly ProgressReviewDirectorySource[],
  payload: WorkflowRunTrigger["payload"],
): ProgressReviewDirectorySource | null {
  const scopeId = eventScopeId(payload);
  if (scopeId) return sources.find((source) => source.scopeId === scopeId) ?? null;
  if (sources.length === 1) return sources[0] ?? null;
  return null;
}

function listBatchReferencedRunEvidence(
  trigger: WorkflowRunTrigger,
  sources: readonly ProgressReviewDirectorySource[],
  excluded: string[],
): ScopedRunEvidence[] {
  const batch = batchPayload(trigger);
  if (!batch || batch.sourceEventName !== "workflow.completed") return [];

  const runs: ScopedRunEvidence[] = [];
  for (const event of batch.inputEvents) {
    const runId = event.payload.runId;
    if (typeof runId !== "string") continue;
    if (!isSafeRunIdBasename(runId)) {
      excluded.push(`batch event ${event.event}: skipped unsafe runId`);
      continue;
    }
    if (sources.length === 1 && sources[0]?.idPrefix && !eventScopeId(event.payload)) {
      excluded.push(`batch event ${event.event}: skipped run ${runId} with unknown scope`);
      continue;
    }
    const source = batchRunSource(sources, event.payload);
    if (!source) {
      excluded.push(`batch event ${event.event}: skipped run ${runId} with unknown scope`);
      continue;
    }
    const run = readScopedRunEvidence(source, runId, excluded);
    if (run) runs.push(run);
  }
  return runs;
}
