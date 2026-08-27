import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildEvidencePrunedReference,
  type EvidenceArtifactReference,
  type EvidenceLifecycleState,
  type EvidencePrunedReference,
  evidenceRetentionDurationMsFor,
  resolveEvidenceRetention,
} from "#core/evidence/policy.js";
import { validateEvidencePrunedReference } from "#core/evidence/pruned-reference.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { readWorkflowRunMetadataForEnumeration } from "./run-metadata.js";
import type { WorkflowRunMetadata } from "./run-types.js";

export const PRUNED_RUN_REFERENCES_FILE = "pruned-runs.jsonl";
const DAY_MS = 24 * 60 * 60 * 1000;

export type WorkflowRunPruneOptions = {
  scopeRoot: string;
  runsDir: string;
  retentionDays?: number;
  minKeepPerWorkflow?: number;
  dryRun?: boolean;
  protectedRunIds?: Set<string>;
};

type RunEntry = {
  id: string;
  workflow: string;
  startedAtMs: number;
  retainedFromMs: number;
  lifecycleState: EvidenceLifecycleState;
  metadata: WorkflowRunMetadata;
};

export function defaultWorkflowRunRetentionDays(): number {
  return evidenceRetentionDurationMsFor({
    artifactType: "workflow-run",
    state: "terminal",
    scope: "directory",
  }) / DAY_MS;
}

export function readPrunedWorkflowRunReferences(
  runsDir: string,
): EvidencePrunedReference[] {
  const filePath = join(runsDir, PRUNED_RUN_REFERENCES_FILE);
  if (!existsSync(filePath)) return [];
  const references: EvidencePrunedReference[] = [];
  const lines = readFileSync(filePath, "utf-8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;
    const parsed = JSON.parse(line) as Partial<EvidencePrunedReference>;
    const validation = validateEvidencePrunedReference(parsed, {
      artifactType: "workflow-run",
      retainedKeys: ["id", "workflow", "status", "startedAt"],
    });
    if (!validation.ok) {
      throw new Error(
        `${filePath}:${index + 1}: malformed pruned workflow-run reference: ${validation.reason}`,
      );
    }
    references.push(validation.reference);
  }
  return references;
}

export function pruneWorkflowRuns(opts: WorkflowRunPruneOptions): string[] {
  const retentionMsOverride = opts.retentionDays !== undefined
    ? opts.retentionDays * DAY_MS
    : undefined;
  const minKeepPerWorkflow = opts.minKeepPerWorkflow ?? 10;
  const dryRun = opts.dryRun ?? false;

  if (!existsSync(opts.runsDir)) return [];

  const protectedIds = new Set<string>(opts.protectedRunIds);
  for (const runId of listTrackedRunIds(opts.scopeRoot, opts.runsDir)) {
    protectedIds.add(runId);
  }

  const runs = readRunEntries(opts.runsDir);
  const byWorkflow = groupRunsByWorkflow(runs);
  const toDelete = selectRunsToPrune({
    byWorkflow,
    minKeepPerWorkflow,
    nowMs: Date.now(),
    protectedIds,
    retentionMsOverride,
  });

  if (!dryRun) {
    const prunedAt = new Date().toISOString();
    for (const run of toDelete) {
      appendPrunedRunReference(opts.runsDir, run.metadata, prunedAt);
      rmSync(join(opts.runsDir, run.id), { recursive: true, force: true });
    }
  }

  return toDelete.map((run) => run.id);
}

function toGitPath(path: string): string {
  return path.split("\\").join("/");
}

function listTrackedRunIds(scopeRoot: string, runsDir: string): Set<string> {
  const runsPath = toGitPath(relative(scopeRoot, runsDir));
  if (!runsPath || runsPath.startsWith("..")) return new Set();

  try {
    const output = execFileSync("git", ["ls-files", "--", runsPath], {
      cwd: scopeRoot,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!output) return new Set();

    const prefix = `${runsPath.replace(/\/+$/, "")}/`;
    const runIds = new Set<string>();
    for (const line of output.split("\n")) {
      if (!line.startsWith(prefix)) continue;
      const runId = line.slice(prefix.length).split("/", 1)[0];
      if (runId) runIds.add(runId);
    }
    return runIds;
  } catch {
    return new Set();
  }
}

function readRunEntries(runsDir: string): RunEntry[] {
  const dirs = readdirSync(runsDir);
  const runs: RunEntry[] = [];
  for (const dir of dirs) {
    const metaPath = join(runsDir, dir, "metadata.json");
    const meta = readWorkflowRunMetadataForEnumeration(metaPath);
    if (meta?.id && meta.workflow && meta.startedAt) {
      runs.push({
        id: meta.id,
        workflow: meta.workflow,
        startedAtMs: new Date(meta.startedAt).getTime(),
        retainedFromMs: runRetentionStartMs(meta),
        lifecycleState: workflowRunLifecycleState(meta),
        metadata: meta,
      });
    }
  }
  return runs;
}

function groupRunsByWorkflow(runs: RunEntry[]): Record<string, RunEntry[]> {
  const byWorkflow: Record<string, RunEntry[]> = {};
  for (const run of runs) {
    if (!byWorkflow[run.workflow]) byWorkflow[run.workflow] = [];
    byWorkflow[run.workflow].push(run);
  }
  return byWorkflow;
}

function selectRunsToPrune(opts: {
  byWorkflow: Record<string, RunEntry[]>;
  minKeepPerWorkflow: number;
  nowMs: number;
  protectedIds: Set<string>;
  retentionMsOverride: number | undefined;
}): RunEntry[] {
  const toDelete: RunEntry[] = [];

  for (const wfRuns of Object.values(opts.byWorkflow)) {
    wfRuns.sort((a, b) => b.startedAtMs - a.startedAtMs);
    for (let i = 0; i < wfRuns.length; i++) {
      const run = wfRuns[i];
      if (opts.protectedIds.has(run.id)) continue;
      if (i < opts.minKeepPerWorkflow) continue;
      if (!isWorkflowRunPastRetention(run, opts.nowMs, opts.retentionMsOverride)) {
        continue;
      }
      toDelete.push(run);
    }
  }

  return toDelete;
}

function appendPrunedRunReference(
  runsDir: string,
  metadata: WorkflowRunMetadata,
  prunedAt: string,
): void {
  const sourceEventIds =
    metadata.trigger.eventId !== undefined ? [metadata.trigger.eventId] : [];
  const transformedFrom: EvidenceArtifactReference[] = sourceEventIds.map((id) => ({
    artifactType: "event-envelope" as const,
    id,
  }));
  if (metadata.causedBy !== undefined) {
    transformedFrom.push({
      artifactType: "workflow-run",
      id: metadata.causedBy.runId,
    });
  }
  const reference = buildEvidencePrunedReference({
    artifactType: "workflow-run",
    id: metadata.id,
    prunedAt,
    retained: {
      id: metadata.id,
      workflow: metadata.workflow,
      status: metadata.status,
      startedAt: metadata.startedAt,
      ...(metadata.completedAt !== undefined ? { completedAt: metadata.completedAt } : {}),
      ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    },
    provenance: {
      workflowName: metadata.workflow,
      runId: metadata.id,
      sourceEventIds,
      transformedFrom,
    },
  });
  appendFileSync(
    join(runsDir, PRUNED_RUN_REFERENCES_FILE),
    `${JSON.stringify(reference)}\n`,
    "utf-8",
  );
}

function workflowRunLifecycleState(metadata: WorkflowRunMetadata): EvidenceLifecycleState {
  return metadata.status === "running" ? "active" : "terminal";
}

function runRetentionStartMs(metadata: WorkflowRunMetadata): number {
  const retainedFrom = metadata.status === "running"
    ? metadata.startedAt
    : (metadata.completedAt ?? metadata.startedAt);
  return new Date(retainedFrom).getTime();
}

function isWorkflowRunPastRetention(
  run: {
    retainedFromMs: number;
    lifecycleState: EvidenceLifecycleState;
  },
  nowMs: number,
  retentionMsOverride: number | undefined,
): boolean {
  if (retentionMsOverride !== undefined) {
    return run.retainedFromMs <= nowMs - retentionMsOverride;
  }
  const resolved = resolveEvidenceRetention({
    artifactType: "workflow-run",
    state: run.lifecycleState,
    scope: "directory",
    retainedFrom: new Date(run.retainedFromMs),
  });
  return resolved.kind === "expires" && Date.parse(resolved.expiresAt) <= nowMs;
}
