import {
  appendFileSync,
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
      ...(state?.activeRunId ? { activeRunId: state.activeRunId } : {}),
      ...(state?.activeWorkflow ? { activeWorkflow: state.activeWorkflow } : {}),
      ...(state?.activeStartedAt ? { activeStartedAt: state.activeStartedAt } : {}),
      ...(state?.totalCostUsd != null ? { totalCostUsd: state.totalCostUsd } : {}),
    };
  }

  private writeState(state: WorkflowRuntimeState): void {
    ensureDir(this.rootDir);
    writeJsonFile(this.statePath, state);
  }

  recoverInterruptedRun(): WorkflowRunMetadata | null {
    const state = this.readState();
    if (!state.activeRunId || !state.activeWorkflow) return null;

    const metadataPath = join(this.runsDir, state.activeRunId, "metadata.json");
    const metadata = readOptionalJsonFile<unknown>(metadataPath);
    if (metadata !== null) {
      assertWorkflowRunMetadata(metadataPath, metadata);
    }
    if (!metadata || metadata.status !== "running") {
      delete state.activeRunId;
      delete state.activeWorkflow;
      delete state.activeStartedAt;
      this.writeState(state);
      return null;
    }

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
    delete state.activeRunId;
    delete state.activeWorkflow;
    delete state.activeStartedAt;
    this.writeState(state);
    return interrupted;
  }

  setPendingRuns(pendingRuns: WorkflowQueuedRun[]): void {
    const state = this.readState();
    state.pendingRuns = pendingRuns;
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

  createRun(
    workflow: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): ActiveWorkflowRunHandle {
    const state = this.readState();
    const id = formatRunId(workflow.name);
    const runDirPath = join(this.runsDir, id);
    ensureDir(runDirPath);
    ensureDir(join(runDirPath, "steps"));

    const metadata: WorkflowRunMetadata = {
      id,
      workflow: workflow.name,
      definitionPath: workflow.definitionPath,
      trigger,
      startedAt: new Date().toISOString(),
      status: "running",
      runDir: relative(this.projectDir, runDirPath),
      steps: [],
    };

    writeJsonFile(join(runDirPath, "workflow.json"), buildWorkflowSnapshot(workflow));
    writeJsonFile(join(runDirPath, "trigger.json"), trigger);
    writeJsonFile(join(runDirPath, "metadata.json"), metadata);

    state.activeRunId = id;
    state.activeWorkflow = workflow.name;
    state.activeStartedAt = metadata.startedAt;
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
        delete currentState.activeRunId;
        delete currentState.activeWorkflow;
        delete currentState.activeStartedAt;
        this.writeState(currentState);

        return completed;
      },
    };
  }
}
