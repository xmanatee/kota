import type { WorkflowStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  automationEffectSummary,
  collectStepEffects,
  effectPolicyGates,
  type ManifestLookups,
  ownerBlockers,
  setupBlockers,
} from "./explain-effects.js";
import { automationTriggerSummary } from "./explain-triggers.js";
import type {
  AutomationBlocker,
  AutomationDownstreamEdge,
  AutomationPolicyGate,
  AutomationWorkflowNode,
  CompiledAutomationGraph,
} from "./types.js";

function collectApprovalGates(steps: readonly WorkflowStep[]): AutomationPolicyGate[] {
  const gates: AutomationPolicyGate[] = [];
  function walk(items: readonly WorkflowStep[]): void {
    for (const step of items) {
      if (step.type === "approval") {
        gates.push({
          kind: "approval",
          source: "workflow-step",
          outcome: "confirm",
          reason: step.reason ?? "workflow approval step requires operator confirmation",
          stepId: step.id,
        });
      } else if (step.type === "parallel" || step.type === "foreach") {
        walk(step.steps);
      } else if (step.type === "branch") {
        walk(step.ifTrue);
        walk(step.ifFalse);
      }
    }
  }
  walk(steps);
  return gates;
}

function collectApprovalBlockers(
  workflowName: string,
  gates: readonly AutomationPolicyGate[],
): AutomationBlocker[] {
  return gates.flatMap((gate) =>
    gate.kind === "approval"
      ? [{
          kind: "approval" as const,
          workflow: workflowName,
          stepId: gate.stepId,
          reason: gate.reason,
        }]
      : []
  );
}

function collectDownstream(
  workflowName: string,
  steps: readonly WorkflowStep[],
  consumersByEvent: ReadonlyMap<string, readonly string[]>,
): AutomationDownstreamEdge[] {
  const edges: AutomationDownstreamEdge[] = [];
  function walk(items: readonly WorkflowStep[]): void {
    for (const step of items) {
      if (step.type === "emit") {
        edges.push({
          fromWorkflow: workflowName,
          kind: "event",
          target: step.event,
          consumers: consumersByEvent.get(step.event) ?? [],
          stepId: step.id,
        });
      } else if (step.type === "trigger") {
        edges.push({
          fromWorkflow: workflowName,
          kind: "workflow",
          target: step.workflow,
          consumers: [step.workflow],
          stepId: step.id,
        });
      } else if (step.type === "branch") {
        walk(step.ifTrue);
        walk(step.ifFalse);
      }
    }
  }
  walk(steps);
  return edges;
}

export function buildConsumersByEvent(
  definitions: readonly WorkflowDefinition[],
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const definition of definitions) {
    for (const trigger of definition.triggers) {
      const list = map.get(trigger.event) ?? [];
      if (!list.includes(definition.name)) map.set(trigger.event, [...list, definition.name]);
      if (trigger.batch?.flushEvent) {
        const flushList = map.get(trigger.batch.flushEvent) ?? [];
        if (!flushList.includes(definition.name)) {
          map.set(trigger.batch.flushEvent, [...flushList, definition.name]);
        }
      }
    }
  }
  return map;
}

export function buildAutomationWorkflow(
  definition: WorkflowDefinition,
  graph: CompiledAutomationGraph,
  lookups: ManifestLookups,
  consumersByEvent: ReadonlyMap<string, readonly string[]>,
): AutomationWorkflowNode {
  const graphWorkflow = graph.workflows.find((workflow) => workflow.name === definition.name);
  const workflowManifestEffects = lookups.workflowEffects.get(definition.name) ?? [];
  const effects = [
    ...collectStepEffects(definition.steps, lookups),
    ...workflowManifestEffects.map(automationEffectSummary),
  ];
  const effectGates = effects.flatMap((effect) =>
    effectPolicyGates(definition.name, effect, lookups)
  );
  const approvalGates = collectApprovalGates(definition.steps);
  const policyGates = [
    ...definition.triggers.flatMap((trigger, index) =>
      automationTriggerSummary(trigger, index).policies
    ),
    ...effectGates,
    ...approvalGates,
  ];
  const blockers = [
    ...effects.flatMap((effect) => setupBlockers(definition.name, effect, lookups)),
    ...ownerBlockers(definition.name, effectGates),
    ...collectApprovalBlockers(definition.name, approvalGates),
  ];

  return {
    name: definition.name,
    definitionPath: definition.definitionPath,
    enabled: definition.enabled,
    triggers: definition.triggers.map(automationTriggerSummary),
    steps: graphWorkflow?.steps ?? [],
    effects,
    policyGates,
    blockers,
    downstream: collectDownstream(definition.name, definition.steps, consumersByEvent),
  };
}
