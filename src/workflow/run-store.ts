import {
  appendFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { SDKMessage } from "../agent-sdk/types.js";
import { readOptionalJsonFile } from "../json-file.js";
import {
  assertWorkflowRunMetadata,
  assertWorkflowRuntimeState,
  buildWorkflowSnapshot,
  ensureDir,
  formatRunId,
  STATE_FILE,
  safeJsonStringify,
  writeJsonFile,
} from "./run-store-helpers.js";
import type {
  WorkflowActiveRun,
  WorkflowAgentBackoffState,
  WorkflowDefinition,
  WorkflowQueuedRun,
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "./types.js";

type FinishUpdate = {
  status: WorkflowRunStatus;
  durationMs: number;
  error?: string;
};

export type ActiveWorkflowRunHandle = {
  metadata: WorkflowRunMetadata;
  appendAgentMessage(stepId: string, message: SDKMessage): void;
  writeAgentInputs(
    stepId: string,
    systemPromptAppend: string | undefined,
    prompt: string,
  ): void;
  recordStep(result: WorkflowStepResult): void;
  finish(update: FinishUpdate): WorkflowRunMetadata;
};

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
    };
  }

  private writeState(state: WorkflowRuntimeState): void {
    ensureDir(this.rootDir);
    writeJsonFile(this.statePath, state);
  }

  recoverInterruptedRuns(): WorkflowRunMetadata[] {
    const state = this.readState();

    const candidates: Array<{ runId: string; workflow: string }> =
      (state.activeRuns ?? []).map((r) => ({ runId: r.runId, workflow: r.workflow }));

    const recovered: WorkflowRunMetadata[] = [];

    for (const { runId } of candidates) {
      const metadataPath = join(this.runsDir, runId, "metadata.json");
      const metadata = readOptionalJsonFile<unknown>(metadataPath);
      if (metadata !== null) {
        assertWorkflowRunMetadata(metadataPath, metadata);
      }
      if (!metadata || metadata.status !== "running") continue;

      const interrupted: WorkflowRunMetadata = {
        ...metadata,
        status: "interrupted",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(metadata.startedAt).getTime(),
      };

      writeJsonFile(metadataPath, interrupted);
      state.workflows[metadata.workflow] = {
        ...state.workflows[metadata.workflow],
        lastRunId: metadata.id,
        lastStartedAt: metadata.startedAt,
        lastCompletedAt: interrupted.completedAt,
        lastStatus: "interrupted",
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
  }): string[] {
    const retentionDays = opts?.retentionDays ?? 7;
    const minKeepPerWorkflow = opts?.minKeepPerWorkflow ?? 10;
    const dryRun = opts?.dryRun ?? false;

    let dirs: string[];
    try {
      dirs = readdirSync(this.runsDir);
    } catch {
      return [];
    }

    const state = this.readState();
    const protectedIds = new Set<string>();
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
        try {
          rmSync(join(this.runsDir, id), { recursive: true, force: true });
        } catch {
          // pruning errors must not crash callers
        }
      }
    }

    return toDelete;
  }

  getDailySpendUsd(): number {
    const todayUtc = new Date().toISOString().slice(0, 10);
    let dirs: string[];
    try {
      dirs = readdirSync(this.runsDir);
    } catch {
      return 0;
    }
    let total = 0;
    for (const dir of dirs) {
      const meta = readOptionalJsonFile<WorkflowRunMetadata>(join(this.runsDir, dir, "metadata.json"));
      if (meta?.completedAt && typeof meta.totalCostUsd === "number") {
        if (meta.completedAt.slice(0, 10) === todayUtc) total += meta.totalCostUsd;
      }
    }
    return total;
  }

  createRun(
    workflow: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): ActiveWorkflowRunHandle {
    const state = this.readState();
    const id = formatRunId(workflow.name);
    const runDirPath = join(this.runsDir, id);
    ensureDir(runDirPath);
    ensureDir(join(runDirPath, "steps"));

    const triggeredByRunId =
      typeof trigger.payload.runId === "string" ? trigger.payload.runId : undefined;
    const retryOf =
      typeof trigger.payload.retryOf === "string" ? trigger.payload.retryOf : undefined;

    const metadata: WorkflowRunMetadata = {
      id,
      workflow: workflow.name,
      definitionPath: workflow.definitionPath,
      trigger,
      ...(triggeredByRunId !== undefined && { triggeredByRunId }),
      ...(retryOf !== undefined && { retryOf }),
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
      lastRunId: id,
      lastStartedAt: metadata.startedAt,
    };
    this.writeState(state);

    const persistMetadata = () => {
      writeJsonFile(join(runDirPath, "metadata.json"), metadata);
    };

    return {
      metadata,
      appendAgentMessage: (stepId, message) => {
        appendFileSync(
          join(runDirPath, "steps", `${stepId}.events.jsonl`),
          `${safeJsonStringify(message)}\n`,
          "utf-8",
        );
      },
      writeAgentInputs: (stepId, systemPromptAppend, prompt) => {
        const parts = [
          "# System Prompt Appendix",
          "",
          systemPromptAppend || "(none)",
          "",
          "# User Prompt",
          "",
          prompt,
          "",
        ];
        writeFileSync(
          join(runDirPath, "steps", `${stepId}.input.md`),
          parts.join("\n"),
          "utf-8",
        );
      },
      recordStep: (result) => {
        const existingIndex = metadata.steps.findIndex(
          (step) => step.id === result.id,
        );
        if (existingIndex >= 0) metadata.steps[existingIndex] = result;
        else metadata.steps.push(result);
        writeJsonFile(join(runDirPath, "steps", `${result.id}.json`), result);
        persistMetadata();
      },
      finish: (update) => {
        const currentState = this.readState();
        const totalCostUsd = metadata.steps
          .filter((s) => s.type === "agent")
          .reduce((sum, s) => {
            if (s.output && typeof s.output === "object" && !Array.isArray(s.output)) {
              const cost = (s.output as Record<string, unknown>).totalCostUsd;
              if (typeof cost === "number") return sum + cost;
            }
            return sum;
          }, 0);
        const completed: WorkflowRunMetadata = {
          ...metadata,
          status: update.status,
          completedAt: new Date().toISOString(),
          durationMs: update.durationMs,
          totalCostUsd,
        };
        if (update.error) {
          writeFileSync(join(runDirPath, "error.txt"), update.error, "utf-8");
        }

        writeJsonFile(join(runDirPath, "metadata.json"), completed);

        currentState.completedRuns += 1;
        currentState.totalCostUsd = (currentState.totalCostUsd ?? 0) + totalCostUsd;
        currentState.workflows[workflow.name] = {
          ...currentState.workflows[workflow.name],
          lastRunId: id,
          lastStartedAt: metadata.startedAt,
          lastCompletedAt: completed.completedAt,
          lastStatus: update.status,
        };
        currentState.activeRuns = (currentState.activeRuns ?? []).filter(
          (r) => r.runId !== id,
        );
        this.writeState(currentState);

        return completed;
      },
    };
  }
}
