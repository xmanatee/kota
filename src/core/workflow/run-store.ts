import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSensitiveText } from "#core/evidence/policy.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { projectWorkflowRunMetadataForStorage } from "./run-evidence.js";
import {
  ensureDir,
  validateWorkflowRunId,
  writeStrictJsonFile,
} from "./run-io.js";
import {
  enumerateWorkflowRunMetadata,
  readWorkflowRunMetadataFile,
} from "./run-metadata.js";
import { readWorkflowRunMetadataDurableAuthority } from "./run-operational-projection.js";
import { createWorkflowRun } from "./run-store-creation.js";
import { pruneWorkflowRuns } from "./run-store-retention.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunStatus,
} from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
export { defaultWorkflowRunRetentionDays } from "./run-store-retention.js";

export class WorkflowRunStore {
  readonly rootDir: string;
  readonly runsDir: string;

  private readonly authorityCriticalRunIds: () => ReadonlySet<string>;
  private readonly operationallyActiveRunIds: () => ReadonlySet<string>;
  private readonly terminalRunIds: () => ReadonlySet<string>;

  constructor(
    private readonly scopeRoot = process.cwd(),
    options: Readonly<{
      /** Canonical daemon state root containing kota.sqlite. */
      stateDir?: string;
      authorityCriticalRunIds?: () => ReadonlySet<string>;
      operationallyActiveRunIds?: () => ReadonlySet<string>;
      terminalRunIds?: () => ReadonlySet<string>;
    }> = {},
  ) {
    this.rootDir = join(scopeRoot, ".kota");
    this.runsDir = join(this.rootDir, "runs");
    const stateDir = options.stateDir ?? this.rootDir;
    this.authorityCriticalRunIds = options.authorityCriticalRunIds ??
      (() =>
        readWorkflowRunMetadataDurableAuthority({
          stateDir,
          scopeRoot: this.scopeRoot,
        }).authorityCriticalRunIds);
    this.operationallyActiveRunIds = options.operationallyActiveRunIds ??
      (() =>
        readWorkflowRunMetadataDurableAuthority({
          stateDir,
          scopeRoot: this.scopeRoot,
        }).operationallyActiveRunIds);
    this.terminalRunIds = options.terminalRunIds ??
      (() =>
        readWorkflowRunMetadataDurableAuthority({
          stateDir,
          scopeRoot: this.scopeRoot,
        }).terminalRunIds);
    ensureDir(this.rootDir);
    ensureDir(this.runsDir);
  }

  pruneRuns(opts?: {
    retentionDays?: number;
    minKeepPerWorkflow?: number;
    dryRun?: boolean;
    /** Additional run IDs to protect (e.g. from daemon live state). */
    protectedRunIds?: Set<string>;
    /** Durable runs whose metadata must exist and decode before pruning. */
    authorityCriticalRunIds?: ReadonlySet<string>;
    operationallyActiveRunIds?: ReadonlySet<string>;
    terminalRunIds?: ReadonlySet<string>;
  }): string[] {
    return pruneWorkflowRuns({
      scopeRoot: this.scopeRoot,
      runsDir: this.runsDir,
      retentionDays: opts?.retentionDays,
      minKeepPerWorkflow: opts?.minKeepPerWorkflow,
      dryRun: opts?.dryRun,
      protectedRunIds: opts?.protectedRunIds,
      authorityCriticalRunIds:
        opts?.authorityCriticalRunIds ?? this.authorityCriticalRunIds(),
      operationallyActiveRunIds:
        opts?.operationallyActiveRunIds ?? this.operationallyActiveRunIds(),
      terminalRunIds: opts?.terminalRunIds ?? this.terminalRunIds(),
    });
  }

  listRuns(opts?: {
    workflow?: string;
    tag?: string;
    limit?: number;
    causedByRunId?: string;
    authorityCriticalRunIds?: ReadonlySet<string>;
    operationallyActiveRunIds?: ReadonlySet<string>;
    terminalRunIds?: ReadonlySet<string>;
  }): WorkflowRunMetadata[] {
    const limit = opts?.limit ?? 20;
    const runs: WorkflowRunMetadata[] = [];
    for (const meta of enumerateWorkflowRunMetadata(this.runsDir, {
      authorityCriticalRunIds:
        opts?.authorityCriticalRunIds ?? this.authorityCriticalRunIds(),
      operationallyActiveRunIds:
        opts?.operationallyActiveRunIds ?? this.operationallyActiveRunIds(),
      terminalRunIds: opts?.terminalRunIds ?? this.terminalRunIds(),
    }).runs) {
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

  getRun(
    id: string,
    options: Readonly<{
      authorityCritical: true;
      operationallyActive?: boolean;
    }>,
  ): WorkflowRunMetadata;
  getRun(
    id: string,
    options?: Readonly<{
      authorityCritical?: false;
      operationallyActive?: false;
    }>,
  ): WorkflowRunMetadata | null;
  getRun(
    id: string,
    options: Readonly<{
      authorityCritical?: boolean;
      operationallyActive?: boolean;
    }> = {},
  ): WorkflowRunMetadata | null {
    const validatedId = validateWorkflowRunId(id, "Workflow run lookup");
    const path = join(this.runsDir, validatedId, "metadata.json");
    const durablyOperational = this.operationallyActiveRunIds().has(validatedId);
    const operationallyActive =
      options.operationallyActive ?? durablyOperational;
    const authorityCritical = options.authorityCritical || operationallyActive ||
      this.authorityCriticalRunIds().has(validatedId);
    return authorityCritical
      ? readWorkflowRunMetadataFile(path, {
          authorityCritical: true,
          operationallyActive,
        })
      : readWorkflowRunMetadataFile(path);
  }

  resolveRunIdPrefix(prefix: string): string | null {
    return this.listRuns({ limit: Number.MAX_SAFE_INTEGER })
      .find((run) => run.id.startsWith(prefix))?.id ?? null;
  }

  reconcileTerminalStatus(
    id: string,
    status: WorkflowRunStatus,
    error?: string,
  ): WorkflowRunMetadata {
    const metadata = this.getRun(id, {
      authorityCritical: true,
      operationallyActive: false,
    });
    if (metadata.status === "running") {
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
    });
  }
}
