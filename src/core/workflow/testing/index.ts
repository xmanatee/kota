import type { ToolResult } from "#core/tools/tool-result.js";
import type {
  WorkflowRuntimeState,
  WorkflowStepContext,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import { resolveValue } from "#core/workflow/steps/step-executor.js";
import type {
  WorkflowBranchStepInput,
  WorkflowCodeStepInput,
  WorkflowDefinitionInput,
  WorkflowForeachStepInput,
  WorkflowParallelGroupInput,
  WorkflowStepInput,
} from "#core/workflow/types.js";

export type HarnessStepResult = {
  id: string;
  type: string;
  status: "success" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  skipReason?: string;
  costUsd?: number;
};

export type HarnessRunResult = {
  status: "success" | "failed";
  steps: Record<string, HarnessStepResult>;
  error?: string;
  emitted: Array<{ event: string; payload: Record<string, unknown> }>;
  restartRequested?: string;
};

export type HarnessTrigger = {
  event: string;
  payload?: Record<string, unknown>;
};

export type HarnessOptions = {
  trigger?: HarnessTrigger;
  projectDir?: string;
  /**
   * Mock outputs for agent steps and (optionally) tool steps.
   * Agent steps require a mock; a missing mock throws a clear error.
   * Tool steps use the mock when provided; otherwise context.runTool is called.
   */
  stepMocks?: Record<string, unknown>;
  /**
   * Override the runtime state returned by context.readRuntimeState().
   */
  runtimeState?: Partial<
    Pick<WorkflowRuntimeState, "completedRuns" | "pendingRuns" | "workflows">
  >;
  /**
   * Override individual context methods. Useful for testing code steps that
   * call runTool, triggerWorkflow, or readPrompt.
   */
  contextOverrides?: {
    runTool?: (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<ToolResult>;
    readPrompt?: (promptPath: string) => string;
    triggerWorkflow?: (
      workflowName: string,
      payload: Record<string, unknown>,
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

function makeStepResult(
  id: string,
  type: string,
  status: "success" | "failed" | "skipped",
  output: unknown,
  error: string | undefined,
  skipReason: string | undefined,
): { harness: HarnessStepResult; internal: WorkflowStepResult } {
  const now = new Date().toISOString();
  const harness: HarnessStepResult = {
    id,
    type,
    status,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(skipReason !== undefined ? { skipReason } : {}),
  };
  const internal: WorkflowStepResult = {
    id,
    type: type as WorkflowStepResult["type"],
    status,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
  };
  return { harness, internal };
}

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
    const trigger = {
      event: this.#options.trigger?.event ?? "runtime.idle",
      payload: this.#options.trigger?.payload ?? {},
    };
    const projectDir = this.#options.projectDir ?? process.cwd();
    const stepMocks = this.#options.stepMocks ?? {};
    const runParallel = this.#options.parallel ?? false;

    const stepOutputsById: Record<string, unknown> = {};
    const stepResultsById: Record<string, WorkflowStepResult> = {};
    const stepOutputList: unknown[] = [];
    const emitted: Array<{ event: string; payload: Record<string, unknown> }> =
      [];
    let restartRequested: string | undefined;

    const allStepResults: Record<string, HarnessStepResult> = {};
    let runFailed = false;
    let runError: string | undefined;

    const buildContext = (): WorkflowStepContext => {
      const previousOutput =
        stepOutputList.length > 0
          ? stepOutputList[stepOutputList.length - 1]
          : undefined;

      const runtimeState: WorkflowRuntimeState = {
        completedRuns: this.#options.runtimeState?.completedRuns ?? 0,
        pendingRuns: this.#options.runtimeState?.pendingRuns ?? [],
        workflows: this.#options.runtimeState?.workflows ?? {},
      };

      return {
        projectDir,
        workflow: {
          name: this.#workflow.name,
          definitionPath: "test",
          runId: "harness-run-id",
          runDir: ".kota/runs/harness",
          runDirPath: `${projectDir}/.kota/runs/harness`,
        },
        trigger,
        previousOutput,
        stepOutputs: { ...stepOutputsById },
        stepResults: { ...stepResultsById },
        stepOutputList: [...stepOutputList],
        runTool:
          this.#options.contextOverrides?.runTool ??
          (() => {
            throw new Error(
              "runTool called but no contextOverrides.runTool mock was provided",
            );
          }),
        emit: (event, payload) => emitted.push({ event, payload }),
        requestRestart: (reason) => {
          restartRequested = reason;
        },
        readPrompt:
          this.#options.contextOverrides?.readPrompt ?? (() => ""),
        readRuntimeState: () => runtimeState,
        triggerWorkflow:
          this.#options.contextOverrides?.triggerWorkflow ??
          (() => {
            throw new Error(
              "triggerWorkflow called but no contextOverrides.triggerWorkflow mock was provided",
            );
          }),
      };
    };

    const recordResult = (
      harness: HarnessStepResult,
      internal: WorkflowStepResult,
      output: unknown,
    ) => {
      allStepResults[harness.id] = harness;
      stepResultsById[harness.id] = internal;
      if (output !== undefined) {
        stepOutputsById[harness.id] = output;
        stepOutputList.push(output);
      }
    };

    const recordSkippedArm = (steps: WorkflowStepInput[]) => {
      for (const s of steps) {
        const { harness, internal } = makeStepResult(s.id, s.type, "skipped", undefined, undefined, "branch not taken");
        allStepResults[s.id] = harness;
        stepResultsById[s.id] = internal;
        if (s.type === "branch") {
          recordSkippedArm(s.ifTrue);
          if (s.ifFalse) recordSkippedArm(s.ifFalse);
        }
      }
    };

    const executeStep = async (
      step: WorkflowCodeStepInput | WorkflowStepInput,
    ): Promise<void> => {
      // Branch step — evaluate outer when, then condition, then run chosen arm
      if (step.type === "branch") {
        const branch = step as WorkflowBranchStepInput;
        const context = buildContext();
        const shouldRun = branch.when ? Boolean(await branch.when(context)) : true;
        if (!shouldRun) {
          const { harness, internal } = makeStepResult(branch.id, "branch", "skipped", undefined, undefined, "when predicate returned false");
          recordResult(harness, internal, undefined);
          return;
        }

        let conditionResult: boolean;
        try {
          conditionResult = Boolean(await branch.condition(context));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const { harness, internal } = makeStepResult(branch.id, "branch", "failed", undefined, `Branch condition error: ${errMsg}`, undefined);
          recordResult(harness, internal, undefined);
          if (!branch.continueOnFailure) { runFailed = true; runError = errMsg; }
          return;
        }

        const takenArm = conditionResult ? branch.ifTrue : (branch.ifFalse ?? []);
        const skippedArm = conditionResult ? (branch.ifFalse ?? []) : branch.ifTrue;
        const armLabel: "ifTrue" | "ifFalse" = conditionResult ? "ifTrue" : "ifFalse";

        recordSkippedArm(skippedArm);
        for (const armStep of takenArm) {
          if (runFailed && !branch.continueOnFailure) break;
          await executeStep(armStep);
        }

        const armStatuses = takenArm.map((s) => allStepResults[s.id]?.status);
        const branchFailed = armStatuses.some((s) => s === "failed");
        const branchStatus = branchFailed ? "failed" : "success";
        const branchOutput = { arm: armLabel, steps: takenArm.length };
        const now = new Date().toISOString();
        allStepResults[branch.id] = { id: branch.id, type: "branch", status: branchStatus, output: branchOutput };
        stepResultsById[branch.id] = { id: branch.id, type: "branch", status: branchStatus, startedAt: now, completedAt: now, durationMs: 0, output: branchOutput };
        stepOutputsById[branch.id] = branchOutput;
        stepOutputList.push(branchOutput);

        if (branchFailed && !branch.continueOnFailure) {
          runFailed = true;
          runError = takenArm.map((s) => allStepResults[s.id]).find((r) => r?.status === "failed")?.error ?? "branch arm failed";
        }
        return;
      }

      // Foreach step — iterate over items, binding each to context.foreach
      if (step.type === "foreach") {
        const foreach = step as WorkflowForeachStepInput;
        const context = buildContext();
        const shouldRun = foreach.when ? Boolean(await foreach.when(context)) : true;
        if (!shouldRun) {
          const { harness, internal } = makeStepResult(foreach.id, "foreach", "skipped", undefined, undefined, "when predicate returned false");
          recordResult(harness, internal, undefined);
          return;
        }

        let items: unknown[];
        try {
          const resolved = await resolveValue(foreach.items, context);
          if (!Array.isArray(resolved)) {
            throw new Error(`foreach step "${foreach.id}" items resolver returned a non-array value`);
          }
          items = resolved;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const { harness, internal } = makeStepResult(foreach.id, "foreach", "failed", undefined, errMsg, undefined);
          recordResult(harness, internal, undefined);
          if (!foreach.continueOnFailure) { runFailed = true; runError = errMsg; }
          return;
        }

        const itemResults: Array<{ index: number; status: "success" | "failed"; steps: Record<string, HarnessStepResult> }> = [];
        let foreachFailed = false;

        const runIteration = async (index: number, item: unknown): Promise<void> => {
          const iterStepOutputsById: Record<string, unknown> = {};
          const iterHarnessResults: Record<string, HarnessStepResult> = {};
          let iterFailed = false;

          for (const innerStep of foreach.steps) {
            const iterContext: WorkflowStepContext = {
              ...buildContext(),
              foreach: { [foreach.as]: item },
              stepOutputs: { ...stepOutputsById, ...iterStepOutputsById },
              stepResults: { ...stepResultsById },
              stepOutputList: [...stepOutputList],
            };

            const innerShouldRun = innerStep.when ? Boolean(await innerStep.when(iterContext)) : true;
            if (!innerShouldRun) {
              const { harness: h } = makeStepResult(innerStep.id, innerStep.type, "skipped", undefined, undefined, "when predicate returned false");
              iterHarnessResults[innerStep.id] = h;
              continue;
            }

            let innerOutput: unknown;
            let innerError: string | undefined;
            let innerStatus: "success" | "failed" = "success";

            try {
              if (innerStep.type === "agent") {
                if (!(innerStep.id in stepMocks)) {
                  throw new Error(`Agent step "${innerStep.id}" requires a mock. Add stepMocks["${innerStep.id}"] to HarnessOptions.`);
                }
                innerOutput = stepMocks[innerStep.id];
              } else {
                innerOutput = await (innerStep as WorkflowCodeStepInput).run(iterContext);
              }
            } catch (err) {
              innerError = err instanceof Error ? err.message : String(err);
              innerStatus = "failed";
            }

            const { harness: h } = makeStepResult(innerStep.id, innerStep.type, innerStatus, innerOutput, innerError, undefined);
            iterHarnessResults[innerStep.id] = h;
            if (innerOutput !== undefined) iterStepOutputsById[innerStep.id] = innerOutput;

            if (innerStatus === "failed" && !innerStep.continueOnFailure) {
              iterFailed = true;
              break;
            }
          }

          const iterStatus = iterFailed ? "failed" : "success";
          itemResults.push({ index, status: iterStatus, steps: iterHarnessResults });

          if (iterFailed) {
            foreachFailed = true;
          }
        };

        if (runParallel) {
          await Promise.all(items.map((item, i) => runIteration(i, item)));
        } else {
          for (let i = 0; i < items.length; i++) {
            await runIteration(i, items[i]);
            if (foreachFailed && !foreach.continueOnFailure) break;
          }
        }

        const foreachStatus = foreachFailed ? "failed" : "success";
        const foreachOutput = { items: items.length, results: itemResults };
        const now = new Date().toISOString();
        allStepResults[foreach.id] = { id: foreach.id, type: "foreach", status: foreachStatus, output: foreachOutput };
        stepResultsById[foreach.id] = { id: foreach.id, type: "foreach", status: foreachStatus, startedAt: now, completedAt: now, durationMs: 0, output: foreachOutput };
        stepOutputsById[foreach.id] = foreachOutput;
        stepOutputList.push(foreachOutput);

        if (foreachFailed && !foreach.continueOnFailure) {
          runFailed = true;
          const failedItem = itemResults.find((r) => r.status === "failed");
          const failedStep = failedItem ? Object.values(failedItem.steps).find((s) => s.status === "failed") : undefined;
          runError = failedStep?.error ?? "foreach step failed";
        }
        return;
      }

      // Parallel group — run child steps concurrently or serially
      if (step.type === "parallel") {
        const group = step as WorkflowParallelGroupInput;
        const context = buildContext();
        const shouldRun = group.when ? Boolean(await group.when(context)) : true;
        if (!shouldRun) {
          const { harness, internal } = makeStepResult(group.id, "parallel", "skipped", undefined, undefined, "when predicate returned false");
          recordResult(harness, internal, undefined);
          return;
        }

        const groupStart = new Date().toISOString();
        if (runParallel) {
          await Promise.all(group.steps.map((s) => executeStep(s)));
        } else {
          for (const s of group.steps) {
            if (runFailed && !group.continueOnFailure) break;
            await executeStep(s);
          }
        }

        const innerStatuses = group.steps.map((s) => allStepResults[s.id]?.status);
        const groupFailed = innerStatuses.some((s) => s === "failed");
        const groupStatus = groupFailed ? "failed" : "success";
        const innerResults = group.steps.map((s) => allStepResults[s.id]);
        const groupOutput = { steps: innerResults };
        const groupNow = new Date().toISOString();
        allStepResults[group.id] = { id: group.id, type: "parallel", status: groupStatus, output: groupOutput };
        stepResultsById[group.id] = { id: group.id, type: "parallel", status: groupStatus, startedAt: groupStart, completedAt: groupNow, durationMs: 0, output: groupOutput };

        if (groupFailed && !group.continueOnFailure) {
          runFailed = true;
          runError = group.steps.map((s) => allStepResults[s.id]).find((r) => r?.status === "failed")?.error ?? "parallel group failed";
        }
        return;
      }

      // Leaf steps: code, agent, emit, restart, trigger, tool
      const context = buildContext();
      const shouldRun = step.when ? Boolean(await step.when(context)) : true;
      if (!shouldRun) {
        const { harness, internal } = makeStepResult(step.id, step.type, "skipped", undefined, undefined, "when predicate returned false");
        recordResult(harness, internal, undefined);
        return;
      }

      let output: unknown;
      let stepError: string | undefined;
      let status: "success" | "failed" = "success";

      try {
        if (step.type === "code") {
          output = await (step as WorkflowCodeStepInput).run(context);
        } else if (step.type === "agent") {
          if (!(step.id in stepMocks)) {
            throw new Error(
              `Agent step "${step.id}" requires a mock. Add stepMocks["${step.id}"] to HarnessOptions.`,
            );
          }
          output = stepMocks[step.id];
        } else if (step.type === "tool") {
          if (step.id in stepMocks) {
            output = stepMocks[step.id];
          } else if (this.#options.contextOverrides?.runTool) {
            const input =
              typeof step.input === "function"
                ? await step.input(context)
                : (step.input ?? {});
            output = await context.runTool(step.tool, input as Record<string, unknown>);
          } else {
            throw new Error(
              `Tool step "${step.id}" requires either stepMocks["${step.id}"] or contextOverrides.runTool.`,
            );
          }
        } else if (step.type === "emit") {
          const payload =
            typeof step.payload === "function"
              ? await step.payload(context)
              : (step.payload ?? {});
          context.emit(step.event, payload as Record<string, unknown>);
          output = { event: step.event, payload };
        } else if (step.type === "restart") {
          const reason =
            typeof step.reason === "function"
              ? await step.reason(context)
              : (step.reason ??
                `${this.#workflow.name} requested restart`);
          context.requestRestart(reason as string);
          output = {
            event: "runtime.restart_requested",
            payload: { reason },
          };
        } else if (step.type === "trigger") {
          if (step.id in stepMocks) {
            output = stepMocks[step.id];
          } else if (this.#options.contextOverrides?.triggerWorkflow) {
            const payload =
              typeof step.payload === "function"
                ? await step.payload(context)
                : (step.payload ?? {});
            output = await context.triggerWorkflow(
              step.workflow,
              payload as Record<string, unknown>,
              step.waitFor ?? "queued",
            );
          } else {
            throw new Error(
              `Trigger step "${step.id}" requires either stepMocks["${step.id}"] or contextOverrides.triggerWorkflow.`,
            );
          }
        } else if (step.type === "approval") {
          const mock = stepMocks[step.id];
          if (mock !== undefined && mock !== null && (mock as { approved?: unknown }).approved === false) {
            const reason = (mock as { reason?: string }).reason;
            throw new Error(
              `Approval step "${step.id}" was rejected${reason ? `: ${reason}` : ""}`,
            );
          }
          // Default: approve
          const approvalNote = mock !== undefined && mock !== null ? (mock as { approvalNote?: string }).approvalNote : undefined;
          output = {
            approvalId: "harness-approval",
            approved: true,
            resolutionSource: "harness",
            ...(approvalNote && { approvalNote }),
          };
        }
      } catch (err) {
        stepError = err instanceof Error ? err.message : String(err);
        status = "failed";
        if (!step.continueOnFailure) {
          runFailed = true;
          runError = stepError;
        }
      }

      const { harness, internal } = makeStepResult(
        step.id,
        step.type,
        status,
        output,
        stepError,
        undefined,
      );
      recordResult(harness, internal, output);
    };

    for (const step of this.#workflow.steps) {
      if (runFailed) break;
      await executeStep(step);
    }

    return {
      status: runFailed ? "failed" : "success",
      steps: allStepResults,
      ...(runError !== undefined ? { error: runError } : {}),
      emitted,
      ...(restartRequested !== undefined ? { restartRequested } : {}),
    };
  }
}
