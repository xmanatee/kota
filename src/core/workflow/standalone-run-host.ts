import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import {
  createProjectRuntime,
  type ProjectRuntime,
} from "#core/daemon/project-runtime.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import type { ConfiguredProject } from "#core/daemon/scope-registry.js";
import type { EventBus } from "#core/events/event-bus.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { resolveWorkflowConcurrency } from "./concurrency.js";
import type { WorkflowEnqueueOptions } from "./operator-trigger.js";
import type { RunContext } from "./run-context.js";
import { RunCoordinator, type RunExecutionOutcome } from "./run-coordinator.js";
import { executeWorkflowRun } from "./run-executor.js";
import {
  continueRunIntegration,
  validateRunIntegration,
  verifyRunPostReconcileInvariant,
} from "./run-integration-policy.js";
import { formatChildRunId } from "./run-io.js";
import {
  RunLifecycle,
  type WorkflowExecutionOutcome,
} from "./run-lifecycle.js";
import { RunStateDatabase, type StoredRun } from "./run-state-database.js";
import type { WorkflowRunMetadata, WorkflowRunToolRunner } from "./run-types.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinition } from "./types.js";

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

export type StandaloneRunExecutionOptions = Readonly<{
  runTool?: WorkflowRunToolRunner;
  createAgentCanUseTool?: (stepId: string) => AgentCanUseTool;
}>;

export type StandaloneRunResult = Readonly<{
  run: StoredRun;
  metadata: WorkflowRunMetadata | null;
}>;

export type StandaloneNestedRun = Readonly<{
  workflow: string;
  runId: string;
  waitFor: "queued" | "completed";
  payload: Readonly<Record<string, unknown>>;
  status: "queued" | "completed" | "failed";
}>;

export type StandaloneRunHostOptions = Readonly<{
  stateDir: string;
  project: ConfiguredProject;
  bus: EventBus;
  workflows: readonly RegisteredWorkflowDefinitionInput[];
  config?: KotaConfig;
  model?: string;
  concurrency?: number;
  authorityConfigPath?: string;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  execution?: (
    context: RunContext,
  ) => StandaloneRunExecutionOptions;
  onLog?: (message: string) => void;
}>;

/**
 * A process-local host for daemonless commands. It owns the same durable
 * admission, coordinator, sandbox, resource, and integration lifecycle as the
 * daemon; only trigger registration and daemon control transport are absent.
 */
export class StandaloneRunHost {
  readonly state: RunStateDatabase;
  readonly coordinator: RunCoordinator;
  readonly projectRuntime: ProjectRuntime;

  private readonly epoch: number;
  private readonly lifecycle: RunLifecycle;
  private readonly definitions: readonly WorkflowDefinition[];
  private readonly onLog: (message: string) => void;
  private readonly nestedRuns = new Map<string, StandaloneNestedRun>();
  private readonly ownsProviderRegistry: boolean;
  private started = false;
  private closed = false;

  constructor(private readonly options: StandaloneRunHostOptions) {
    this.onLog = options.onLog ?? (() => undefined);
    this.state = new RunStateDatabase(options.stateDir);
    const now = new Date().toISOString();
    this.state.registerProject({
      id: options.project.projectId,
      rootPath: options.project.projectDir,
      displayName: options.project.displayName,
      createdAt: now,
    });
    const session = this.state.beginDaemonSession(now);
    if (session.recovered.length > 0) {
      this.state.close();
      throw new Error("Standalone run state must not contain interrupted attempts");
    }
    this.epoch = session.epoch;

    this.lifecycle = new RunLifecycle({
      store: this.state,
      daemonEpoch: this.epoch,
      executeWorkflow: (context, run) => this.executeWorkflow(context, run),
      validate: (context, input) => {
        const definition = this.definition(context.workflow);
        if (!definition.integration) {
          throw new Error(`Writer workflow "${context.workflow}" has no integration policy`);
        }
        return validateRunIntegration(context, definition.integration, input);
      },
      verifyPostReconcile: (context, input) => {
        const definition = this.definition(context.workflow);
        if (!definition.integration) {
          throw new Error(`Writer workflow "${context.workflow}" has no integration policy`);
        }
        return verifyRunPostReconcileInvariant(
          context,
          definition.integration,
          this.projectRuntime.runStore.rootDir,
          input,
        );
      },
      continueIntegration: (context, issue) =>
        continueRunIntegration(
          context,
          issue,
          options.config,
          options.authorityConfigPath,
        ),
    });
    this.coordinator = new RunCoordinator({
      store: this.state,
      daemonEpoch: this.epoch,
      concurrency:
        options.concurrency ?? resolveWorkflowConcurrency(options.config?.scheduler),
      execute: (run, signal) => this.executeRun(run, signal),
      deliverPublication: (publication) =>
        this.projectRuntime.workflowRuntime.deliverPublication(publication),
      onError: (error, run) =>
        this.onLog(
          `Standalone run "${run.id}" failed in coordinator: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    });
    this.coordinator.pauseProjectAdmission(options.project.projectId);
    this.ownsProviderRegistry = getProviderRegistry() === null;
    const registry = getProviderRegistry() ?? initProviderRegistry();

    // Standalone commands admit only explicit work. Definition triggers are
    // intentionally disabled so schedules and file watchers cannot add work.
    const explicitWorkflows = options.workflows.map((workflow) => ({
      ...workflow,
      triggers: [{ event: "manual", cooldownMs: 0 }],
    }));
    let createdRuntime: ProjectRuntime | undefined;
    try {
      createdRuntime = createProjectRuntime({
        project: options.project,
        bus: options.bus,
        config: options.config,
        workflows: explicitWorkflows,
        model: options.model,
        authorityConfigPath: options.authorityConfigPath,
        resolveAgentDef: options.resolveAgentDef,
        resolveSkillsPrompt: options.resolveSkillsPrompt,
        onLog: this.onLog,
        installSingletons: false,
        runState: this.state,
        runCoordinator: this.coordinator,
        daemonEpoch: this.epoch,
      });
      this.projectRuntime = createdRuntime;
      this.projectRuntime.workflowRuntime.start("paused");
      this.definitions = this.projectRuntime.workflowRuntime.getDefinitions();
      registry.register(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE, "daemon", {
        resolve: (projectId) => projectId === options.project.projectId
          ? { ok: true, runtime: this.projectRuntime }
          : { ok: false, projectId },
      });
    } catch (error) {
      void createdRuntime?.workflowRuntime.stop(0);
      this.state.close();
      if (this.ownsProviderRegistry) resetProviderRegistry();
      throw error;
    }
  }

  enqueue(
    workflowName: string,
    options: WorkflowEnqueueOptions = {},
  ): string {
    this.assertOpen();
    const result = this.projectRuntime.workflowRuntime.enqueuePendingRun(
      workflowName,
      options,
    );
    if (!result.ok || !result.runId) {
      throw new Error(
        result.error ??
          (result.alreadyQueued
            ? `Workflow "${workflowName}" is already queued`
            : `Workflow "${workflowName}" was not admitted`),
      );
    }
    return result.runId;
  }

  async runToTerminal(
    workflowName: string,
    options: WorkflowEnqueueOptions = {},
    signal?: AbortSignal,
  ): Promise<StandaloneRunResult> {
    const runId = this.enqueue(workflowName, options);
    this.startDispatch();
    return this.waitForTerminal(runId, signal);
  }

  async waitForTerminal(
    runId: string,
    signal?: AbortSignal,
  ): Promise<StandaloneRunResult> {
    this.assertOpen();
    this.startDispatch();
    while (true) {
      if (signal?.aborted) {
        this.coordinator.cancel(runId);
        signal.throwIfAborted();
      }
      const run = this.state.getRun(runId);
      if (!run) {
        if (this.projectRuntime.workflowRuntime
          .getState()
          .pendingRuns.some((pending) => pending.runId === runId)) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          continue;
        }
        throw new Error(`Unknown standalone run "${runId}"`);
      }
      if (TERMINAL_STATES.has(run.state)) {
        return {
          run,
          metadata: this.projectRuntime.runStore.getRun(runId),
        };
      }
      if (run.state === "needs_attention") {
        throw new Error(
          `Standalone run "${runId}" needs attention${
            run.lastError ? `: ${run.lastError}` : ""
          }`,
        );
      }
      if (run.state === "waiting" && this.coordinator.activeCount === 0) {
        throw new Error(`Standalone run "${runId}" suspended before terminal completion`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  listRuns(): StoredRun[] {
    return this.state.listRuns(this.options.project.projectId);
  }

  listNestedRuns(): StandaloneNestedRun[] {
    return [...this.nestedRuns.values()];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (
      !this.started &&
      this.state.listRuns(this.options.project.projectId, ["queued"]).length > 0
    ) {
      this.startDispatch();
    }
    if (this.started) await this.coordinator.whenIdle();
    this.coordinator.pauseProjectAdmission(this.options.project.projectId);
    await this.coordinator.drainPublications();
    const pendingPublications = this.state.listPendingPublications();
    if (pendingPublications.length > 0) {
      throw new Error(
        `Standalone run host cannot close with ${pendingPublications.length} undelivered publication(s)`,
      );
    }
    await this.projectRuntime.workflowRuntime.stop(0);
    await this.coordinator.dispose();
    this.state.close();
    if (this.ownsProviderRegistry) resetProviderRegistry();
    this.closed = true;
  }

  private startDispatch(): void {
    if (this.started) return;
    this.started = true;
    this.projectRuntime.workflowRuntime.setDispatchPaused(false);
  }

  private definition(name: string): WorkflowDefinition {
    const definition = this.definitions.find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`Workflow definition "${name}" is not loaded`);
    return definition;
  }

  private async executeWorkflow(
    context: RunContext,
    run: StoredRun,
  ): Promise<WorkflowExecutionOutcome> {
    const definition = this.definition(run.workflow);
    const execution = this.options.execution?.(context);
    const abortController = new AbortController();
    const forwardAbort = () => abortController.abort(context.signal.reason);
    if (context.signal.aborted) forwardAbort();
    else context.signal.addEventListener("abort", forwardAbort, { once: true });
    const { promise } = executeWorkflowRun(definition, run.trigger, {
      runContext: context,
      authorityConfigPath: this.options.authorityConfigPath,
      bus: this.options.bus,
      pbus: this.projectRuntime.pbus,
      store: this.projectRuntime.runStore,
      deadLetterQueue: this.projectRuntime.deadLetterQueue,
      approvalQueue: this.projectRuntime.approvalQueue,
      idempotencyStore: this.projectRuntime.idempotencyStore,
      model: this.options.model,
      config: this.options.config,
      log: this.onLog,
      triggerWorkflow: (workflowName, payload, waitFor, signal, triggerId) =>
        this.triggerWorkflow(
          context.run.id,
          workflowName,
          payload,
          waitFor,
          signal,
          triggerId,
        ),
      resolveAgentDef: this.options.resolveAgentDef,
      resolveSkillsPrompt: this.options.resolveSkillsPrompt,
      scopePolicyAuthority: this.projectRuntime.scopePolicyAuthority,
      runTool: execution?.runTool,
      createAgentCanUseTool: execution?.createAgentCanUseTool,
    }, abortController);
    try {
      const result = await promise;
      const successful =
        result.metadata.status === "success" ||
        result.metadata.status === "completed-with-warnings";
      if (successful) return { kind: "completed" };
      const error = [...result.metadata.steps]
        .reverse()
        .find((step) => step.error)?.error;
      return {
        kind: "terminal",
        state: context.signal.aborted ? "cancelled" : "failed",
        ...(error ? { error } : {}),
      };
    } finally {
      context.signal.removeEventListener("abort", forwardAbort);
    }
  }

  private async executeRun(
    run: StoredRun,
    signal: AbortSignal,
  ): Promise<RunExecutionOutcome> {
    const outcome = await this.lifecycle.execute(run, signal);
    return outcome.kind === "terminal"
      ? this.projectRuntime.workflowRuntime.finalizeTerminalOutcome(run, outcome)
      : outcome;
  }

  private async triggerWorkflow(
    parentRunId: string,
    workflowName: string,
    payload: Record<string, unknown>,
    waitFor: "queued" | "completed",
    signal?: AbortSignal,
    triggerId?: string,
  ): Promise<{
    runId: string;
    status: "queued" | "completed" | "failed";
    childOutput?: unknown;
  }> {
    if (!triggerId) throw new Error("Child workflow trigger identity is required");
    const runId = this.enqueue(workflowName, {
      event: "workflow.triggered",
      payload: {
        ...payload,
        _runId: formatChildRunId(parentRunId, triggerId, workflowName),
        triggeredByRunId: parentRunId,
      },
    });
    this.nestedRuns.set(runId, {
      workflow: workflowName,
      runId,
      waitFor,
      payload: structuredClone(payload),
      status: "queued",
    });
    if (waitFor === "queued") return { runId, status: "queued" };
    let child: StoredRun;
    try {
      child = await this.coordinator.waitForChild(
        parentRunId,
        runId,
        signal ?? new AbortController().signal,
      );
    } catch (error) {
      this.nestedRuns.set(runId, {
        workflow: workflowName,
        runId,
        waitFor,
        payload: structuredClone(payload),
        status: "failed",
      });
      throw error;
    }
    const successful = child.state === "succeeded";
    const childOutput = this.projectRuntime.runStore.getRun(runId)?.steps
      .slice()
      .reverse()
      .find((step) => step.status === "success")?.output;
    const result = {
      runId,
      status: successful ? "completed" : "failed",
      ...(childOutput !== undefined ? { childOutput } : {}),
    } as const;
    this.nestedRuns.set(runId, {
      workflow: workflowName,
      runId,
      waitFor,
      payload: structuredClone(payload),
      status: result.status,
    });
    return result;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Standalone run host is closed");
  }
}
