import { matchesFilter } from "#core/workflow/run-executor-utils.js";
import type { WorkflowPredicate, WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowDefinition, WorkflowStep, WorkflowTrigger } from "#core/workflow/types.js";

export type DryRunWhenResult = "runs" | "skipped" | "error" | "no-condition";

export type DryRunDiagnostic = {
  level: "error" | "warning";
  stepId?: string;
  message: string;
};

export type DryRunTriggerMatch = {
  matched: boolean;
  matchedEvent?: string;
  matchedFilter?: Record<string, unknown>;
};

export type DryRunStepPlan = {
  id: string;
  type: WorkflowStep["type"];
  config: string;
  whenResult: DryRunWhenResult;
  whenError?: string;
  conditionResult?: DryRunWhenResult;
  conditionError?: string;
  children?: DryRunStepPlan[];
};

export type DryRunPlan = {
  name: string;
  definitionPath: string;
  steps: DryRunStepPlan[];
};

export type DryRunResult = DryRunPlan & {
  pass: boolean;
  diagnostics: DryRunDiagnostic[];
  triggerMatch?: DryRunTriggerMatch;
};

export type DryRunOptions = {
  payload?: Record<string, unknown>;
  availableToolNames?: ReadonlySet<string>;
};

function makeDryRunContext(
  definition: WorkflowDefinition,
  payload?: Record<string, unknown>,
): WorkflowStepContext {
  return {
    projectDir: process.cwd(),
    workflow: {
      name: definition.name,
      definitionPath: definition.definitionPath,
      runId: "dry-run",
      runDir: "dry-run",
      runDirPath: process.cwd(),
    },
    trigger: { event: payload ? "dry-run" : "dry-run", payload: payload ?? {} },
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

function checkToolAvailability(
  step: WorkflowStep,
  availableToolNames: ReadonlySet<string>,
  diagnostics: DryRunDiagnostic[],
): void {
  if (step.type === "tool" && !availableToolNames.has(step.tool)) {
    diagnostics.push({
      level: "error",
      stepId: step.id,
      message: `tool "${step.tool}" is not registered`,
    });
  }
  if (step.type === "parallel") {
    for (const child of step.steps) {
      checkToolAvailability(child, availableToolNames, diagnostics);
    }
  }
  if (step.type === "branch") {
    for (const child of [...step.ifTrue, ...step.ifFalse]) {
      checkToolAvailability(child, availableToolNames, diagnostics);
    }
  }
  if (step.type === "foreach") {
    for (const child of step.steps) {
      checkToolAvailability(child, availableToolNames, diagnostics);
    }
  }
}

function resolveTriggerMatch(
  triggers: WorkflowTrigger[],
  payload: Record<string, unknown>,
): DryRunTriggerMatch {
  for (const trigger of triggers) {
    if (trigger.event && matchesFilter(trigger.filter, payload)) {
      return {
        matched: true,
        matchedEvent: trigger.event,
        ...(trigger.filter && { matchedFilter: trigger.filter }),
      };
    }
  }
  return { matched: false };
}

export async function buildDryRunPlan(
  definition: WorkflowDefinition,
  options: DryRunOptions = {},
): Promise<DryRunResult> {
  const context = makeDryRunContext(definition, options.payload);
  const diagnostics: DryRunDiagnostic[] = [];
  const steps: DryRunStepPlan[] = [];

  if (options.availableToolNames) {
    for (const step of definition.steps) {
      checkToolAvailability(step, options.availableToolNames, diagnostics);
    }
  }

  let triggerMatch: DryRunTriggerMatch | undefined;
  if (options.payload) {
    triggerMatch = resolveTriggerMatch(definition.triggers, options.payload);
    if (!triggerMatch.matched) {
      diagnostics.push({
        level: "error",
        message: "no trigger matches the provided payload",
      });
    }
  }

  for (const step of definition.steps) {
    const { result, error } = await evalWhen(step.when, context);
    const plan: DryRunStepPlan = {
      id: step.id,
      type: step.type,
      config: stepConfig(step),
      whenResult: result,
      whenError: error,
    };

    if (result === "error") {
      diagnostics.push({
        level: "warning",
        stepId: step.id,
        message: `when predicate error: ${error}`,
      });
    }

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

  const hasErrors = diagnostics.some((d) => d.level === "error");

  return {
    name: definition.name,
    definitionPath: definition.definitionPath,
    steps,
    pass: !hasErrors,
    diagnostics,
    ...(triggerMatch && { triggerMatch }),
  };
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

export function formatDryRunResult(result: DryRunResult): string {
  const lines: string[] = [formatDryRunPlan(result)];

  if (result.triggerMatch) {
    lines.push("");
    if (result.triggerMatch.matched) {
      lines.push(`Trigger: matched (event: ${result.triggerMatch.matchedEvent})`);
    } else {
      lines.push("Trigger: no match for provided payload");
    }
  }

  if (result.diagnostics.length > 0) {
    lines.push("");
    lines.push("Diagnostics:");
    for (const d of result.diagnostics) {
      const prefix = d.level === "error" ? "ERROR" : "WARN";
      const stepNote = d.stepId ? ` [${d.stepId}]` : "";
      lines.push(`  ${prefix}${stepNote}: ${d.message}`);
    }
  }

  lines.push("");
  lines.push(result.pass ? "Result: PASS" : "Result: FAIL");
  return lines.join("\n");
}
