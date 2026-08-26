import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { projectWorkflowRunMetadataForStorage } from "./run-evidence.js";
import { ensureDir, writeStrictJsonFile } from "./run-io.js";
import { createWorkflowRun } from "./run-store-creation.js";
import { pruneWorkflowRuns } from "./run-store-retention.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunStatus,
} from "./run-types.js";
import type {
  WorkflowRunTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
export { defaultWorkflowRunRetentionDays } from "./run-store-retention.js";

export class WorkflowRunStore {
  readonly rootDir: string;
  readonly runsDir: string;

  constructor(private readonly projectDir = process.cwd()) {
    this.rootDir = join(projectDir, ".kota");
    this.runsDir = join(this.rootDir, "runs");
    ensureDir(this.rootDir);
    ensureDir(this.runsDir);
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

    return reconciled;
  }

  createRun(
    workflow: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
    runId?: string,
    headSha: string | null = null,
  ): ActiveWorkflowRunHandle {
    return createWorkflowRun({
      projectDir: this.projectDir,
      runsDir: this.runsDir,
      workflow,
      trigger,
      runId,
      headSha,
    });
  }
}
