import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { SDKMessage } from "../agent-sdk/types.js";
import {
  JsonFileError,
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "../json-file.js";
import type {
  WorkflowDefinition,
  WorkflowQueuedRun,
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
  WorkflowStep,
  WorkflowStepResult,
} from "./types.js";

const STATE_FILE = "workflow-state.json";

type FinishUpdate = {
  status: WorkflowRunStatus;
  durationMs: number;
  error?: string;
};

type WorkflowSnapshot = {
  name: string;
  description?: string;
  enabled: boolean;
  definitionPath: string;
  triggers: WorkflowDefinition["triggers"];
  steps: Array<Record<string, unknown>>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return value === "success" || value === "failed" || value === "interrupted";
}

function isWorkflowRunTrigger(value: unknown): value is WorkflowRunTrigger {
  return (
    isPlainObject(value) &&
    typeof value.event === "string" &&
    isPlainObject(value.payload)
  );
}

function isQueuedRun(value: unknown): value is WorkflowQueuedRun {
  return (
    isPlainObject(value) &&
    typeof value.workflowName === "string" &&
    isWorkflowRunTrigger(value.trigger) &&
    Number.isFinite(value.enqueuedAtMs) &&
    Number.isFinite(value.notBeforeMs)
  );
}

function assertWorkflowRuntimeState(
  path: string,
  value: unknown,
): asserts value is WorkflowRuntimeState {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid workflow state shape");
  }
  const completedRuns = value.completedRuns;
  if (
    typeof completedRuns !== "number" ||
    !Number.isInteger(completedRuns) ||
    completedRuns < 0
  ) {
    throw new JsonFileError(
      path,
      "parse",
      "workflow state missing completedRuns",
    );
  }
  if (
    !Array.isArray(value.pendingRuns) ||
    value.pendingRuns.some((item) => !isQueuedRun(item))
  ) {
    throw new JsonFileError(path, "parse", "workflow state has invalid pendingRuns");
  }
  if (!isPlainObject(value.workflows)) {
    throw new JsonFileError(path, "parse", "workflow state has invalid workflows");
  }
  for (const [workflowName, entry] of Object.entries(value.workflows)) {
    if (!isPlainObject(entry)) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" is invalid`,
      );
    }
    for (const key of ["lastRunId", "lastStartedAt", "lastCompletedAt"] as const) {
      const current = entry[key];
      if (
        current !== undefined &&
        (typeof current !== "string" || !current.trim())
      ) {
        throw new JsonFileError(
          path,
          "parse",
          `workflow state entry "${workflowName}" has invalid ${key}`,
        );
      }
    }
    if (
      entry.lastStatus !== undefined &&
      !isWorkflowRunStatus(entry.lastStatus)
    ) {
      throw new JsonFileError(
        path,
        "parse",
        `workflow state entry "${workflowName}" has invalid lastStatus`,
      );
    }
  }
  for (const key of ["activeRunId", "activeWorkflow", "activeStartedAt"] as const) {
    const current = value[key];
    if (current !== undefined && (typeof current !== "string" || !current.trim())) {
      throw new JsonFileError(path, "parse", `workflow state has invalid ${key}`);
    }
  }
}

function assertWorkflowRunMetadata(
  path: string,
  value: unknown,
): asserts value is WorkflowRunMetadata {
  if (!isPlainObject(value)) {
    throw new JsonFileError(path, "parse", "invalid workflow run metadata shape");
  }
  if (
    typeof value.id !== "string" ||
    typeof value.workflow !== "string" ||
    typeof value.definitionPath !== "string" ||
    !isWorkflowRunTrigger(value.trigger) ||
    typeof value.startedAt !== "string" ||
    typeof value.runDir !== "string" ||
    !Array.isArray(value.steps)
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata is incomplete");
  }
  if (
    value.status !== "running" &&
    !isWorkflowRunStatus(value.status)
  ) {
    throw new JsonFileError(path, "parse", "workflow run metadata has invalid status");
  }
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function safeJsonStringify(value: unknown, indent?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_, current) => {
      if (typeof current === "bigint") return current.toString();
      if (typeof current === "function") {
        return `[Function ${current.name || "anonymous"}]`;
      }
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
        };
      }
      if (current instanceof Map) {
        return Object.fromEntries(current);
      }
      if (current instanceof Set) {
        return Array.from(current);
      }
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[Circular]";
        seen.add(current);
      }
      return current;
    },
    indent,
  );
}

function writeJsonFile(path: string, value: unknown): void {
  writeJsonFileAtomic(path, value, (current) => safeJsonStringify(current, 2));
}

function formatRunId(workflowName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${workflowName}-${suffix}`;
}

function buildWorkflowSnapshot(workflow: WorkflowDefinition): WorkflowSnapshot {
  const steps = workflow.steps.map((step) => summarizeStep(step));
  return {
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    definitionPath: workflow.definitionPath,
    triggers: workflow.triggers,
    steps,
  };
}

function summarizeStep(step: WorkflowStep): Record<string, unknown> {
  if (step.type === "tool") {
    return {
      id: step.id,
      type: step.type,
      tool: step.tool,
    };
  }
  if (step.type === "agent") {
    return {
      id: step.id,
      type: step.type,
      promptPath: step.promptPath,
      model: step.model,
      maxTurns: step.maxTurns,
      maxBudgetUsd: step.maxBudgetUsd,
      permissionMode: step.permissionMode,
      allowedTools: step.allowedTools,
      disallowedTools: step.disallowedTools,
      settingSources: step.settingSources,
    };
  }
  if (step.type === "emit") {
    return {
      id: step.id,
      type: step.type,
      event: step.event,
    };
  }
  if (step.type === "restart") {
    return {
      id: step.id,
      type: step.type,
      requires: step.requires,
    };
  }
  return {
    id: step.id,
    type: step.type,
  };
}

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
        const completed: WorkflowRunMetadata = {
          ...metadata,
          status: update.status,
          completedAt: new Date().toISOString(),
          durationMs: update.durationMs,
        };
        if (update.error) {
          writeFileSync(join(runDirPath, "error.txt"), update.error, "utf-8");
        }

        writeJsonFile(join(runDirPath, "metadata.json"), completed);

        currentState.completedRuns += 1;
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
