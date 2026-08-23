import { runtimeResourcesFromStepOutput } from "#core/workflow/runtime-resources.js";
import type { WorkflowCodeStepInput } from "#core/workflow/step-input-code.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import { workspaceDirFromStepOutput } from "#core/workflow/workspace-update.js";
import type { HarnessExecutionState } from "./execution-state.js";
import type {
  HarnessObjectValue,
  HarnessOutputValue,
} from "./index.js";
import {
  makeStepResult,
  resolveStepMock,
  validateWorkflowStepOutput,
  whenSkipReason,
} from "./results.js";

export async function executeLeafStep(
  step: WorkflowCodeStepInput | WorkflowStepInput,
  state: HarnessExecutionState,
): Promise<void> {
  const context = state.buildContext();
  const shouldRun = step.when ? Boolean(await step.when(context)) : true;
  if (!shouldRun) {
    const reason = whenSkipReason(step.when);
    const { harness, internal } = makeStepResult(
      step.id,
      step.type,
      "skipped",
      undefined,
      undefined,
      reason,
    );
    state.recordResult(harness, internal, undefined);
    return;
  }

  let output: HarnessOutputValue;
  let stepError: string | undefined;
  let status: "success" | "failed" = "success";

  try {
    if (step.type === "code") {
      const rawOutput = await step.run(context);
      output = validateWorkflowStepOutput(step, rawOutput, context);
    } else if (step.type === "agent") {
      if (!(step.id in state.stepMocks)) {
        throw new Error(
          `Agent step "${step.id}" requires a mock. Add stepMocks["${step.id}"] to HarnessOptions.`,
        );
      }
      output = validateWorkflowStepOutput(
        step,
        await resolveStepMock(state.stepMocks[step.id], context),
        context,
      );
    } else if (step.type === "tool") {
      if (step.id in state.stepMocks) {
        output = await resolveStepMock(state.stepMocks[step.id], context);
      } else if (state.options.contextOverrides?.runTool) {
        const input =
          typeof step.input === "function"
            ? await step.input(context)
            : (step.input ?? {});
        output = await context.runTool(step.tool, input as HarnessObjectValue);
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
      context.emit(step.event, payload as HarnessObjectValue);
      output = { event: step.event, payload };
    } else if (step.type === "restart") {
      const reason =
        typeof step.reason === "function"
          ? await step.reason(context)
          : (step.reason ?? `${state.workflow.name} requested restart`);
      context.requestRestart(reason);
      output = {
        event: "runtime.restart_requested",
        schemaRef: null,
        payload: { reason },
      };
    } else if (step.type === "trigger") {
      if (step.id in state.stepMocks) {
        output = await resolveStepMock(state.stepMocks[step.id], context);
      } else if (state.options.contextOverrides?.triggerWorkflow) {
        const payload =
          typeof step.payload === "function"
            ? await step.payload(context)
            : (step.payload ?? {});
        output = await context.triggerWorkflow(
          step.workflow,
          payload as HarnessObjectValue,
          step.waitFor ?? "queued",
        );
      } else {
        throw new Error(
          `Trigger step "${step.id}" requires either stepMocks["${step.id}"] or contextOverrides.triggerWorkflow.`,
        );
      }
    } else if (step.type === "approval") {
      const mock = await resolveStepMock(state.stepMocks[step.id], context);
      if (
        mock !== undefined &&
        mock !== null &&
        (mock as { approved?: HarnessOutputValue }).approved === false
      ) {
        const reason = (mock as { reason?: string }).reason;
        throw new Error(
          `Approval step "${step.id}" was rejected${reason ? `: ${reason}` : ""}`,
        );
      }
      const approvalNote =
        mock !== undefined && mock !== null
          ? (mock as { approvalNote?: string }).approvalNote
          : undefined;
      output = {
        approvalId: "harness-approval",
        approved: true,
        resolutionSource: "harness",
        ...(approvalNote && { approvalNote }),
      };
    } else if (step.type === "await-event") {
      if (!(step.id in state.stepMocks)) {
        throw new Error(
          `Await-event step "${step.id}" requires a mock. Add stepMocks["${step.id}"] to HarnessOptions ` +
            `with an AwaitEventStepOutput shape ({ kind: "event", ... } or { kind: "timeout", ... }).`,
        );
      }
      output = await resolveStepMock(state.stepMocks[step.id], context);
    }
  } catch (err) {
    stepError = err instanceof Error ? err.message : String(err);
    status = "failed";
    if (!step.continueOnFailure) state.markFailed(stepError);
  }

  const { harness, internal } = makeStepResult(
    step.id,
    step.type,
    status,
    output,
    stepError,
    undefined,
  );
  if (status === "success" && step.type === "agent") {
    const resolvedHarness = step.harness ?? context.agentRuntime.harness;
    const resolvedModel = step.model ?? (
      step.tier === undefined
        ? context.agentRuntime.preset.defaultModel
        : context.agentRuntime.tiers[step.tier]
    );
    harness.harness = resolvedHarness;
    harness.model = resolvedModel;
    internal.harness = resolvedHarness;
    internal.model = resolvedModel;
  }
  state.recordResult(harness, internal, output);
  if (
    status === "success" &&
    step.type === "code" &&
    step.updatesWorkspaceDir === true
  ) {
    state.workspaceDir = workspaceDirFromStepOutput(step.id, internal.output);
  }
  if (
    status === "success" &&
    step.type === "code" &&
    step.updatesRuntimeResources === true
  ) {
    state.runtimeResources = runtimeResourcesFromStepOutput(
      step.id,
      internal.output,
    );
  }
}
