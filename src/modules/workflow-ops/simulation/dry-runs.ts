import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  buildDryRunPlan,
  type DryRunResult,
} from "../execution/dry-run.js";
import type { AutomationExplainResult } from "../graph/index.js";
import {
  envelopeForDryRun,
  type SimulationEvent,
} from "./events.js";
import type { WorkflowSimulationDryRun } from "./types.js";

function findDefinition(
  definitions: readonly WorkflowDefinition[],
  workflow: string,
): WorkflowDefinition | null {
  return definitions.find((definition) => definition.name === workflow) ?? null;
}

function dryRunSummary(
  workflow: string,
  result: DryRunResult,
): WorkflowSimulationDryRun {
  return {
    workflow,
    pass: result.pass,
    diagnostics: result.diagnostics,
    ...(result.triggerMatch ? { triggerMatch: result.triggerMatch } : {}),
    steps: result.steps,
  };
}

export async function dryRunsForMatches(
  definitions: readonly WorkflowDefinition[],
  event: SimulationEvent,
  explain: AutomationExplainResult,
  availableToolNames?: ReadonlySet<string>,
): Promise<WorkflowSimulationDryRun[]> {
  const dryRuns: WorkflowSimulationDryRun[] = [];
  for (const match of explain.matches) {
    const definition = findDefinition(definitions, match.workflow);
    if (!definition) continue;
    const plan = await buildDryRunPlan(definition, {
      eventEnvelope: envelopeForDryRun(event),
      ...(availableToolNames ? { availableToolNames } : {}),
    });
    dryRuns.push(dryRunSummary(match.workflow, plan));
  }
  return dryRuns;
}
