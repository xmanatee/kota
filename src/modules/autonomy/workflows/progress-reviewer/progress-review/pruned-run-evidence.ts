import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceJsonObject } from "#core/evidence/policy.js";
import {
  PRUNED_RUN_REFERENCES_FILE,
  readPrunedWorkflowRunReferences,
} from "#core/workflow/run-store-retention.js";
import { progressReviewPrunedReference } from "./pruned-evidence.js";
import { isSafeRunIdBasename } from "./run-id.js";
import {
  sourceEvidenceId,
  sourceSummary,
} from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ScopedRunEvidence,
} from "./types.js";

function retainedString(
  retained: EvidenceJsonObject | undefined,
  key: string,
): string | null {
  const value = retained?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function listPrunedRuns(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ScopedRunEvidence[] {
  const runsDir = join(source.stateDir, "runs");
  if (!existsSync(runsDir)) return [];

  let references: ReturnType<typeof readPrunedWorkflowRunReferences>;
  try {
    references = readPrunedWorkflowRunReferences(runsDir);
  } catch (error) {
    excluded.push(`${source.displayName} pruned workflow runs: ${String(error)}`);
    return [];
  }

  const runs: ScopedRunEvidence[] = [];
  for (const reference of references) {
    const retained = reference.retained;
    const runId = retainedString(retained, "id");
    const workflow = retainedString(retained, "workflow");
    const status = retainedString(retained, "status");
    const startedAt = retainedString(retained, "startedAt");
    const completedAt = retainedString(retained, "completedAt");
    if (!runId || !workflow || !status || !startedAt) {
      excluded.push(
        `${source.displayName} pruned workflow runs: skipped malformed retained metadata for ${reference.id}`,
      );
      continue;
    }
    if (!isSafeRunIdBasename(runId) || runId !== reference.id) {
      excluded.push(
        `${source.displayName} pruned workflow runs: skipped unsafe or mismatched run id ${reference.id}`,
      );
      continue;
    }
    const startedMs = Date.parse(startedAt);
    const prunedAtMs = Date.parse(reference.prunedAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(prunedAtMs)) {
      excluded.push(
        `${source.displayName} pruned workflow runs ${reference.id}: invalid retained timestamp`,
      );
      continue;
    }
    if (startedMs < windowStartMs && prunedAtMs < windowStartMs) continue;
    runs.push({
      source,
      runId,
      startedMs: Math.max(startedMs, prunedAtMs),
      evidence: {
        id: sourceEvidenceId(source, `run:${runId}`),
        kind: "run",
        workflow,
        status,
        startedAt,
        ...(completedAt ? { completedAt } : {}),
        path: join(".kota", "runs", PRUNED_RUN_REFERENCES_FILE),
        summary: sourceSummary(
          source,
          `${workflow} ${status} (${runId}) metadata-only: policy-pruned-payload`,
        ),
        pruned: progressReviewPrunedReference(reference, [
          "id",
          "workflow",
          "status",
          "startedAt",
        ]),
      },
    });
  }
  if (runs.length > 0) {
    excluded.push(
      `workflow runs: included ${runs.length} policy-pruned metadata-only reference(s); payload bodies unavailable by retention policy`,
    );
  }
  return runs;
}
