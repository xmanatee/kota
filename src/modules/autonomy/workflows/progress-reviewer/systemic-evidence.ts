import { join } from "node:path";
import { z } from "zod";
import { enumerateWorkflowRunMetadata } from "#core/workflow/run-metadata.js";
import { readWorkflowRunMetadataDurableAuthority } from "#core/workflow/run-operational-projection.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";

export const systemicRunSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  workflow: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  status: z.string(),
  delivery: z.string().nullable(),
  errors: z.array(z.string()),
  observationOnly: z.boolean(),
}).strict();
export type SystemicRun = z.infer<typeof systemicRunSchema>;

export const systemicWindowSchema = z.object({
  fromHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  toHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  baseline: z.array(systemicRunSchema),
  current: z.array(systemicRunSchema),
  excluded: z.array(z.string()),
}).strict();
export type SystemicWindow = z.infer<typeof systemicWindowSchema>;

/** Retain outcomes, never thinking traces or heuristic quality scores. */
export function systemicRun(run: WorkflowRunMetadata): SystemicRun | null {
  if (!run.completedAt || !run.steps.some((step) => step.type === "agent" && step.status !== "skipped")) return null;
  return {
    id: run.id,
    workflow: run.workflow,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    delivery: run.delivery?.kind ?? null,
    errors: [...new Set(run.steps.flatMap((step) => step.errorKind ? [step.errorKind] : []))].sort(),
    observationOnly: run.tags?.includes("systemic-observer") === true,
  };
}

export function collectSystemicRuns(scopeRoot: string, stateDir: string): {
  runs: SystemicRun[];
  excluded: string[];
} {
  const excluded: string[] = [];
  const authority = readWorkflowRunMetadataDurableAuthority({ scopeRoot, stateDir });
  const enumeration = enumerateWorkflowRunMetadata(join(stateDir, "runs"), {
    ...authority,
    onDiagnostic: (diagnostic) => excluded.push(`${diagnostic.runId ?? "runs"}: ${diagnostic.reason}`),
  });
  return {
    runs: enumeration.runs.flatMap((run) => {
      const observation = systemicRun(run);
      return observation ? [observation] : [];
    }).sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id)),
    excluded,
  };
}

export function changedSystemicRuns(baseline: readonly SystemicRun[], current: readonly SystemicRun[]): SystemicRun[] {
  const known = new Map(baseline.map((run) => [run.id, JSON.stringify(run)]));
  return current.filter((run) => known.get(run.id) !== JSON.stringify(run));
}

export function summarizeSystemicRuns(runs: readonly SystemicRun[]): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = `${run.workflow}/${run.status}/delivery=${run.delivery ?? "unavailable"}/errors=${run.errors.join(",") || "none"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}: ${count}`).join("; ") || "none";
}
