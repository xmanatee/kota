import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
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
import type {
  DurableEffectValue,
  RunContext,
  TransactionalRunState,
} from "#core/workflow/run-context.js";
import { EMITTED_EVENTS_LOG_FILENAME } from "#core/workflow/run-event-evidence.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { writeStrictJsonFile } from "#core/workflow/run-io.js";
import { RunSandboxManager } from "#core/workflow/run-sandbox.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { STATE_FILE } from "#core/workflow/run-store-snapshot.js";
import type {
  WorkflowRuntimeState,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinition,
  WorkflowDefinitionInput,
} from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
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
  | "costUsd"
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
  trigger?: {
    event: string;
    schemaRef?: WorkflowRunTrigger["schemaRef"];
    payload?: Record<string, unknown>;
  };
  /** Canonical scope root visible to workflow code. */
  workspaceRoot?: string;
  /** Isolated checkout visible as `ctx.workspaceRoot`. */
  workspaceDir?: string;
  /** Ordered adapter outputs keyed by the declarative step id. */
  stepOutputs?: Record<
    string,
    WorkflowScenarioOutput | readonly WorkflowScenarioOutput[]
  >;
  runtimeState?: Partial<
    Pick<WorkflowRuntimeState, "completedRuns" | "workflows">
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
    state?: TransactionalRunState;
    runAgent?: (input: {
      stepId: string;
      cwd: string;
    }) => WorkflowScenarioOutput | Promise<WorkflowScenarioOutput>;
    runCommand?: WorkflowCommandRunner;
    runTool?: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
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

function createTransactionalState(): TransactionalRunState {
  const values = new Map<
    string,
    { revision: number; value: DurableEffectValue }
  >();
  return {
    read<T extends DurableEffectValue>(key: string) {
      const current = values.get(key);
      return current === undefined
        ? { revision: 0, value: null }
        : {
            revision: current.revision,
            value: structuredClone(current.value) as T,
          };
    },
    compareAndSet(key, expectedRevision, value) {
      const currentRevision = values.get(key)?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(
          `Scenario state revision mismatch for "${key}": expected ${expectedRevision}, received ${currentRevision}`,
        );
      }
      values.set(key, {
        revision: currentRevision + 1,
        value: structuredClone(value),
      });
    },
  };
}

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

function scenarioDefinition(
  input: WorkflowDefinitionInput,
  scopeRoot: string,
): WorkflowDefinition {
  const registered: RegisteredWorkflowDefinitionInput = {
    ...input,
    definitionPath: `${input.name}.scenario.ts`,
    moduleRoot: input.moduleRoot ?? process.cwd(),
  };
  return validateWorkflowDefinitions([registered], scopeRoot, {
    defaultAgentHarness: "scenario",
  })[0];
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

function createScenarioSandbox(
  scopeRoot: string,
  runId: string,
  repository: WorkflowDefinition["repository"],
): RunContext["sandbox"] {
  const manager = new RunSandboxManager(scopeRoot);
  if (repository === "none") return manager.create({ runId, repository });
  if (repository === "read") return manager.create({ runId, repository });
  return manager.create({ runId, repository });
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
 * policy, and durable state); it contains no workflow-step interpreter.
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
    const definition = scenarioDefinition(this.workflow, scopeRoot);
    const runId = `scenario-${randomUUID()}`;
    if (ownsRoot && definition.repository !== "none") {
      initializeOwnedScenarioRepository(scopeRoot);
    }
    const sandbox = this.options.workspaceDir === undefined
      ? createScenarioSandbox(scopeRoot, runId, definition.repository)
      : {
          runId,
          repository: definition.repository,
          rootDir: join(scopeRoot, ".kota", "scenario-runtime", runId),
          workspaceDir: this.options.workspaceDir,
          tempDir: join(scopeRoot, ".kota", "scenario-runtime", runId, "tmp"),
          artifactDir: join(
            scopeRoot,
            ".kota",
            "scenario-runtime",
            runId,
            "artifacts",
          ),
          ...(definition.repository === "none"
            ? {}
            : { baseCommit: "0".repeat(40) }),
          ...(definition.repository === "write"
            ? { branch: `scenario/${runId}`, targetBranch: "scenario" }
            : {}),
        } as RunContext["sandbox"];
    const { rootDir: runtimeRoot, workspaceDir, tempDir, artifactDir } = sandbox;
    const agentDir = join(runtimeRoot, "agent");
    const packageCacheDir = join(tempDir, "package-cache");
    for (const path of [workspaceDir, tempDir, artifactDir, agentDir, packageCacheDir]) {
      mkdirSync(path, { recursive: true });
    }

    const trigger: WorkflowRunTrigger = {
      event: this.options.trigger?.event ?? "runtime.idle",
      schemaRef: this.options.trigger?.schemaRef ?? null,
      payload: this.options.trigger?.payload ?? {},
    };
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const bus = new EventBus();
    const store = new WorkflowRunStore(scopeRoot);
    if (this.options.runtimeState !== undefined) {
      writeStrictJsonFile(join(store.rootDir, STATE_FILE), {
        completedRuns: this.options.runtimeState.completedRuns ?? 0,
        workflows: this.options.runtimeState.workflows ?? {},
      });
    }
    const stagedEvents: WorkflowScenarioResult["emitted"] = [];
    const runContext: RunContext = {
      run: { id: runId, attempt: 1, daemonEpoch: 1 },
      scope: { id: scopeId, root: scopeRoot },
      workflow: definition.name,
      trigger,
      sandbox,
      resources: {
        runId,
        attempt: 1,
        daemonEpoch: 1,
        workspaceDir,
        runDir: runtimeRoot,
        tempDir,
        artifactDir,
        agentDir,
        packageCacheDir,
        ports: { start: 41_000, end: 41_003, size: 4, values: [41_000, 41_001, 41_002, 41_003] },
        env: {
          TMPDIR: tempDir,
          KOTA_RUN_DIR: agentDir,
          KOTA_RUN_ARTIFACT_DIR: artifactDir,
        },
      },
      signal: new AbortController().signal,
      processes: { register: () => undefined },
      effects: { execute: (effect) => effect.execute() },
      publications: {
        stageEmit: (_stepId, event, payload) => {
          stagedEvents.push({ event, schemaRef: null, payload: { ...payload } });
        },
      },
      state: this.options.ports?.state ?? createTransactionalState(),
    };

    const agentSteps = flattenAgentSteps(definition.steps);
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
    const resolveAgentHarness = (name: string): AgentHarness => ({
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
        const step = agentSteps.get(stepId);
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
          totalCostUsd:
            typeof record?.totalCostUsd === "number"
              ? record.totalCostUsd
              : undefined,
          inputTokens:
            typeof record?.inputTokens === "number" ? record.inputTokens : undefined,
          outputTokens:
            typeof record?.outputTokens === "number" ? record.outputTokens : undefined,
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
    const unsubscribeScenarioEvents = bus.on(
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
      join(runtimeRoot, "approvals"),
      pbus,
      this.options.approvals ?? {},
    );

    try {
      const { promise } = executeWorkflowRun(definition, trigger, {
        runContext,
        bus,
        pbus,
        store,
        approvalQueue,
        log: () => undefined,
        runCommand: this.options.ports?.runCommand ?? unexpectedWorkflowCommandRun,
        runTool: async (name, input, context) => {
          if (this.options.ports?.runTool) {
            return this.options.ports.runTool(name, input);
          }
          const output = nextOutput(context?.stepId ?? name);
          return output !== null && typeof output === "object" &&
              typeof (output as Record<string, unknown>).content === "string"
            ? output as ToolResult
            : { content: JSON.stringify(output) };
        },
        resolveAgentHarness,
        scopePolicyAuthority: policyAuthority,
        triggerWorkflow: async (_workflowName, _payload, _waitFor, _signal, triggerId) => {
          const output = nextOutput(triggerId ?? "trigger");
          if (output === null || typeof output !== "object") {
            throw new Error(`Trigger step "${triggerId ?? "unknown"}" has an invalid scenario output`);
          }
          return output as { runId: string; status: "queued" | "completed" | "failed" };
        },
      });
      const execution = await promise;
      const runDirPath = join(scopeRoot, execution.metadata.runDir);
      const steps = Object.fromEntries(
        execution.metadata.steps.map((step) => [step.id, step]),
      );
      const emitted = [...readEmittedEvents(runDirPath), ...stagedEvents];
      const restart = emitted.find(
        (entry) => entry.event === "runtime.restart_requested",
      );
      const failedStep = [...execution.metadata.steps]
        .reverse()
        .find((step) => step.status === "failed");
      return {
        status: execution.metadata.status === "failed" ||
            execution.metadata.status === "interrupted"
          ? "failed"
          : "success",
        steps,
        ...(failedStep?.error !== undefined ? { error: failedStep.error } : {}),
        emitted,
        ...(typeof restart?.payload.reason === "string"
          ? { restartRequested: restart.payload.reason }
          : {}),
        runDirPath,
        workspaceDir,
      };
    } finally {
      unsubscribeScenarioEvents();
      bus.clear();
      if (ownsRoot) rmSync(scopeRoot, { recursive: true, force: true });
    }
  }
}
