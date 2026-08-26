import { tmpdir } from "node:os";
import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { WorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { TransactionalRunState } from "#core/workflow/run-context.js";
import type {
  WorkflowRuntimeResources,
  WorkflowRuntimeSummary,
  WorkflowStepContext,
  WorkflowStepSkipReason,
} from "#core/workflow/run-types.js";
import type { WorkflowStepOutput } from "#core/workflow/steps/step-executor-agent.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { HarnessExecutionState } from "./execution-state.js";
import { executeHarnessStep } from "./step-executor.js";

export type HarnessOutputValue = unknown;
export type HarnessObjectValue = Record<string, unknown>;

export type HarnessStepResult = {
  id: string;
  type: string;
  status: "success" | "failed" | "skipped";
  harness?: string;
  model?: string;
  output?: HarnessOutputValue;
  error?: string;
  skipReason?: WorkflowStepSkipReason;
  costUsd?: number;
};

export type HarnessRunResult = {
  status: "success" | "failed";
  steps: Record<string, HarnessStepResult>;
  error?: string;
  emitted: Array<{
    event: string;
    schemaRef: WorkflowRunTrigger["schemaRef"];
    payload: HarnessObjectValue;
  }>;
  restartRequested?: string;
};

export type HarnessTrigger = {
  event: string;
  schemaRef?: WorkflowRunTrigger["schemaRef"];
  payload?: HarnessObjectValue;
};

type StepMockLiteral = WorkflowStepOutput | readonly WorkflowStepOutput[];
type StepMockResolver = (
  context: WorkflowStepContext,
) => StepMockLiteral | Promise<StepMockLiteral>;
type StepMockValue = StepMockLiteral | StepMockResolver;

export type HarnessOptions = {
  trigger?: HarnessTrigger;
  /**
   * Project directory passed to code steps. Omitted means the harness uses the
   * OS temp directory rather than the caller's live repo.
   */
  projectDir?: string;
  /**
   * Mutable checkout passed to workflow step contexts. Omitted means code
   * steps see the same checkout as projectDir.
   */
  workspaceDir?: string;
  runtimeResources?: WorkflowRuntimeResources;
  /** Authoritative policy snapshot exposed to code steps in this test run. */
  scopePolicySnapshot?: ScopePolicySnapshot;
  /**
   * Mock outputs for agent steps and (optionally) tool steps.
   * Agent steps require a mock; a missing mock throws a clear error.
   * Tool steps use the mock when provided; otherwise context.runTool is called.
   */
  stepMocks?: { [stepId: string]: StepMockValue };
  /**
   * Override the runtime state returned by context.readRuntimeState().
   */
  runtimeState?: Partial<
    Pick<WorkflowRuntimeSummary, "completedRuns" | "workflows">
  >;
  /**
   * Override individual context methods. Useful for testing code steps that
   * call runTool, triggerWorkflow, or readPrompt.
   */
  contextOverrides?: {
    state?: TransactionalRunState;
    runCommand?: WorkflowCommandRunner;
    runBlocking?: <TInput, TOutput>(
      operation: WorkflowBlockingOperation<TInput, TOutput>,
      input: TInput,
    ) => Promise<TOutput>;
    runTool?: (name: string, input: HarnessObjectValue) => Promise<ToolResult>;
    readPrompt?: (promptPath: string) => string;
    triggerWorkflow?: (
      workflowName: string,
      payload: HarnessObjectValue,
      waitFor: "queued" | "completed",
      signal?: AbortSignal,
    ) => Promise<{ runId: string; status: "queued" | "completed" | "failed" }>;
  };
  /**
   * When true, parallel step groups run their child steps concurrently.
   * Default: false (serial execution for deterministic tests).
   */
  parallel?: boolean;
};

/**
 * A lightweight harness for unit-testing workflow definitions without a running
 * daemon or real agent session.
 *
 * - Code steps execute their real `run` function via a mock WorkflowStepContext.
 * - Agent steps are interceptable via `stepMocks`; missing mocks throw.
 * - `when` predicates are evaluated with real predicate logic.
 * - Parallel groups run serially by default (opt-in `parallel: true` for concurrency).
 */
export class WorkflowTestHarness {
  readonly #workflow: WorkflowDefinitionInput;
  readonly #options: HarnessOptions;

  constructor(workflow: WorkflowDefinitionInput, options: HarnessOptions = {}) {
    this.#workflow = workflow;
    this.#options = options;
  }

  async run(): Promise<HarnessRunResult> {
    const projectDir = this.#options.projectDir ?? tmpdir();
    const state = new HarnessExecutionState(this.#workflow, this.#options, {
      projectDir,
      workspaceDir: this.#options.workspaceDir ?? projectDir,
      runtimeResources: this.#options.runtimeResources,
      trigger: {
        event: this.#options.trigger?.event ?? "runtime.idle",
        schemaRef: this.#options.trigger?.schemaRef ?? null,
        payload: this.#options.trigger?.payload ?? {},
      },
    });

    for (const step of this.#workflow.steps) {
      if (state.runFailed) break;
      await executeHarnessStep(step, state);
    }

    return state.toRunResult();
  }
}
