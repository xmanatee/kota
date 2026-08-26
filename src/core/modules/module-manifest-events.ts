import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowTriggerInput } from "#core/workflow/trigger-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type {
  ModuleManifestEventConsumer,
  ModuleManifestEventProducer,
  ModuleManifestEventProjection,
} from "./module-manifest.js";

function triggerEventName(trigger: WorkflowTriggerInput): string | undefined {
  if (trigger.watch) return "files.changed";
  if (trigger.webhook) return "webhook";
  if (trigger.schedule || trigger.intervalMs !== undefined) return undefined;
  return trigger.event;
}

function triggerFilterLabel(trigger: WorkflowTriggerInput): string | undefined {
  if (!trigger.filter || Object.keys(trigger.filter).length === 0) return undefined;
  return Object.entries(trigger.filter)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
}

type MutableEventProjection = {
  declared: boolean;
  producers: ModuleManifestEventProducer[];
  consumers: ModuleManifestEventConsumer[];
};

function getOrCreateEventProjection(
  map: Map<string, MutableEventProjection>,
  eventName: string,
): MutableEventProjection {
  let projection = map.get(eventName);
  if (projection) return projection;
  projection = { declared: false, producers: [], consumers: [] };
  map.set(eventName, projection);
  return projection;
}

function collectStepEventFlows(
  workflowName: string,
  steps: readonly WorkflowStepInput[],
  eventMap: Map<string, MutableEventProjection>,
): void {
  for (const step of steps) {
    switch (step.type) {
      case "emit":
        getOrCreateEventProjection(eventMap, step.event).producers.push({
          workflow: workflowName,
          stepId: step.id,
        });
        break;
      case "await-event":
        getOrCreateEventProjection(eventMap, step.event).consumers.push({
          workflow: workflowName,
          source: "await-event",
          stepId: step.id,
        });
        break;
      case "branch":
        collectStepEventFlows(workflowName, step.ifTrue, eventMap);
        if (step.ifFalse) {
          collectStepEventFlows(workflowName, step.ifFalse, eventMap);
        }
        break;
      case "agent":
      case "approval":
      case "code":
      case "foreach":
      case "parallel":
      case "restart":
      case "tool":
      case "trigger":
        break;
    }
  }
}

export function buildModuleManifestEventFlows(args: {
  declaredEventNames: readonly string[];
  workflows: readonly RegisteredWorkflowDefinitionInput[];
}): ModuleManifestEventProjection[] {
  const eventMap = new Map<string, MutableEventProjection>();
  for (const eventName of args.declaredEventNames) {
    getOrCreateEventProjection(eventMap, eventName).declared = true;
  }
  for (const workflow of args.workflows) {
    for (const trigger of workflow.triggers) {
      const eventName = triggerEventName(trigger);
      if (!eventName) continue;
      const consumer: ModuleManifestEventConsumer = {
        workflow: workflow.name,
        source: "trigger",
        ...(triggerFilterLabel(trigger) !== undefined
          ? { filter: triggerFilterLabel(trigger) }
          : {}),
      };
      getOrCreateEventProjection(eventMap, eventName).consumers.push(consumer);
    }
    collectStepEventFlows(workflow.name, workflow.steps, eventMap);
  }
  return [...eventMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, projection]) => ({
      name,
      declared: projection.declared,
      producers: projection.producers,
      consumers: projection.consumers,
    }));
}
