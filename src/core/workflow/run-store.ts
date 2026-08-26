import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { projectWorkflowRunMetadataForStorage } from "./run-evidence.js";
import { ensureDir, writeStrictJsonFile } from "./run-io.js";
import { createWorkflowRun } from "./run-store-creation.js";
import { pruneWorkflowRuns } from "./run-store-retention.js";
import { STATE_FILE } from "./run-store-snapshot.js";
import {
  assertWorkflowRuntimeState,
} from "./run-store-state-schema.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunStatus,
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

export class WorkflowRunStore {
  readonly rootDir: string;
  readonly runsDir: string;
  readonly statePath: string;

  constructor(private readonly scopeRoot = process.cwd()) {
    this.rootDir = join(scopeRoot, ".kota");
    this.runsDir = join(this.rootDir, "runs");
    this.statePath = join(this.rootDir, STATE_FILE);
    ensureDir(this.rootDir);
    ensureDir(this.runsDir);
  }

  readState(): WorkflowRuntimeState {
    const state = readOptionalJsonFile<unknown>(this.statePath);
    if (state !== null) {
      assertWorkflowRuntimeState(this.statePath, state);
    }
    return {
      completedRuns: state?.completedRuns ?? 0,
      workflows: state?.workflows ?? {},
      ...(state?.totalCostUsd != null ? { totalCostUsd: state.totalCostUsd } : {}),
      ...(state?.totalInputTokens != null
        ? { totalInputTokens: state.totalInputTokens }
        : {}),
      ...(state?.totalOutputTokens != null
        ? { totalOutputTokens: state.totalOutputTokens }
        : {}),
      ...(state?.definitionsLoadedAt ? { definitionsLoadedAt: state.definitionsLoadedAt } : {}),
      ...(state?.agentBackoff ? { agentBackoff: state.agentBackoff } : {}),
      ...(state?.batchBuffers ? { batchBuffers: state.batchBuffers } : {}),
    };
  }

  private writeState(state: WorkflowRuntimeState): void {
    ensureDir(this.rootDir);
    writeStrictJsonFile(this.statePath, state);
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

  setWorkflowNextScheduledAt(
    name: string,
    nextScheduledAt: string | undefined,
  ): void {
    const state = this.readState();
    state.workflows[name] ??= {};
    if (nextScheduledAt === undefined) {
      delete state.workflows[name].nextScheduledAt;
    } else {
      state.workflows[name].nextScheduledAt = nextScheduledAt;
    }
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
      scopeRoot: this.scopeRoot,
      runsDir: this.runsDir,
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

  reconcileTerminalStatus(
    id: string,
    status: WorkflowRunStatus,
    error?: string,
  ): WorkflowRunMetadata {
    const metadata = this.getRun(id);
    if (metadata === null || metadata.status === "running") {
      throw new Error(`Cannot reconcile terminal status for workflow run "${id}"`);
    }
    const reconciled = { ...metadata, status };
    writeStrictJsonFile(
      join(this.runsDir, id, "metadata.json"),
      projectWorkflowRunMetadataForStorage(reconciled),
    );
    if (error !== undefined) {
      writeFileSync(join(this.runsDir, id, "error.txt"), redactSensitiveText(error), "utf-8");
    }

    const state = this.readState();
    const workflowState = state.workflows[metadata.workflow];
    if (workflowState?.lastCompletion?.runId === id) {
      workflowState.lastCompletion = { ...workflowState.lastCompletion, status };
      this.writeState(state);
    }
    return reconciled;
  }

  createRun(
    workflow: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
    runId?: string,
    headSha: string | null = null,
  ): ActiveWorkflowRunHandle {
    return createWorkflowRun({
      scopeRoot: this.scopeRoot,
      runsDir: this.runsDir,
      workflow,
      trigger,
      runId,
      headSha,
      state: this.readState(),
      readState: () => this.readState(),
      writeState: (s) => this.writeState(s),
    });
  }
}
