import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { writeControlMonitorCoverageArtifactBestEffort } from "./control-monitor-coverage.js";
import { ensureDir, writeJsonFile, writeStrictJsonFile } from "./run-io.js";
import { createWorkflowRun } from "./run-store-creation.js";
import { migrateLegacyWorkflowState } from "./run-store-legacy-migration.js";
import { pruneWorkflowRuns } from "./run-store-retention.js";
import { STATE_FILE } from "./run-store-snapshot.js";
import {
  assertWorkflowRuntimeState,
  isPlainObject,
} from "./run-store-state-schema.js";
import type {
  WorkflowQueuedRun,
  WorkflowRecoveryState,
  WorkflowRunMetadata,
  WorkflowRuntimeState,
} from "./run-types.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowBatchBuffers,
  WorkflowRunTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
export { defaultWorkflowRunRetentionDays } from "./run-store-retention.js";

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
      ...(state?.batchBuffers ? { batchBuffers: state.batchBuffers } : {}),
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
      writeControlMonitorCoverageArtifactBestEffort({
        projectDir: this.projectDir,
        runDirPath: join(this.runsDir, runId),
        metadata: interrupted,
        errorArtifact: "control-monitor-coverage-error.txt",
      });
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

  getBatchBuffers(): WorkflowBatchBuffers {
    return this.readState().batchBuffers ?? {};
  }

  setBatchBuffers(batchBuffers: WorkflowBatchBuffers): void {
    const state = this.readState();
    if (Object.keys(batchBuffers).length > 0) {
      state.batchBuffers = batchBuffers;
    } else {
      delete state.batchBuffers;
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
    return pruneWorkflowRuns({
      projectDir: this.projectDir,
      runsDir: this.runsDir,
      state: this.readState(),
      retentionDays: opts?.retentionDays,
      minKeepPerWorkflow: opts?.minKeepPerWorkflow,
      dryRun: opts?.dryRun,
      protectedRunIds: opts?.protectedRunIds,
    });
  }

  listRuns(opts?: { workflow?: string; tag?: string; limit?: number; causedByRunId?: string }): WorkflowRunMetadata[] {
    const limit = opts?.limit ?? 20;
    if (!existsSync(this.runsDir)) return [];
    const dirs = readdirSync(this.runsDir).sort().reverse();
    const runs: WorkflowRunMetadata[] = [];
    for (const dir of dirs) {
      const meta = readOptionalJsonFile<WorkflowRunMetadata>(join(this.runsDir, dir, "metadata.json"));
      if (!meta) continue;
      if (opts?.workflow && meta.workflow !== opts.workflow) continue;
      if (opts?.tag && !(meta.tags ?? []).includes(opts.tag)) continue;
      if (opts?.causedByRunId && meta.causedBy?.runId !== opts.causedByRunId) continue;
      runs.push(meta);
    }
    return runs
      .sort((a, b) => {
        const byStartedAt = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
        return byStartedAt !== 0 ? byStartedAt : b.id.localeCompare(a.id);
      })
      .slice(0, limit);
  }

  getRun(id: string): WorkflowRunMetadata | null {
    return readOptionalJsonFile<WorkflowRunMetadata>(join(this.runsDir, id, "metadata.json"));
  }

  createRun(
    workflow: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
    runId?: string,
  ): ActiveWorkflowRunHandle {
    return createWorkflowRun({
      projectDir: this.projectDir,
      runsDir: this.runsDir,
      workflow,
      trigger,
      runId,
      state: this.readState(),
      readState: () => this.readState(),
      writeState: (s) => this.writeState(s),
    });
  }
}
