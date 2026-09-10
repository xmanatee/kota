import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import {
  ApprovalQueue,
  isWorkflowGateApproval,
} from "#core/daemon/approval-queue.js";
import type {
  ScopePolicyAuthority,
  ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { EMITTED_EVENTS_LOG_FILENAME } from "#core/workflow/run-event-evidence.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { workflowUsesAgent } from "#core/workflow/run-executor-utils.js";
import { withWorkflowFinalization } from "#core/workflow/run-finalization.js";
import { validateRunIntegration, verifyRunPostReconcileInvariant } from "#core/workflow/run-integration-policy.js";
import { RunLifecycle } from "#core/workflow/run-lifecycle.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type {
  WorkflowRuntimeSummary,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import { triggerWorkflowFromStep } from "#core/workflow/runtime-dispatch-trigger.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowDefinitionInput,
} from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { WorkflowQueueManager } from "#core/workflow/workflow-queue.js";
import { unexpectedWorkflowCommandRun } from "./command-runner.js";

export type WorkflowScenarioStepResult = Pick<
  WorkflowStepResult,
  | "id"
  | "type"
  | "status"
  | "harness"
  | "model"
  | "output"
  | "error"
  | "skipReason"
  | "usage"
>;

export type WorkflowScenarioResult = {
  status: "success" | "failed";
  steps: Record<string, WorkflowScenarioStepResult>;
  error?: string;
  emitted: Array<{
    event: string;
    schemaRef: WorkflowRunTrigger["schemaRef"];
    payload: Record<string, unknown>;
  }>;
  restartRequested?: string;
  runDirPath: string;
  workspaceDir: string;
};

export type WorkflowScenarioOutput =
  | object
  | string
  | number
  | boolean
  | null
  | undefined;

export type WorkflowScenarioOptions = {
  /** Stable identity for run artifacts and step idempotency. */
  runId?: string;
  trigger?: {
    event: string;
    schemaRef?: WorkflowRunTrigger["schemaRef"];
    payload?: Record<string, unknown>;
  };
  /** Canonical scope root visible to workflow code. */
  workspaceRoot?: string;
  /** Seed scenario inputs inside the runtime-owned checkout before execution. */
  setupWorkspace?: (workspaceDir: string) => void | Promise<void>;
  /** Additional production definitions available to child triggers. */
  workflows?: readonly WorkflowDefinitionInput[];
  /** Ordered adapter outputs keyed by the declarative step id. */
  stepOutputs?: Record<
    string,
    WorkflowScenarioOutput | readonly WorkflowScenarioOutput[]
  >;
  runtimeState?: Partial<
    Pick<WorkflowRuntimeSummary, "completedRuns" | "workflows">
  >;
  scopePolicySnapshot?: ScopePolicySnapshot;
  /** Explicit owner decisions for approval steps reached by this scenario. */
  approvals?: Record<
    string,
    | { decision: "approve"; note?: string }
    | { decision: "reject"; reason?: string }
  >;
  /** External events delivered after a declared workflow step starts. */
  events?: Array<{
    afterStep: string;
    event: string;
    payload: Record<string, unknown>;
  }>;
  ports?: {
    state?: Readonly<{ stateDir: string; scopeId: string }>;
    runAgent?: (input: {
      stepId: string;
      cwd: string;
    }) => WorkflowScenarioOutput | Promise<WorkflowScenarioOutput>;
    runCommand?: WorkflowCommandRunner;
    /** Use the registered production tools or supply controlled tool outcomes. */
    runTool?: "registered" | ((name: string, input: Record<string, unknown>) => Promise<ToolResult>);
  };
};

class ScenarioApprovalQueue extends ApprovalQueue {
  constructor(
    dir: string,
    pbus: ScopedEventBus,
    private readonly decisions: NonNullable<WorkflowScenarioOptions["approvals"]>,
  ) {
    super(dir, pbus);
  }

  override enqueueWorkflowGate(
    request: Parameters<ApprovalQueue["enqueueWorkflowGate"]>[0],
  ): ReturnType<ApprovalQueue["enqueueWorkflowGate"]> {
    const approval = super.enqueueWorkflowGate(request);
    const decision = this.decisions[request.stepId];
    if (decision?.decision === "approve") {
      const selection = this.getExecutionSnapshot(approval.id);
      if (!selection.ok) {
        throw new Error(
          `Scenario could not authenticate approval step "${request.stepId}"`,
        );
      }
      const result = this.approveForExecution(
        selection.snapshot.descriptor,
        decision.note,
        "scenario",
      );
      if (!result.ok) {
        throw new Error(`Scenario could not approve step "${request.stepId}"`);
      }
    } else {
      const reason = decision?.reason
        ?? `Scenario has no owner decision for approval step "${request.stepId}"`;
      this.reject(approval.id, reason, "scenario");
    }
    const resolved = this.getWithAuthenticatedResolution(approval.id);
    if (!resolved || !isWorkflowGateApproval(resolved)) {
      throw new Error(`Scenario lost approval step "${request.stepId}"`);
    }
    return resolved;
  }
}

export type WorkflowScenarioTrigger = NonNullable<
  WorkflowScenarioOptions["trigger"]
>;

function flattenAgentSteps(
  steps: WorkflowDefinition["steps"],
  target = new Map<string, WorkflowAgentStep>(),
): Map<string, WorkflowAgentStep> {
  for (const step of steps) {
    if (step.type === "agent") target.set(step.id, step);
    else if (step.type === "parallel" || step.type === "foreach") {
      flattenAgentSteps(step.steps, target);
    } else if (step.type === "branch") {
      flattenAgentSteps(step.ifTrue, target);
      flattenAgentSteps(step.ifFalse, target);
    }
  }
  return target;
}

function scenarioDefinitions(
  inputs: readonly WorkflowDefinitionInput[],
  scopeRoot: string,
): WorkflowDefinition[] {
  const registered: RegisteredWorkflowDefinitionInput[] = inputs.map((input) => ({
    ...input,
    definitionPath: `${input.name}.scenario.ts`,
    moduleRoot: input.moduleRoot ?? process.cwd(),
  }));
  return validateWorkflowDefinitions(registered, scopeRoot, {
    defaultAgentHarness: "scenario",
    defaultAgentEffort: "high",
  });
}

function initializeOwnedScenarioRepository(scopeRoot: string): void {
  execFileSync("git", ["init", "--quiet"], { cwd: scopeRoot });
  execFileSync("git", ["config", "user.email", "scenario@kota.local"], {
    cwd: scopeRoot,
  });
  execFileSync("git", ["config", "user.name", "KOTA scenario"], {
    cwd: scopeRoot,
  });
  writeFileSync(join(scopeRoot, ".gitignore"), ".kota/\n");
  execFileSync("git", ["add", ".gitignore"], { cwd: scopeRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "scenario baseline"], {
    cwd: scopeRoot,
  });
}

function readEmittedEvents(runDirPath: string): WorkflowScenarioResult["emitted"] {
  const path = join(runDirPath, EMITTED_EVENTS_LOG_FILENAME);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line) as {
        event: string;
        schemaRef: WorkflowRunTrigger["schemaRef"];
        payload: Record<string, unknown>;
      };
      return {
        event: value.event,
        schemaRef: value.schemaRef,
        payload: value.payload,
      };
    });
}

/**
 * Runs a workflow scenario through the production validator and executor.
 * The driver replaces only host-owned external ports (agent, tool, command,
 * and policy); the production lifecycle and coordinator own settlement,
 * integration, state and deferred publications. The driver contains no workflow-step interpreter.
 */
export class WorkflowScenarioDriver {
  constructor(
    private readonly workflow: WorkflowDefinitionInput,
    private readonly options: WorkflowScenarioOptions = {},
  ) {}

  async run(): Promise<WorkflowScenarioResult> {
    const ownsRoot = this.options.workspaceRoot === undefined;
    const scopeRoot = this.options.workspaceRoot
      ?? mkdtempSync(join(tmpdir(), "kota-workflow-scenario-"));
    const definitions = scenarioDefinitions([this.workflow, ...(this.options.workflows ?? [])], scopeRoot);
    const definition = definitions[0];
    const definitionFor = (name: string) => {
      const found = definitions.find((entry) => entry.name === name);
      if (!found) throw new Error(`Unknown scenario workflow "${name}"`);
      return found;
    };
    const runId = this.options.runId ?? `scenario-${randomUUID()}`;
    if (ownsRoot && definitions.some((entry) => entry.repository !== "none")) {
      initializeOwnedScenarioRepository(scopeRoot);
    }
    const trigger: WorkflowRunTrigger = {
      event: this.options.trigger?.event ?? "runtime.idle",
      schemaRef: this.options.trigger?.schemaRef ?? null,
      payload: this.options.trigger?.payload ?? {},
    };
    const scopeId = this.options.ports?.state?.scopeId ?? deriveDirectoryScopeId(scopeRoot);
    const database = new RunStateDatabase(this.options.ports?.state?.stateDir ?? join(scopeRoot, ".kota", "scenario-state"));
    const now = () => new Date().toISOString();
    const bus = new EventBus();
    let unsubscribeScenarioEvents: () => void = () => undefined;
    let coordinator: RunCoordinator | undefined;
    try {
      database.registerScope({ id: scopeId, rootPath: scopeRoot, createdAt: now() });
      const { epoch } = database.beginDaemonSession(now());
      database.admitRun({ id: runId, scopeId, workflow: definition.name, repository: definition.repository, trigger, resources: definition.resources?.({ scopeRoot, stateDir: join(scopeRoot, ".kota"), workflowName: definition.name, trigger }) ?? [], admittedAt: now() });
      const store = new WorkflowRunStore(scopeRoot);
      const runtimeState: WorkflowRuntimeSummary = {
        completedRuns: this.options.runtimeState?.completedRuns ?? 0,
        workflows: this.options.runtimeState?.workflows ?? {},
      };
      let workspaceDir = "";
      const agentPort = this.options.ports?.runAgent;
      const cursors = new Map<string, number>();
      const nextOutput = (stepId: string): WorkflowScenarioOutput => {
        const configured = this.options.stepOutputs?.[stepId];
        if (configured === undefined) {
          throw new Error(
            `Agent or declarative tool step "${stepId}" requires a scenario output`,
          );
        }
        if (!Array.isArray(configured)) return configured;
        const index = cursors.get(stepId) ?? 0;
        if (index >= configured.length) {
          throw new Error(`Scenario output sequence for step "${stepId}" is exhausted`);
        }
        cursors.set(stepId, index + 1);
        return configured[index];
      };
      const resolveAgentHarness = (definition: WorkflowDefinition, name: string): AgentHarness => ({
        name,
        description: "Workflow scenario agent port",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: "ask_owner",
        emitsAgentMessageStream: true,
        toolControl: "kota",
        async run(options: AgentHarnessRunOptions): Promise<AgentHarnessResult> {
          const stepId = options.workflowContext?.stepId;
          if (!stepId) throw new Error("Scenario agent call has no workflow step identity");
          const step = flattenAgentSteps(definition.steps).get(stepId);
          if (!step) throw new Error(`Unknown scenario agent step "${stepId}"`);
          const output = agentPort
            ? await agentPort({
                stepId,
                cwd: options.cwd ?? workspaceDir,
              })
            : nextOutput(stepId);
          const record = output !== null && typeof output === "object"
            ? output as Record<string, unknown>
            : undefined;
          const text = step.outputFormat === "json"
            ? `\`\`\`json\n${JSON.stringify(output)}\n\`\`\``
            : typeof output === "string"
              ? output
              : typeof record?.content === "string"
                ? record.content
                : "";
          return {
            text,
            streamedText: text,
            turns: typeof record?.turns === "number" ? record.turns : 1,
            usage: {
              tokens:
                typeof record?.inputTokens === "number" &&
                  typeof record?.outputTokens === "number"
                  ? {
                      state: "complete" as const,
                      inputTokens: record.inputTokens,
                      outputTokens: record.outputTokens,
                    }
                  : { state: "unknown" as const },
              cost: typeof record?.totalCostUsd === "number"
                ? { state: "complete" as const, usd: record.totalCostUsd }
                : { state: "unknown" as const },
            },
            isError: false,
          };
        },
      });
      const policyAuthority: ScopePolicyAuthority | undefined =
        this.options.scopePolicySnapshot === undefined
          ? undefined
          : {
              getSnapshot: () => this.options.scopePolicySnapshot!,
              subscribeRestrictiveChanges: () => () => undefined,
            };
      const pbus = new ScopedEventBus(bus, scopeId);
      const deliveredEvents = new Set<number>();
      unsubscribeScenarioEvents = bus.on(
        "workflow.step.started",
        (payload) => {
          this.options.events?.forEach((scheduled, index) => {
            if (
              deliveredEvents.has(index) ||
              payload.runId !== runId ||
              payload.stepId !== scheduled.afterStep
            ) return;
            deliveredEvents.add(index);
            setTimeout(
              () => bus.emit(scheduled.event, {
                ...scheduled.payload,
                scopeId,
              }),
              0,
            );
          });
        },
      );
      const approvalQueue = new ScenarioApprovalQueue(
        join(scopeRoot, ".kota", "scenario-approvals"),
        pbus,
        this.options.approvals ?? {},
      );

      let wfQueue: WorkflowQueueManager;
      const lifecycle = new RunLifecycle({
        store: database,
        daemonEpoch: epoch,
        createResourceAllocator: (state) => new RunResourceAllocator(state, {
          portStart: 41_000, portEnd: 41_999, portRangeSize: 4,
          isPortAvailable: async () => true,
        }),
        validate: (context, input) => validateRunIntegration(context, definitionFor(context.workflow).integration!, input),
        verifyPostReconcile: (context, input) => verifyRunPostReconcileInvariant(
          context, definitionFor(context.workflow).integration!, store.rootDir, input,
          <T = unknown>(key: string) => database.readScopeStateValue<T>(scopeId, key),
        ),
        continueIntegration: async (_context, issue) => {
          throw new Error(`Scenario requires integration repair: ${issue.kind === "validation" ? issue.evidence.join("\n") : issue.conflictPaths.join(", ")}`);
        },
        executeWorkflow: async (runContext, run) => {
          const currentDefinition = definitionFor(run.workflow);
          if (run.id === runId) workspaceDir = runContext.sandbox.workspaceDir;
          await this.options.setupWorkspace?.(runContext.sandbox.workspaceDir);
          const { promise } = executeWorkflowRun(currentDefinition, run.trigger, {
            runContext,
            bus,
            pbus,
            store,
            readRuntimeState: () => runtimeState,
            approvalQueue,
            log: () => undefined,
            runCommand: this.options.ports?.runCommand ?? unexpectedWorkflowCommandRun,
            runTool: this.options.ports?.runTool === "registered" ? undefined : async (name, input, context) => {
              if (typeof this.options.ports?.runTool === "function") {
                return this.options.ports.runTool(name, input);
              }
              const output = nextOutput(context?.stepId ?? name);
              return output !== null && typeof output === "object" &&
                  typeof (output as Record<string, unknown>).content === "string"
                ? output as ToolResult
                : { content: JSON.stringify(output) };
            },
            resolveAgentHarness: (name) => resolveAgentHarness(currentDefinition, name),
            scopePolicyAuthority: policyAuthority,
            triggerWorkflow: (workflowName, payload, waitFor, signal, triggerId) =>
              triggerWorkflowFromStep(
                { definitions, wfQueue, runCoordinator: coordinator!, store },
                run.id, workflowName, payload, waitFor, signal, triggerId,
              ),
          });
          const execution = await promise;
          const metadata = execution.metadata;
          return metadata.status === "success" || metadata.status === "completed-with-warnings"
            ? { kind: "completed" }
            : { kind: "terminal", state: "failed", error: [...metadata.steps].reverse().find((step) => step.error)?.error };
        },
      });
      coordinator = new RunCoordinator({
        store: database,
        daemonEpoch: epoch,
        concurrency: 1,
        execute: async (run, signal) => withWorkflowFinalization(
          await lifecycle.execute(run, signal),
          { definition: definitionFor(run.workflow), run, store: database, stateDir: store.rootDir, pbus,
            stepOutputs: Object.fromEntries(store.getRun(run.id, { authorityCritical: true }).steps.map((step) => [step.id, step.output])),
          },
        ),
      });
      wfQueue = new WorkflowQueueManager({
        store, runState: database, coordinator, scopeId, scopeRoot,
        getScopeId: () => scopeId,
        getActiveBackoff: () => null,
        workflowUsesAgent,
        getDefinitions: () => definitions,
        log: () => undefined,
      });
      coordinator.refill();
      await coordinator.whenIdle();
      const settled = database.getRun(runId)!;
      const runDirPath = join(store.runsDir, runId);
      const metadata = readWorkflowRunMetadataFile(join(runDirPath, "metadata.json"));
      const steps = Object.fromEntries(
        (metadata?.steps ?? []).map((step) => [step.id, step]),
      );
      const published = database.listPendingPublications(Number.MAX_SAFE_INTEGER).filter((entry) => entry.runId === runId);
      const emitted = [...readEmittedEvents(runDirPath), ...published.map((entry) => ({ event: entry.event, schemaRef: null, payload: { ...entry.payload } }))];
      const restart = emitted.find(
        (entry) => entry.event === "runtime.restart_requested",
      );
      const failedStep = [...(metadata?.steps ?? [])]
        .reverse()
        .find((step) => step.status === "failed");
      return {
        status: settled.state === "succeeded" ? "success" : "failed",
        steps,
        ...((settled.lastError ?? failedStep?.error) != null
          ? { error: settled.lastError ?? failedStep?.error } : {}),
        emitted,
        ...(typeof restart?.payload.reason === "string"
          ? { restartRequested: restart.payload.reason }
          : {}),
        runDirPath,
        workspaceDir,
      };
    } finally {
      await coordinator?.dispose();
      database.close();
      unsubscribeScenarioEvents();
      bus.clear();
      if (ownsRoot) rmSync(scopeRoot, { recursive: true, force: true });
    }
  }
}
