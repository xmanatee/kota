import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { MergeGateResult } from "#modules/git/worktree-merge-gate.js";
import type { AutomationWorktreeCleanupResult } from "./merge-gate-operations.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";

export type BuilderParallelMetrics = {
  runId: string;
  workflow: string;
  taskId: string | null;
  workspaceMode: "worktree" | "canonical";
  waitMs: number;
  runDurationMs: number;
  mergeDurationMs: number;
  conflictCount: number;
  resolverAttempts: number;
  validationFailures: number;
  cleanupOutcome: "removed" | "blocked" | "skipped";
  cleanupBlockers: string[];
  netThroughputPerHour: number;
  artifactPath: string;
  mergeGateArtifactPath: string | null;
  cleanupArtifactPath: string | null;
};

function output<T>(ctx: WorkflowStepContext, stepId: string): T | undefined {
  return ctx.stepOutputs[stepId] as T | undefined;
}

function cleanupOutcome(
  cleanup: AutomationWorktreeCleanupResult | undefined,
): Pick<BuilderParallelMetrics, "cleanupOutcome" | "cleanupBlockers" | "cleanupArtifactPath"> {
  if (!cleanup) {
    return {
      cleanupOutcome: "skipped",
      cleanupBlockers: [],
      cleanupArtifactPath: null,
    };
  }
  return {
    cleanupOutcome: cleanup.removed ? "removed" : "blocked",
    cleanupBlockers: cleanup.blockers,
    cleanupArtifactPath: cleanup.artifactPath,
  };
}

export function writeBuilderParallelMetrics(
  ctx: WorkflowStepContext,
): BuilderParallelMetrics {
  const workspace = output<BuilderWorkspaceResult>(ctx, "prepare-worktree");
  const mergeGate = output<MergeGateResult>(ctx, "merge-gate");
  const cleanup = output<AutomationWorktreeCleanupResult>(
    ctx,
    "cleanup-automation-worktree",
  );
  const buildDurationMs = ctx.stepResults.build?.durationMs ?? 0;
  const waitMs = mergeGate?.metrics.waitMs ?? 0;
  const mergeDurationMs = mergeGate?.metrics.mergeDurationMs ?? 0;
  const measuredMs = Math.max(1, buildDurationMs + waitMs + mergeDurationMs);
  const cleanupMetrics = cleanupOutcome(cleanup);
  const artifactPath = join(ctx.workflow.runDirPath, "parallel-builder-metrics.json");
  const artifact: BuilderParallelMetrics = {
    runId: ctx.workflow.runId,
    workflow: ctx.workflow.name,
    taskId: workspace?.taskId ?? null,
    workspaceMode: workspace?.enabled === true ? "worktree" : "canonical",
    waitMs,
    runDurationMs: buildDurationMs,
    mergeDurationMs,
    conflictCount: mergeGate?.metrics.conflictCount ?? 0,
    resolverAttempts: mergeGate?.metrics.resolverAttempts ?? 0,
    validationFailures: mergeGate?.metrics.validationFailures ?? 0,
    ...cleanupMetrics,
    netThroughputPerHour: 3_600_000 / measuredMs,
    artifactPath,
    mergeGateArtifactPath: mergeGate?.artifactPath ?? null,
  };
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export function createBuilderParallelMetricsStep(): TypedCodeStepInput<BuilderParallelMetrics> {
  return typedCodeStep<BuilderParallelMetrics>({
    id: "write-parallel-builder-metrics",
    type: "code",
    when: (ctx) => {
      const workspace = output<BuilderWorkspaceResult>(ctx, "prepare-worktree");
      const commit = ctx.stepOutputs.commit as { committed?: boolean } | undefined;
      return workspace?.enabled === true && commit?.committed === true;
    },
    validate: (raw) =>
      expectStructuredOutput<BuilderParallelMetrics>(raw, [
        "runId",
        "workflow",
        "workspaceMode",
        "waitMs",
        "runDurationMs",
        "mergeDurationMs",
        "conflictCount",
        "resolverAttempts",
        "validationFailures",
        "cleanupOutcome",
        "netThroughputPerHour",
        "artifactPath",
      ]),
    run: (ctx) => writeBuilderParallelMetrics(ctx),
  });
}
