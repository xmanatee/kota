import type { WorkflowPredicate, WorkflowStepContext } from "../workflow/run-types.js";
import type { WorkflowDefinition, WorkflowStep } from "../workflow/types.js";

export type DryRunWhenResult = "runs" | "skipped" | "error" | "no-condition";

export type DryRunStepPlan = {
  id: string;
  type: WorkflowStep["type"];
  config: string;
  whenResult: DryRunWhenResult;
  whenError?: string;
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
          `      ${String(idx).padStart(2)}. ${child.id.padEnd(24)} [code]${childWhenNote}`,
        );
        idx++;
      }
    }
  }

  return lines.join("\n");
}
