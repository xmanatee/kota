import type {
  ModuleEventRegistration,
} from "#core/events/module-event.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestCapability,
  ModuleManifestEffectProjection,
  ModuleManifestSetupSnapshot,
} from "#core/modules/module-manifest.js";
import type { WorkflowStep } from "#core/workflow/step-types.js";
import type {
  WorkflowBatchTrigger,
  WorkflowTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { assembleWorkflowGraph } from "./assemble.js";
import type {
  AutomationBatchSummary,
  AutomationBlocker,
  AutomationDownstreamEdge,
  AutomationEffectSummary,
  AutomationEventNode,
  AutomationPolicyGate,
  AutomationSchemaSummary,
  AutomationTriggerSummary,
  AutomationWorkflowNode,
  CompiledAutomationGraph,
} from "./types.js";

export type AssembleCompiledAutomationGraphOptions = {
  moduleManifests?: readonly ModuleCapabilityManifestProjection[];
};

type ManifestEffect = {
  moduleName: string;
  effect: ModuleManifestEffectProjection;
};

type CapabilityEntry = {
  moduleName: string;
  capability: ModuleManifestCapability;
  setups: readonly ModuleManifestSetupSnapshot[];
};

type ManifestLookups = {
  toolEffects: ReadonlyMap<string, ManifestEffect>;
  workflowEffects: ReadonlyMap<string, readonly ManifestEffect[]>;
  capabilities: ReadonlyMap<string, CapabilityEntry>;
};

function filterString(filter: WorkflowTrigger["filter"]): string | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  return Object.entries(filter)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
}

function batchSummary(batch: WorkflowBatchTrigger): AutomationBatchSummary {
  return {
    ...(batch.maxCount !== undefined ? { maxCount: batch.maxCount } : {}),
    ...(batch.maxAgeMs !== undefined ? { maxAgeMs: batch.maxAgeMs } : {}),
    ...(batch.idleTimeoutMs !== undefined ? { idleTimeoutMs: batch.idleTimeoutMs } : {}),
    groupBy: batch.groupBy,
    ...(batch.flushEvent !== undefined ? { flushEvent: batch.flushEvent } : {}),
    maxBufferSize: batch.maxBufferSize,
    overflow: batch.overflow,
  };
}

function schemaSummaryForEvent(
  eventName: string,
  trigger?: WorkflowTrigger,
): AutomationSchemaSummary | undefined {
  const registered = getModuleEventRegistry()?.get(eventName);
  if (registered) return schemaSummaryFromRegistration(registered);
  if (trigger?.schemaVersion === undefined) return undefined;
  return {
    name: eventName,
    version: trigger.schemaVersion,
    declared: false,
    filterablePaths: [],
  };
}

function schemaSummaryFromRegistration(
  registration: ModuleEventRegistration,
): AutomationSchemaSummary {
  return {
    name: registration.name,
    version: registration.currentVersion,
    declared: true,
    scope: registration.scope,
    module: registration.module,
    sensitivity: registration.sensitivity,
    filterablePaths: registration.filterablePaths,
    payloadSchema: registration.payloadSchema,
  };
}

function buildLookups(
  manifests: readonly ModuleCapabilityManifestProjection[],
): ManifestLookups {
  const toolEffects = new Map<string, ManifestEffect>();
  const workflowEffects = new Map<string, ManifestEffect[]>();
  const capabilities = new Map<string, CapabilityEntry>();

  for (const manifest of manifests) {
    for (const capability of manifest.capabilities) {
      const setups = manifest.contributions.setupRequirements.filter((setup) =>
        capability.setupRequirementIds?.includes(setup.id)
      );
      capabilities.set(capability.id, {
        moduleName: manifest.moduleName,
        capability,
        setups,
      });
    }

    for (const effect of manifest.effects) {
      const entry = { moduleName: manifest.moduleName, effect };
      if (effect.source === "tool" && !toolEffects.has(effect.target)) {
        toolEffects.set(effect.target, entry);
      }
      if (effect.source === "workflow") {
        const list = workflowEffects.get(effect.target) ?? [];
        workflowEffects.set(effect.target, [...list, entry]);
      }
    }
  }

  return { toolEffects, workflowEffects, capabilities };
}

function automationEffectSummary(entry: ManifestEffect): AutomationEffectSummary {
  return {
    moduleName: entry.moduleName,
    effectId: entry.effect.id,
    source: entry.effect.source,
    target: entry.effect.target,
    risk: entry.effect.risk,
    categories: entry.effect.categories,
    capabilityIds: entry.effect.capabilityIds,
    effect: {
      kind: entry.effect.effect.kind,
      scope: entry.effect.effect.scope,
      openWorld: entry.effect.effect.openWorld,
    },
    simulation: entry.effect.simulation,
  };
}

function effectPolicyGates(
  workflowName: string,
  effect: AutomationEffectSummary,
  lookups: ManifestLookups,
): AutomationPolicyGate[] {
  const gates: AutomationPolicyGate[] = [];
  for (const capabilityId of effect.capabilityIds) {
    const capability = lookups.capabilities.get(capabilityId);
    if (!capability) {
      gates.push({
        kind: "scope-policy",
        source: workflowName,
        outcome: "unknown",
        reason: `capability "${capabilityId}" is referenced by ${effect.effectId}, but its manifest entry is unavailable`,
        capabilityIds: [capabilityId],
      });
      continue;
    }
    for (const hook of capability.capability.scopePolicyHooks) {
      gates.push({
        kind: hook === "setup"
          ? "setup"
          : hook === "owner-confirmation"
            ? "owner-confirmation"
            : "scope-policy",
        source: capability.moduleName,
        outcome: hook === "owner-confirmation" ? "confirm" : "unknown",
        reason: `${capability.moduleName}.${capability.capability.id} participates in ${hook} policy`,
        capabilityIds: [capabilityId],
        setupRequirementIds: capability.capability.setupRequirementIds,
      });
    }
  }
  if (effect.simulation.blocked) {
    gates.push({
      kind: "simulation",
      source: effect.moduleName,
      outcome: "block",
      reason: effect.simulation.reason ?? "effect is blocked in simulation",
      capabilityIds: effect.capabilityIds,
    });
  }
  return gates;
}

function setupBlockers(
  workflowName: string,
  effect: AutomationEffectSummary,
  lookups: ManifestLookups,
): AutomationBlocker[] {
  const blockers: AutomationBlocker[] = [];
  for (const capabilityId of effect.capabilityIds) {
    const capability = lookups.capabilities.get(capabilityId);
    if (!capability) continue;
    for (const setup of capability.setups) {
      if (!setup.required) continue;
      const state = setup.availability?.state ?? "unknown";
      if (state === "ready") continue;
      blockers.push({
        kind: "setup",
        workflow: workflowName,
        moduleName: capability.moduleName,
        capabilityIds: [capabilityId],
        setupRequirementId: setup.id,
        state,
        reason: setup.availability?.message ??
          `setup status for ${capability.moduleName}.${setup.id} is unavailable`,
      });
    }
  }
  return blockers;
}

function ownerBlockers(
  workflowName: string,
  gates: readonly AutomationPolicyGate[],
): AutomationBlocker[] {
  return gates.flatMap((gate) =>
    gate.kind === "owner-confirmation"
      ? [{
          kind: "owner-confirmation" as const,
          workflow: workflowName,
          capabilityIds: gate.capabilityIds,
          reason: gate.reason,
        }]
      : []
  );
}

function collectStepEffects(
  steps: readonly WorkflowStep[],
  lookups: ManifestLookups,
): AutomationEffectSummary[] {
  const effects: AutomationEffectSummary[] = [];
  function walk(items: readonly WorkflowStep[]): void {
    for (const step of items) {
      if (step.type === "tool") {
        const effect = lookups.toolEffects.get(step.tool);
        if (effect) effects.push(automationEffectSummary(effect));
      } else if (step.type === "parallel" || step.type === "foreach") {
        walk(step.steps);
      } else if (step.type === "branch") {
        walk(step.ifTrue);
        walk(step.ifFalse);
      }
    }
  }
  walk(steps);
  return effects;
}

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

function buildConsumersByEvent(
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

function automationTriggerSummary(
  trigger: WorkflowTrigger,
  index: number,
): AutomationTriggerSummary {
  return {
    index,
    event: trigger.event,
    schema: schemaSummaryForEvent(trigger.event, trigger),
    filter: filterString(trigger.filter),
    cooldownMs: trigger.cooldownMs,
    ...(trigger.batch ? { batch: batchSummary(trigger.batch) } : {}),
    policies: [
      {
        kind: "idempotency",
        source: "workflow-dispatch",
        outcome: "unknown",
        reason: "dispatch idempotency is resolved at enqueue time from eventId, idempotencyKey, or batch input events",
      },
    ],
  };
}

function buildAutomationWorkflow(
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

function buildAutomationEvents(
  graph: CompiledAutomationGraph,
): AutomationEventNode[] {
  const registry = getModuleEventRegistry();
  const eventNames = new Set<string>(graph.events.map((event) => event.name));
  for (const registration of registry?.all().values() ?? []) {
    eventNames.add(registration.name);
  }
  return [...eventNames]
    .sort()
    .map((name) => {
      const event = graph.events.find((candidate) => candidate.name === name);
      const registered = registry?.get(name);
      return {
        name,
        producers: event?.producers ?? [],
        consumers: event?.consumers ?? [],
        ...(registered ? { schema: schemaSummaryFromRegistration(registered) } : {}),
      };
    });
}

export function assembleCompiledAutomationGraph(
  definitions: readonly WorkflowDefinition[],
  options: AssembleCompiledAutomationGraphOptions = {},
): CompiledAutomationGraph {
  const base = assembleWorkflowGraph(definitions, {
    moduleManifests: options.moduleManifests,
  });
  const graph: CompiledAutomationGraph = {
    ...base,
    automation: {
      workflows: [],
      events: [],
      blockers: [],
      downstream: [],
    },
  };
  const lookups = buildLookups(options.moduleManifests ?? []);
  const consumersByEvent = buildConsumersByEvent(definitions);
  const workflows = definitions.map((definition) =>
    buildAutomationWorkflow(definition, graph, lookups, consumersByEvent)
  );
  const downstream = workflows.flatMap((workflow) => workflow.downstream);
  const blockers = workflows.flatMap((workflow) => workflow.blockers);
  return {
    ...graph,
    automation: {
      workflows,
      events: buildAutomationEvents(graph),
      blockers,
      downstream,
    },
  };
}
