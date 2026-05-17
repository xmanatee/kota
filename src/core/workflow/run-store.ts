import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { createActiveRunHandle } from "./active-run-handle.js";
import {
  ensureDir,
  formatRunId,
  writeJsonFile,
  writeStrictJsonFile,
} from "./run-io.js";
import { migrateLegacyWorkflowState } from "./run-store-legacy-migration.js";
import { buildWorkflowSnapshot, STATE_FILE } from "./run-store-snapshot.js";
import {
  assertWorkflowRuntimeState,
  isPlainObject,
} from "./run-store-state-schema.js";
import type {
  WorkflowActiveRun,
  WorkflowQueuedRun,
  WorkflowRecoveryState,
  WorkflowRunMetadata,
  WorkflowRuntimeState,
} from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowAgentBackoffState, WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type { ActiveWorkflowRunHandle } from "./active-run-handle.js";

type RecoverableRunMetadata = Omit<WorkflowRunMetadata, "steps"> & {
  steps: unknown[];
};

function isRecoverableRunMetadata(value: unknown): value is RecoverableRunMetadata {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    typeof value.workflow === "string" &&
    typeof value.definitionPath === "string" &&
    isPlainObject(value.trigger) &&
    typeof value.trigger.event === "string" &&
    isPlainObject(value.trigger.payload) &&
    typeof value.startedAt === "string" &&
    typeof value.runDir === "string" &&
    Array.isArray(value.steps)
  );
}

export class WorkflowRunStore {
  readonly rootDir: string;
  readonly runsDir: string;
  readonly statePath: string;

  constructor(private readonly projectDir = process.cwd()) {
    this.rootDir = join(projectDir, ".kota");
    this.runsDir = join(this.rootDir, "runs");
    this.statePath = join(this.rootDir, STATE_FILE);
    ensureDir(this.rootDir);
    ensureDir(this.runsDir);
  }

  readState(): WorkflowRuntimeState {
    const state = readOptionalJsonFile<unknown>(this.statePath);
    if (state !== null) {
      if (isPlainObject(state)) migrateLegacyWorkflowState(state);
      assertWorkflowRuntimeState(this.statePath, state);
    }
    return {
      completedRuns: state?.completedRuns ?? 0,
      pendingRuns: state?.pendingRuns ?? [],
      workflows: state?.workflows ?? {},
      ...(state?.activeRuns !== undefined ? { activeRuns: state.activeRuns } : {}),
      ...(state?.totalCostUsd != null ? { totalCostUsd: state.totalCostUsd } : {}),
      ...(state?.definitionsLoadedAt ? { definitionsLoadedAt: state.definitionsLoadedAt } : {}),
      ...(state?.agentBackoff ? { agentBackoff: state.agentBackoff } : {}),
      ...(state?.recovery ? { recovery: state.recovery } : {}),
    };
  }

  private writeState(state: WorkflowRuntimeState): void {
    ensureDir(this.rootDir);
    writeStrictJsonFile(this.statePath, state);
  }

  recoverInterruptedRuns(): WorkflowRunMetadata[] {
    const state = this.readState();

    const candidates: Array<{ runId: string; workflow: string }> =
      (state.activeRuns ?? []).map((r) => ({ runId: r.runId, workflow: r.workflow }));

    const recovered: WorkflowRunMetadata[] = [];

    for (const { runId } of candidates) {
      const metadataPath = join(this.runsDir, runId, "metadata.json");
      const metadata = readOptionalJsonFile<unknown>(metadataPath);
      if (!isRecoverableRunMetadata(metadata) || metadata.status !== "running") continue;

      const now = new Date().toISOString();
      const interrupted = {
        ...metadata,
        status: "interrupted",
        completedAt: now,
        durationMs: Date.now() - new Date(metadata.startedAt).getTime(),
      } as WorkflowRunMetadata;

      writeJsonFile(metadataPath, interrupted);
      const errorPath = join(this.runsDir, runId, "error.txt");
      writeFileSync(errorPath, "Interrupted: daemon restarted while run was in progress.", "utf-8");
      state.workflows[metadata.workflow] = {
        ...state.workflows[metadata.workflow],
        lastCompletion: {
          runId: metadata.id,
          startedAt: metadata.startedAt,
          completedAt: interrupted.completedAt!,
          status: "interrupted",
        },
      };
      recovered.push(interrupted);
    }

    state.activeRuns = [];
    this.writeState(state);

    return recovered;
  }

  setPendingRuns(pendingRuns: WorkflowQueuedRun[]): void {
    const state = this.readState();
    state.pendingRuns = pendingRuns;
    this.writeState(state);
  }

  setDefinitionsLoadedAt(loadedAt: string): void {
    const state = this.readState();
    state.definitionsLoadedAt = loadedAt;
    this.writeState(state);
  }

  setAgentBackoff(backoff: WorkflowAgentBackoffState | null): void {
    const state = this.readState();
    if (backoff) {
      state.agentBackoff = backoff;
    } else {
      delete state.agentBackoff;
    }
    this.writeState(state);
  }

  getRecovery(): WorkflowRecoveryState | null {
    return this.readState().recovery ?? null;
  }

  setRecovery(recovery: WorkflowRecoveryState | null): void {
    const state = this.readState();
    if (recovery) {
      state.recovery = recovery;
    } else {
      delete state.recovery;
    }
    this.writeState(state);
  }

  setWorkflowNextScheduledAt(name: string, nextScheduledAt: string): void {
    const state = this.readState();
    state.workflows[name] = {
      ...state.workflows[name],
      nextScheduledAt,
    };
    this.writeState(state);
  }

  pruneRuns(opts?: {
    retentionDays?: number;
    minKeepPerWorkflow?: number;
    dryRun?: boolean;
    /** Additional run IDs to protect (e.g. from daemon live state). */
    protectedRunIds?: Set<string>;
  }): string[] {
    const retentionDays = opts?.retentionDays ?? 7;
    const minKeepPerWorkflow = opts?.minKeepPerWorkflow ?? 10;
    const dryRun = opts?.dryRun ?? false;

    if (!existsSync(this.runsDir)) return [];
    const dirs = readdirSync(this.runsDir);

    const state = this.readState();
    const protectedIds = new Set<string>(opts?.protectedRunIds);
    for (const run of state.activeRuns ?? []) protectedIds.add(run.runId);

    type RunEntry = { id: string; workflow: string; startedAtMs: number };
    const runs: RunEntry[] = [];
    for (const dir of dirs) {
      const metaPath = join(this.runsDir, dir, "metadata.json");
      const meta = readOptionalJsonFile<WorkflowRunMetadata>(metaPath);
      if (meta?.id && meta.workflow && meta.startedAt) {
        runs.push({
          id: meta.id,
          workflow: meta.workflow,
          startedAtMs: new Date(meta.startedAt).getTime(),
        });
      }
    }

    const byWorkflow: Record<string, RunEntry[]> = {};
    for (const run of runs) {
      if (!byWorkflow[run.workflow]) byWorkflow[run.workflow] = [];
      byWorkflow[run.workflow].push(run);
    }

    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const wfRuns of Object.values(byWorkflow)) {
      wfRuns.sort((a, b) => b.startedAtMs - a.startedAtMs);
      for (let i = 0; i < wfRuns.length; i++) {
        const run = wfRuns[i];
        if (protectedIds.has(run.id)) continue;
        if (i < minKeepPerWorkflow) continue;
        if (run.startedAtMs > cutoffMs) continue;
        toDelete.push(run.id);
      }
    }

    if (!dryRun) {
      for (const id of toDelete) {
        rmSync(join(this.runsDir, id), { recursive: true, force: true });
      }
    }

    return toDelete;
  }

  listRuns(opts?: { workflow?: string; tag?: string; limit?: number; causedByRunId?: string }): WorkflowRunMetadata[] {
    const limit = opts?.limit ?? 20;
    if (!existsSync(this.runsDir)) return [];
    const dirs = readdirSync(this.runsDir).sort().reverse();
    const runs: WorkflowRunMetadata[] = [];
    for (const dir of dirs) {
      // When filtering by causedByRunId, scan all dirs to avoid missing matches
      if (!opts?.causedByRunId && runs.length >= limit) break;
      const meta = readOptionalJsonFile<WorkflowRunMetadata>(join(this.runsDir, dir, "metadata.json"));
      if (!meta) continue;
      if (opts?.workflow && meta.workflow !== opts.workflow) continue;
      if (opts?.tag && !(meta.tags ?? []).includes(opts.tag)) continue;
      if (opts?.causedByRunId && meta.causedBy?.runId !== opts.causedByRunId) continue;
      runs.push(meta);
    }
    return opts?.causedByRunId ? runs.slice(0, limit) : runs;
  }

  getRun(id: string): WorkflowRunMetadata | null {
    return readOptionalJsonFile<WorkflowRunMetadata>(join(this.runsDir, id, "metadata.json"));
  }

  createRun(
    workflow: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ) {
    const state = this.readState();
    const id = typeof trigger.payload._runId === "string" && trigger.payload._runId
      ? trigger.payload._runId
      : formatRunId(workflow.name);
    const runDirPath = join(this.runsDir, id);
    ensureDir(runDirPath);
    ensureDir(join(runDirPath, "steps"));

    const triggeredByRunId =
      typeof trigger.payload.runId === "string" ? trigger.payload.runId : undefined;
    const causedBy =
      trigger.event === "workflow.completed" &&
      typeof trigger.payload.runId === "string" &&
      typeof trigger.payload.workflow === "string"
        ? { runId: trigger.payload.runId, workflow: trigger.payload.workflow }
        : undefined;
    const retryOf =
      typeof trigger.payload.retryOf === "string" ? trigger.payload.retryOf : undefined;
    const resumedFromRunId =
      typeof trigger.payload.resumedFromRunId === "string" ? trigger.payload.resumedFromRunId : undefined;
    const tags =
      Array.isArray(trigger.payload.tags) &&
      (trigger.payload.tags as unknown[]).every((t) => typeof t === "string")
        ? [...(trigger.payload.tags as string[])]
        : undefined;

    const metadata: WorkflowRunMetadata = {
      id,
      workflow: workflow.name,
      definitionPath: workflow.definitionPath,
      trigger,
      ...(triggeredByRunId !== undefined && { triggeredByRunId }),
      ...(causedBy !== undefined && { causedBy }),
      ...(retryOf !== undefined && { retryOf }),
      ...(resumedFromRunId !== undefined && { resumedFromRunId }),
      ...(tags !== undefined && tags.length > 0 && { tags }),
      startedAt: new Date().toISOString(),
      status: "running",
      runDir: relative(this.projectDir, runDirPath),
      steps: [],
    };

    writeJsonFile(join(runDirPath, "workflow.json"), buildWorkflowSnapshot(workflow));
    writeJsonFile(join(runDirPath, "trigger.json"), trigger);
    writeJsonFile(join(runDirPath, "metadata.json"), metadata);

    const newActiveRun: WorkflowActiveRun = {
      runId: id,
      workflow: workflow.name,
      startedAt: metadata.startedAt,
    };
    state.activeRuns = [...(state.activeRuns ?? []), newActiveRun];
    state.workflows[workflow.name] = {
      ...state.workflows[workflow.name],
      lastStarted: { runId: id, startedAt: metadata.startedAt },
    };
    this.writeState(state);

    return createActiveRunHandle({
      id,
      runDirPath,
      metadata,
      workflowName: workflow.name,
      stepOrder: buildStepOrder(workflow.steps),
      readState: () => this.readState(),
      writeState: (s) => this.writeState(s),
    });
  }
}

function buildStepOrder(steps: readonly WorkflowStep[]): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  const visit = (step: WorkflowStep): void => {
    order.set(step.id, order.size);
    if (step.type === "parallel" || step.type === "foreach") {
      for (const child of step.steps) visit(child);
      return;
    }
    if (step.type === "branch") {
      for (const child of step.ifTrue) visit(child);
      for (const child of step.ifFalse) visit(child);
    }
  };

  for (const step of steps) visit(step);
  return order;
}
