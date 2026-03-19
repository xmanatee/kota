import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KotaConfig } from "../config.js";
import type { BusEnvelope, BusEvents, EventBus } from "../event-bus.js";
import { executeTool } from "../tools/index.js";
import {
  buildStepCompletedPayload,
  buildStepStartedPayload,
  buildWorkflowCompletedPayload,
} from "./event-payloads.js";
import { getBuiltinWorkflowDefinitions } from "./registry.js";
import { WorkflowRunStore } from "./run-store.js";
import {
  type AgentStepConfig,
  executeStep,
  shouldRunStep,
} from "./step-executor.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowFilterValue,
  WorkflowQueuedRun,
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
  WorkflowStep,
  WorkflowStepContext,
  WorkflowStepResult,
} from "./types.js";
import {
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "./validation.js";

const DEFAULT_IDLE_INTERVAL_MS = 30_000;

export type WorkflowRuntimeConfig = {
  bus: EventBus;
  projectDir?: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  idleIntervalMs?: number;
  onLog?: (message: string) => void;
  workflows?: readonly RegisteredWorkflowDefinitionInput[];
};

export class WorkflowRuntime {
  private readonly projectDir: string;
  private readonly store: WorkflowRunStore;
  private readonly idleIntervalMs: number;
  private readonly model?: string;
  private readonly config?: KotaConfig;
  private readonly verbose: boolean;
  private readonly onLog?: (message: string) => void;
  private readonly workflowInputs?: readonly RegisteredWorkflowDefinitionInput[];

  private definitions: WorkflowDefinition[] = [];
  private queue: WorkflowQueuedRun[] = [];
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private stopBus: (() => void) | null = null;
  private activeWorkflowName: string | null = null;
  private activeAbortController: AbortController | null = null;
  private activeRunPromise: Promise<void> | null = null;
  private dispatchPaused = false;
  private stopping = false;

  constructor(private readonly runtimeConfig: WorkflowRuntimeConfig) {
    this.projectDir = runtimeConfig.projectDir ?? process.cwd();
    this.store = new WorkflowRunStore(this.projectDir);
    this.idleIntervalMs =
      runtimeConfig.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS;
    this.model = runtimeConfig.model;
    this.config = runtimeConfig.config;
    this.verbose = runtimeConfig.verbose ?? false;
    this.onLog = runtimeConfig.onLog;
    this.workflowInputs = runtimeConfig.workflows;
  }

  start(): void {
    if (this.stopBus || this.idleTimer) return;
    this.stopping = false;
    this.dispatchPaused = false;

    const interrupted = this.store.recoverInterruptedRun();
    if (interrupted) {
      this.log(
        `Recovered interrupted workflow run ${interrupted.id} for "${interrupted.workflow}"`,
      );
    }

    this.definitions = this.loadDefinitions();
    this.restorePendingQueue();

    this.stopBus = this.runtimeConfig.bus.on("*", (envelope) => {
      this.handleEvent(envelope);
    });

    this.maybeStartNext();

    this.idleTimer = setInterval(() => {
      this.emitIdleEvent();
    }, this.idleIntervalMs);
    this.idleTimer.unref();

    this.emitIdleEvent();
  }

  async stop(timeoutMs = 30_000): Promise<void> {
    this.stopping = true;

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.stopBus) {
      this.stopBus();
      this.stopBus = null;
    }

    if (!this.activeRunPromise) return;

    this.activeAbortController?.abort();
    const abortTimer = setTimeout(() => {
      this.activeAbortController?.abort();
    }, timeoutMs);
    abortTimer.unref();

    try {
      await this.activeRunPromise;
    } finally {
      clearTimeout(abortTimer);
    }
  }

  isBusy(): boolean {
    return this.activeRunPromise !== null;
  }

  setDispatchPaused(paused: boolean): void {
    this.dispatchPaused = paused;
    if (!paused) this.maybeStartNext();
  }

  getDefinitionCount(): number {
    return this.definitions.length;
  }

  getState(): WorkflowRuntimeState & { queueLength: number } {
    const state = this.store.readState();
    return {
      ...state,
      queueLength: this.queue.length,
    };
  }

  private loadDefinitions(): WorkflowDefinition[] {
    const definitions = this.workflowInputs ?? getBuiltinWorkflowDefinitions();
    return validateWorkflowDefinitions(definitions, this.projectDir);
  }

  private emitIdleEvent(): void {
    if (this.stopping || this.activeRunPromise || this.queue.length > 0) return;
    this.runtimeConfig.bus.emit("runtime.idle", {
      timestamp: new Date().toISOString(),
      idleIntervalMs: this.idleIntervalMs,
    });
  }

  private handleEvent(envelope: BusEnvelope): void {
    if (this.stopping) return;

    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      for (const trigger of definition.triggers) {
        if (trigger.event !== envelope.type) continue;
        if (!this.matchesFilter(trigger.filter, envelope.payload)) continue;
        this.enqueueRun(definition, trigger, {
          event: envelope.type,
          payload: envelope.payload,
        });
      }
    }

    this.maybeStartNext();
  }

  private restorePendingQueue(): void {
    const state = this.store.readState();
    const validNames = new Set(
      this.definitions
        .filter((definition) => definition.enabled)
        .map((definition) => definition.name),
    );
    this.queue = state.pendingRuns.filter((item) => validNames.has(item.workflowName));
    this.persistQueue();
    if (this.queue.length > 0) {
      this.log(`Recovered ${this.queue.length} queued workflow run(s)`);
    }
  }

  private persistQueue(): void {
    this.store.setPendingRuns(this.queue);
  }

  private enqueueRun(
    definition: WorkflowDefinition,
    triggerConfig: WorkflowDefinition["triggers"][number],
    trigger: WorkflowRunTrigger,
  ): void {
    const existingIndex = this.queue.findIndex(
      (queued) => queued.workflowName === definition.name,
    );
    const queuedRun: WorkflowQueuedRun = {
      workflowName: definition.name,
      trigger,
      enqueuedAtMs:
        existingIndex >= 0
          ? this.queue[existingIndex].enqueuedAtMs
          : Date.now(),
      notBeforeMs: this.getEligibleAtMs(definition.name, triggerConfig.cooldownMs),
    };

    if (existingIndex >= 0) {
      this.queue[existingIndex] = {
        ...queuedRun,
        notBeforeMs: Math.max(
          this.queue[existingIndex].notBeforeMs,
          queuedRun.notBeforeMs,
        ),
      };
      this.log(
        `Updated queued workflow "${definition.name}" with event "${trigger.event}"`,
      );
      this.persistQueue();
      return;
    }

    this.queue.push(queuedRun);
    this.persistQueue();
    this.log(
      `${this.activeWorkflowName === definition.name ? "Queued rerun for" : "Queued"} workflow "${definition.name}" from event "${trigger.event}"`,
    );
  }

  private maybeStartNext(): void {
    if (this.stopping || this.activeRunPromise || this.dispatchPaused) return;

    const queued = this.pickQueuedRun();
    if (!queued) return;

    const definition = this.getDefinition(queued.workflowName);
    if (!definition) return;

    this.log(`Dispatching workflow "${queued.workflowName}"`);
    void this.runWorkflow(definition, queued.trigger);
  }

  private pickQueuedRun(): WorkflowQueuedRun | null {
    const now = Date.now();
    const eligible = this.queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.notBeforeMs <= now)
      .sort((a, b) => a.item.enqueuedAtMs - b.item.enqueuedAtMs);

    if (eligible.length === 0) return null;
    const picked = eligible[0];
    this.queue.splice(picked.index, 1);
    this.persistQueue();
    return picked.item;
  }

  private getDefinition(name: string): WorkflowDefinition | undefined {
    return this.definitions.find((definition) => definition.name === name);
  }

  private getEligibleAtMs(
    workflowName: string,
    cooldownMs: number,
    state = this.store.readState(),
  ): number {
    const lastCompletedAt = state.workflows[workflowName]?.lastCompletedAt;
    if (!lastCompletedAt || cooldownMs <= 0) return Date.now();
    return new Date(lastCompletedAt).getTime() + cooldownMs;
  }

  private matchesFilter(
    filter: Record<string, WorkflowFilterValue> | undefined,
    payload: Record<string, unknown>,
  ): boolean {
    if (!filter) return true;
    for (const [key, expected] of Object.entries(filter)) {
      const actual = payload[key];
      if (Array.isArray(expected)) {
        if (!expected.includes(actual as string | number | boolean)) return false;
        continue;
      }
      if (actual !== expected) return false;
    }
    return true;
  }

  private createStepContext(
    metadata: WorkflowRunMetadata,
    trigger: WorkflowRunTrigger,
    previousOutput: unknown,
    stepOutputs: Record<string, unknown>,
    stepResults: Record<string, WorkflowStepResult>,
    stepOutputList: unknown[],
  ): WorkflowStepContext {
    const runDirPath = resolve(this.projectDir, metadata.runDir);
    return {
      projectDir: this.projectDir,
      workflow: {
        name: metadata.workflow,
        definitionPath: metadata.definitionPath,
        runId: metadata.id,
        runDir: metadata.runDir,
        runDirPath,
      },
      trigger,
      previousOutput,
      stepOutputs,
      stepResults,
      stepOutputList,
      runTool: async (name, input) => {
        const result = await executeTool(name, input);
        if (result.is_error) {
          throw new Error(result.content);
        }
        return result;
      },
      emit: (event, payload) => {
        this.runtimeConfig.bus.emit(event, payload);
      },
      requestRestart: (reason) => {
        this.runtimeConfig.bus.emit("runtime.restart_requested", {
          reason,
          workflow: metadata.workflow,
          runId: metadata.id,
        });
      },
      readPrompt: (promptPath) => {
        return readFileSync(resolve(this.projectDir, promptPath), "utf-8");
      },
      readRuntimeState: () => this.store.readState(),
    };
  }

  private logStepStarted(definition: WorkflowDefinition, step: WorkflowStep): void {
    this.log(
      `Starting step "${step.id}" (${step.type}) in workflow "${definition.name}"`,
    );
  }

  private logStepCompleted(
    definition: WorkflowDefinition,
    result: WorkflowStepResult,
  ): void {
    const details: string[] = [`${result.durationMs}ms`];
    if (result.type === "agent" && result.output && typeof result.output === "object") {
      const output = result.output as {
        turns?: unknown;
        totalCostUsd?: unknown;
        subtype?: unknown;
      };
      if (typeof output.turns === "number") details.push(`${output.turns} turn(s)`);
      if (typeof output.totalCostUsd === "number") {
        details.push(`$${output.totalCostUsd.toFixed(2)}`);
      }
      if (typeof output.subtype === "string" && output.subtype) {
        details.push(output.subtype);
      }
    }
    this.log(
      `Completed step "${result.id}" (${result.type}) in workflow "${definition.name}" [${details.join(", ")}]`,
    );
  }

  private logStepFailed(
    definition: WorkflowDefinition,
    result: WorkflowStepResult,
  ): void {
    this.log(
      `Failed step "${result.id}" (${result.type}) in workflow "${definition.name}": ${result.error ?? "unknown error"}`,
    );
  }

  private async runWorkflow(
    definition: WorkflowDefinition,
    trigger: WorkflowRunTrigger,
  ): Promise<void> {
    const run = this.store.createRun(definition, trigger);
    const startedAt = Date.now();
    const abortController = new AbortController();

    this.activeWorkflowName = definition.name;
    this.activeAbortController = abortController;

    const startedPayload: BusEvents["workflow.started"] = {
      workflow: definition.name,
      runId: run.metadata.id,
      triggerEvent: trigger.event,
      definitionPath: run.metadata.definitionPath,
      runDir: run.metadata.runDir,
      startedAt: run.metadata.startedAt,
    };

    const runPromise = (async () => {
      this.runtimeConfig.bus.emit("workflow.started", startedPayload);
      this.log(`Starting workflow "${definition.name}" (${run.metadata.id})`);

      const stepOutputsById: Record<string, unknown> = {};
      const stepResultsById: Record<string, WorkflowStepResult> = {};
      const stepOutputs: unknown[] = [];
      let previousOutput: unknown = null;

      try {
        for (const step of definition.steps) {
          const context = this.createStepContext(
            run.metadata,
            trigger,
            previousOutput,
            stepOutputsById,
            stepResultsById,
            stepOutputs,
          );
          const stepStartedAt = Date.now();

          const agentConfig: AgentStepConfig = {
            model: this.model,
            config: this.config,
            projectDir: this.projectDir,
          };

          if (!(await shouldRunStep(step, context))) {
            const skipped: WorkflowStepResult = {
              id: step.id,
              type: step.type,
              status: "skipped",
              startedAt: new Date(stepStartedAt).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStartedAt,
            };
            run.recordStep(skipped);
            stepOutputsById[step.id] = { skipped: true };
            stepResultsById[step.id] = skipped;
            stepOutputs.push({ skipped: true });
            this.runtimeConfig.bus.emit(
              "workflow.step.completed",
              buildStepCompletedPayload(run.metadata, skipped),
            );
            continue;
          }

          this.runtimeConfig.bus.emit(
            "workflow.step.started",
            buildStepStartedPayload(run.metadata, step),
          );
          this.logStepStarted(definition, step);
          try {
            const output = await executeStep(
              definition,
              step,
              run.metadata,
              trigger,
              context,
              abortController,
              (message) => run.appendAgentMessage(step.id, message),
              (systemPromptAppend, prompt) =>
                run.writeAgentInputs(step.id, systemPromptAppend, prompt),
              agentConfig,
            );

            const completed: WorkflowStepResult = {
              id: step.id,
              type: step.type,
              status: "success",
              startedAt: new Date(stepStartedAt).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStartedAt,
              output,
            };
            run.recordStep(completed);
            stepOutputsById[step.id] = output;
            stepResultsById[step.id] = completed;
            stepOutputs.push(output);
            previousOutput = output;

            this.runtimeConfig.bus.emit(
              "workflow.step.completed",
              buildStepCompletedPayload(run.metadata, completed),
            );
            this.logStepCompleted(definition, completed);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            const failed: WorkflowStepResult = {
              id: step.id,
              type: step.type,
              status: "failed",
              startedAt: new Date(stepStartedAt).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStartedAt,
              error: err.message,
            };
            run.recordStep(failed);
            stepResultsById[step.id] = failed;
            this.runtimeConfig.bus.emit(
              "workflow.step.completed",
              buildStepCompletedPayload(run.metadata, failed),
            );
            this.logStepFailed(definition, failed);
            throw err;
          }
        }

        const completed = run.finish({
          status: "success",
          durationMs: Date.now() - startedAt,
        });
        this.runtimeConfig.bus.emit(
          "workflow.completed",
          buildWorkflowCompletedPayload(completed, "success"),
        );
        this.log(`Completed workflow "${definition.name}" (${completed.id})`);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const status: WorkflowRunStatus =
          abortController.signal.aborted || err.name === "AbortError"
            ? "interrupted"
            : "failed";
        const completed = run.finish({
          status,
          durationMs: Date.now() - startedAt,
          error: err.message,
        });
        this.runtimeConfig.bus.emit(
          "workflow.completed",
          buildWorkflowCompletedPayload(completed, status),
        );
        this.log(
          `${status === "interrupted" ? "Interrupted" : "Failed"} workflow "${definition.name}" (${completed.id}): ${err.message}`,
        );
      } finally {
        this.activeWorkflowName = null;
        this.activeAbortController = null;
        this.activeRunPromise = null;
        this.maybeStartNext();
      }
    })();

    this.activeRunPromise = runPromise;
    await runPromise;
  }

  private log(message: string): void {
    if (!this.verbose && !this.onLog) return;
    this.onLog?.(message);
  }
}

export { WorkflowDefinitionError };
