import type { WorkflowPredicate, WorkflowStepContext } from "../../core/workflow/run-types.js";
import type { WorkflowDefinition, WorkflowStep } from "../../core/workflow/types.js";

export type DryRunWhenResult = "runs" | "skipped" | "error" | "no-condition";

export type DryRunStepPlan = {
  id: string;
  type: WorkflowStep["type"];
  config: string;
  whenResult: DryRunWhenResult;
  whenError?: string;
  /** Branch steps only: result of evaluating the condition predicate. */
  conditionResult?: DryRunWhenResult;
  conditionError?: string;
  children?: DryRunStepPlan[];
};

export type DryRunPlan = {
  name: string;
  definitionPath: string;
  steps: DryRunStepPlan[];
};

function makeDryRunContext(definition: WorkflowDefinition): WorkflowStepContext {
  return {
    projectDir: process.cwd(),
    workflow: {
      name: definition.name,
      definitionPath: definition.definitionPath,
      runId: "dry-run",
      runDir: "dry-run",
      runDirPath: process.cwd(),
    },
    trigger: { event: "dry-run", payload: {} },
    previousOutput: undefined,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runTool: () => Promise.reject(new Error("dry-run: tools cannot be executed")),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: (): never => {
      throw new Error("dry-run: runtime state unavailable");
    },
    triggerWorkflow: () => Promise.reject(new Error("dry-run: triggerWorkflow cannot be executed")),
  };
}

async function evalWhen(
  predicate: WorkflowPredicate | undefined,
  context: WorkflowStepContext,
): Promise<{ result: DryRunWhenResult; error?: string }> {
  if (!predicate) return { result: "no-condition" };
  try {
    const value = await predicate(context);
    return { result: value ? "runs" : "skipped" };
  } catch (err) {
    return {
      result: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function stepConfig(step: WorkflowStep): string {
  switch (step.type) {
    case "agent": {
      const parts: string[] = [`prompt: ${step.promptPath}`];
      if (step.model) parts.unshift(step.model);
      if (step.retry) parts.push(`retry: ${step.retry.maxAttempts}x`);
      return `agent, ${parts.join(", ")}`;
    }
    case "tool":
      return step.retry
        ? `tool: ${step.tool}, retry: ${step.retry.maxAttempts}x`
        : `tool: ${step.tool}`;
    case "emit":
      return `emit: ${step.event}`;
    case "restart":
      return `restart, requires: ${step.requires.join(", ")}`;
    case "code":
      return "code";
    case "parallel":
      return `parallel (${step.steps.length} steps)`;
    case "trigger":
      return `trigger: ${step.workflow} (waitFor: ${step.waitFor})`;
    case "branch":
      return `branch (ifTrue: ${step.ifTrue.length} step(s), ifFalse: ${step.ifFalse.length} step(s))`;
    case "foreach":
      return `foreach (${step.steps.length} inner step(s), as: ${step.as})`;
    case "approval":
      return step.reason ? `approval: ${step.reason}` : "approval";
  }
}

export async function buildDryRunPlan(definition: WorkflowDefinition): Promise<DryRunPlan> {
  const context = makeDryRunContext(definition);
  const steps: DryRunStepPlan[] = [];

  for (const step of definition.steps) {
    const { result, error } = await evalWhen(step.when, context);
    const plan: DryRunStepPlan = {
      id: step.id,
      type: step.type,
      config: stepConfig(step),
      whenResult: result,
      whenError: error,
    };

    if (step.type === "parallel") {
      plan.children = await Promise.all(
        step.steps.map(async (child) => {
          const { result: cr, error: ce } = await evalWhen(child.when, context);
          return {
            id: child.id,
            type: "code" as const,
            config: "code",
            whenResult: cr,
            whenError: ce,
          };
        }),
      );
    } else if (step.type === "branch") {
      let conditionResult: DryRunWhenResult = "no-condition";
      let conditionError: string | undefined;
      try {
        const val = await step.condition(context);
        conditionResult = val ? "runs" : "skipped";
      } catch (err) {
        conditionResult = "error";
        conditionError = err instanceof Error ? err.message : String(err);
      }
      const buildArmPlans = async (armSteps: typeof step.ifTrue, label: string): Promise<DryRunStepPlan[]> =>
        Promise.all(
          armSteps.map(async (armStep) => {
            const { result: wr, error: we } = await evalWhen(armStep.when, context);
            return {
              id: armStep.id,
              type: armStep.type,
              config: `${label}: ${stepConfig(armStep)}`,
              whenResult: wr,
              whenError: we,
            } satisfies DryRunStepPlan;
          }),
        );
      plan.conditionResult = conditionResult;
      plan.conditionError = conditionError;
      plan.children = [
        ...(await buildArmPlans(step.ifTrue, "ifTrue")),
        ...(await buildArmPlans(step.ifFalse, "ifFalse")),
      ];
    }

    steps.push(plan);
  }

  return { name: definition.name, definitionPath: definition.definitionPath, steps };
}

function formatWhenNote(step: DryRunStepPlan): string {
  switch (step.whenResult) {
    case "no-condition":
      return "";
    case "runs":
      return "  (when: true with empty context)";
    case "skipped":
      return "  (when: false with empty context — would skip)";
    case "error":
      return `  (when: error — ${step.whenError})`;
  }
}

export function formatDryRunPlan(plan: DryRunPlan): string {
  const lines: string[] = [];
  lines.push(`Dry run: ${plan.name}`);
  lines.push(`Definition: ${plan.definitionPath}`);

  let n = 0;
  function countAll(steps: DryRunStepPlan[]): number {
    return steps.reduce(
      (sum, s) => sum + 1 + (s.children?.length ?? 0),
      0,
    );
  }
  lines.push(`Steps (${countAll(plan.steps)}):`);

  let idx = 1;
  for (const step of plan.steps) {
    n = idx;
    const whenNote = formatWhenNote(step);
    lines.push(`  ${String(n).padStart(2)}. ${step.id.padEnd(28)} [${step.config}]${whenNote}`);
    idx++;

    if (step.children) {
      for (const child of step.children) {
        const childWhenNote = formatWhenNote(child);
        lines.push(
          `      ${String(idx).padStart(2)}. ${child.id.padEnd(24)} [${child.config}]${childWhenNote}`,
        );
        idx++;
      }
    }
  }

  return lines.join("\n");
}
