import type {
  ModuleEventPayloadObject,
  ModuleEventRegistration,
} from "#core/events/module-event.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import { validatePayloadAgainstSchema } from "#core/events/module-event-payload-validation.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestCapability,
  ModuleManifestEffectProjection,
  ModuleManifestSetupSnapshot,
} from "#core/modules/module-manifest.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { matchesFilter } from "#core/workflow/run-executor-utils.js";
import type { WorkflowStep } from "#core/workflow/step-types.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchTrigger,
  type WorkflowRunTrigger,
  type WorkflowTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { formatDuration } from "../utils.js";
import { assembleWorkflowGraph } from "./assemble.js";
import type {
  AutomationBatchSummary,
  AutomationBlocker,
  AutomationDownstreamEdge,
  AutomationEffectSummary,
  AutomationEventNode,
  AutomationExplainOptions,
  AutomationExplainReason,
  AutomationExplainResult,
  AutomationExplainSampleEvent,
  AutomationExplainWorkflowMatch,
  AutomationPolicyGate,
  AutomationSchemaSummary,
  AutomationTriggerSummary,
  AutomationWorkflowNode,
  CompiledAutomationGraph,
} from "./types.js";

export type AssembleCompiledAutomationGraphOptions = {
  moduleManifests?: readonly ModuleCapabilityManifestProjection[];
};

type Payload = WorkflowRunTrigger["payload"];
type PayloadValue = Payload[string];
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
type MatchCandidate = {
  definition: WorkflowDefinition;
  workflow: AutomationWorkflowNode;
  trigger: AutomationTriggerSummary;
  sourceTrigger: WorkflowTrigger;
  sourceKind: "event" | "batch-flush";
  filterState: "matched" | "not-required" | "not-evaluated";
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

function payloadPathValue(payload: Payload, path: string): PayloadValue {
  const segments = path.split(".");
  let current: Payload | PayloadValue = payload;
  for (const segment of segments) {
    if (!isPayloadObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isPayloadObject(value: Payload | PayloadValue): value is Payload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function payloadString(payload: Payload, path: string): string | undefined {
  const value = payloadPathValue(payload, path);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function payloadBoolean(payload: Payload, path: string): boolean | undefined {
  const value = payloadPathValue(payload, path);
  return typeof value === "boolean" ? value : undefined;
}

function payloadNumber(payload: Payload, path: string): number | undefined {
  const value = payloadPathValue(payload, path);
  return typeof value === "number" ? value : undefined;
}

function sourceIgnoredReason(sample: AutomationExplainSampleEvent): string | null {
  const trust = payloadString(sample.payload, "actor.trust");
  if (trust === "blocked") return "actor.trust is blocked";
  const status =
    payloadString(sample.payload, "sourceStatus") ??
    payloadString(sample.payload, "source.status");
  if (status === "blocked" || status === "archived") {
    return `source status is ${status}`;
  }
  const archived =
    payloadBoolean(sample.payload, "archived") ??
    payloadBoolean(sample.payload, "source.archived");
  return archived === true ? "source is archived" : null;
}

function idempotencyDuplicateReason(sample: AutomationExplainSampleEvent): string | null {
  const status = payloadString(sample.payload, "idempotencyStatus");
  if (status === "replayed" || status === "ignored") {
    return `event idempotency status is ${status}`;
  }
  return null;
}

function idempotencyRejectedReason(sample: AutomationExplainSampleEvent): string | null {
  const status = payloadString(sample.payload, "idempotencyStatus");
  return status === "rejected" ? "event idempotency status is rejected" : null;
}

function schemaError(sample: AutomationExplainSampleEvent): string | null {
  const registration = getModuleEventRegistry()?.get(sample.event);
  if (!registration) return null;
  return validatePayloadAgainstSchema(
    registration.payloadSchema,
    sample.payload as ModuleEventPayloadObject,
  );
}

function candidateMatchesEvent(
  sampleEventName: string,
  workflow: AutomationWorkflowNode,
  trigger: AutomationTriggerSummary,
  sourceTrigger: WorkflowTrigger,
  sample?: AutomationExplainSampleEvent,
): "event" | "batch-flush" | null {
  if (sourceTrigger.event === sampleEventName) return "event";
  if (sourceTrigger.batch?.flushEvent === sampleEventName) return "batch-flush";
  if (
    sourceTrigger.batch &&
    sampleEventName === WORKFLOW_BATCH_FLUSH_EVENT &&
    payloadString(sample?.payload ?? {}, "batch.workflow") === workflow.name
  ) {
    const triggerIndex = payloadNumber(sample?.payload ?? {}, "batch.triggerIndex");
    if (triggerIndex !== undefined && triggerIndex !== trigger.index) return null;
    const sourceEventName = payloadString(sample?.payload ?? {}, "sourceEventName") ??
      payloadString(sample?.payload ?? {}, "batch.sourceEventName");
    if (sourceEventName !== undefined && sourceEventName !== sourceTrigger.event) {
      return null;
    }
    return "batch-flush";
  }
  return null;
}

function matchingCandidates(
  definitions: readonly WorkflowDefinition[],
  graph: CompiledAutomationGraph,
  eventName: string,
  workflowName?: string,
  sample?: AutomationExplainSampleEvent,
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const definition of definitions) {
    if (workflowName && definition.name !== workflowName) continue;
    const workflow = graph.automation.workflows.find((entry) => entry.name === definition.name);
    if (!workflow || !workflow.enabled) continue;
    for (let index = 0; index < definition.triggers.length; index++) {
      const sourceTrigger = definition.triggers[index]!;
      const trigger = workflow.triggers[index]!;
      const sourceKind = candidateMatchesEvent(
        eventName,
        workflow,
        trigger,
        sourceTrigger,
        sample,
      );
      if (!sourceKind) continue;
      if (sample && sourceKind === "event" && !matchesFilter(sourceTrigger.filter, sample.payload)) {
        continue;
      }
      const hasEvaluatedFilter =
        sourceKind === "event" &&
        sourceTrigger.filter !== undefined &&
        Object.keys(sourceTrigger.filter).length > 0;
      const filterState = hasEvaluatedFilter
        ? sample ? "matched" : "not-evaluated"
        : "not-required";
      candidates.push({ definition, workflow, trigger, sourceTrigger, sourceKind, filterState });
    }
  }
  return candidates;
}

function explainMatch(candidate: MatchCandidate): AutomationExplainWorkflowMatch {
  return {
    workflow: candidate.workflow.name,
    triggerIndex: candidate.trigger.index,
    triggerEvent: candidate.trigger.event,
    matchedFilter: candidate.filterState !== "not-evaluated",
    ...(candidate.trigger.batch ? { batch: candidate.trigger.batch } : {}),
    effects: candidate.workflow.effects,
    blockers: candidate.workflow.blockers,
    downstream: candidate.workflow.downstream,
  };
}

function reasonsForCandidates(
  candidates: readonly MatchCandidate[],
  sample: AutomationExplainSampleEvent | undefined,
): AutomationExplainReason[] {
  return candidates.map((candidate) => {
    if (!sample && candidate.filterState === "not-evaluated") {
      return {
        code: "filter-payload-required",
        severity: "warning",
        workflow: candidate.workflow.name,
        event: candidate.trigger.event,
        triggerIndex: candidate.trigger.index,
        message: `trigger ${candidate.trigger.index} for ${candidate.workflow.name} has filter ${candidate.trigger.filter}; provide a sample payload to determine whether it matches`,
      };
    }
    if (!sample) {
      return {
        code: "sample-payload-required",
        severity: "warning",
        workflow: candidate.workflow.name,
        event: candidate.trigger.event,
        triggerIndex: candidate.trigger.index,
        message: `event type reaches trigger ${candidate.trigger.index} for ${candidate.workflow.name}; provide a sample payload to determine queue, batch, or dead-letter outcome`,
      };
    }
    return {
      code: candidate.sourceKind === "batch-flush" ? "batch-flush-match" : "trigger-match",
      severity: "info",
      workflow: candidate.workflow.name,
      event: candidate.trigger.event,
      triggerIndex: candidate.trigger.index,
      message: candidate.sourceKind === "batch-flush"
        ? `event flushes batch trigger ${candidate.trigger.index} for ${candidate.workflow.name}`
        : `event matches trigger ${candidate.trigger.index} for ${candidate.workflow.name}`,
    };
  });
}

function hasBlockingGate(candidate: MatchCandidate): boolean {
  return candidate.workflow.blockers.some((blocker) =>
    blocker.kind === "setup" ||
    blocker.kind === "owner-confirmation" ||
    blocker.kind === "approval"
  );
}

function batchReason(candidate: MatchCandidate): AutomationExplainReason | null {
  if (!candidate.trigger.batch || candidate.sourceKind === "batch-flush") return null;
  const batch = candidate.trigger.batch;
  const threshold = batch.maxCount === undefined
    ? "time/idle/manual flush"
    : `${batch.maxCount} event(s)`;
  return {
    code: "batch-pending",
    severity: "info",
    workflow: candidate.workflow.name,
    event: candidate.trigger.event,
    triggerIndex: candidate.trigger.index,
    message: `event enters batch buffer until ${threshold}; overflow=${batch.overflow}`,
  };
}

function outcomeForMatches(
  candidates: readonly MatchCandidate[],
): AutomationExplainResult["outcome"] {
  if (candidates.some(hasBlockingGate)) return "blocked";
  if (candidates.some((candidate) => candidate.sourceKind === "batch-flush")) {
    return "queued";
  }
  if (candidates.some((candidate) => candidate.trigger.batch)) return "batched";
  return candidates.length > 0 ? "queued" : "no-op";
}

function samplePayloadReachesWorkflowQueue(
  candidate: MatchCandidate,
  sample: AutomationExplainSampleEvent,
): boolean {
  if (candidate.sourceKind === "event") return candidate.trigger.batch === undefined;
  return sample.event === WORKFLOW_BATCH_FLUSH_EVENT;
}

function workflowInputSchemaRejections(
  candidates: readonly MatchCandidate[],
  sample: AutomationExplainSampleEvent | undefined,
): AutomationExplainReason[] {
  if (!sample) return [];
  return candidates.flatMap((candidate) => {
    const inputSchema = candidate.definition.inputSchema;
    if (!inputSchema || !samplePayloadReachesWorkflowQueue(candidate, sample)) return [];
    const schemaError = validatePayloadSchema(inputSchema, sample.payload);
    if (!schemaError) return [];
    return [{
      code: "workflow-input-schema-invalid",
      severity: "blocker" as const,
      workflow: candidate.workflow.name,
      event: sample.event,
      triggerIndex: candidate.trigger.index,
      message: `payload failed workflow inputSchema: ${schemaError}`,
    }];
  });
}

function queryEventName(options: AutomationExplainOptions): string | undefined {
  return options.sampleEvent?.event ?? options.eventName;
}

function missingWorkflowReason(workflowName: string): AutomationExplainReason {
  return {
    code: "workflow-not-found",
    severity: "blocker",
    workflow: workflowName,
    message: `workflow "${workflowName}" is not loaded`,
  };
}

function explainQuery(
  options: AutomationExplainOptions,
  eventName?: string,
): AutomationExplainResult["query"] {
  const sample = options.sampleEvent;
  return {
    ...(options.workflowName ? { workflowName: options.workflowName } : {}),
    ...(eventName ? { eventName } : {}),
    ...(sample
      ? {
          sampleEvent: {
            event: sample.event,
            ...(sample.eventId ? { eventId: sample.eventId } : {}),
            hasPayload: true,
          },
        }
      : {}),
  };
}

export function explainAutomation(
  definitions: readonly WorkflowDefinition[],
  options: AssembleCompiledAutomationGraphOptions & AutomationExplainOptions = {},
): AutomationExplainResult {
  const graph = assembleCompiledAutomationGraph(definitions, options);
  const eventName = queryEventName(options);
  const reasons: AutomationExplainReason[] = [];

  if (
    options.workflowName &&
    !graph.automation.workflows.some((workflow) => workflow.name === options.workflowName)
  ) {
    reasons.push(missingWorkflowReason(options.workflowName));
    return {
      graph,
      query: explainQuery(options, eventName),
      outcome: "blocked",
      matches: [],
      reasons,
      ...(options.sampleEvent
        ? { redactedSamplePayload: projectEvidenceObject(options.sampleEvent.payload, "daemon-api") }
        : {}),
    };
  }

  if (!eventName) {
    return {
      graph,
      query: explainQuery(options),
      outcome: "unknown",
      matches: graph.automation.workflows
        .filter((workflow) => !options.workflowName || workflow.name === options.workflowName)
        .flatMap((workflow) =>
          workflow.triggers.map((trigger) => ({
            workflow: workflow.name,
            triggerIndex: trigger.index,
            triggerEvent: trigger.event,
            matchedFilter: false,
            ...(trigger.batch ? { batch: trigger.batch } : {}),
            effects: workflow.effects,
            blockers: workflow.blockers,
            downstream: workflow.downstream,
          }))
        ),
      reasons: [
        {
          code: "event-not-specified",
          severity: "warning",
          message: "no event type or sample event was supplied; returning workflow trigger inventory",
        },
      ],
    };
  }

  const sample = options.sampleEvent;
  if (sample) {
    const schemaMessage = schemaError(sample);
    if (schemaMessage) {
      return {
        graph,
        query: explainQuery(options, sample.event),
        outcome: "dead-letter",
        matches: [],
        reasons: [{
          code: "schema-invalid",
          severity: "blocker",
          event: sample.event,
          message: `payload failed event schema: ${schemaMessage}`,
        }],
        redactedSamplePayload: projectEvidenceObject(sample.payload, "daemon-api"),
      };
    }

    const rejected = idempotencyRejectedReason(sample);
    if (rejected) {
      return {
        graph,
        query: explainQuery(options, sample.event),
        outcome: "blocked",
        matches: [],
        reasons: [{ code: "idempotency-rejected", severity: "blocker", event: sample.event, message: rejected }],
        redactedSamplePayload: projectEvidenceObject(sample.payload, "daemon-api"),
      };
    }

    const duplicate = idempotencyDuplicateReason(sample);
    if (duplicate) {
      return {
        graph,
        query: explainQuery(options, sample.event),
        outcome: "no-op",
        matches: [],
        reasons: [{ code: "idempotency-duplicate", severity: "info", event: sample.event, message: duplicate }],
        redactedSamplePayload: projectEvidenceObject(sample.payload, "daemon-api"),
      };
    }

    const ignored = sourceIgnoredReason(sample);
    if (ignored) {
      return {
        graph,
        query: explainQuery(options, sample.event),
        outcome: "ignored",
        matches: [],
        reasons: [{ code: "source-ignored", severity: "blocker", event: sample.event, message: ignored }],
        redactedSamplePayload: projectEvidenceObject(sample.payload, "daemon-api"),
      };
    }
  }

  const candidates = matchingCandidates(
    definitions,
    graph,
    eventName,
    options.workflowName,
    sample,
  );
  const matches = candidates.map(explainMatch);
  const inputSchemaRejections = workflowInputSchemaRejections(candidates, sample);
  reasons.push(...reasonsForCandidates(candidates, sample));
  reasons.push(...inputSchemaRejections);
  reasons.push(...candidates.flatMap((candidate) =>
    candidate.workflow.blockers.map((blocker) => ({
      code: blocker.kind,
      severity: "blocker" as const,
      workflow: candidate.workflow.name,
      event: eventName,
      stepId: blocker.stepId,
      message: blocker.reason,
    }))
  ));
  reasons.push(...candidates.flatMap((candidate) => {
    const reason = batchReason(candidate);
    return reason ? [reason] : [];
  }));

  if (candidates.length === 0) {
    reasons.push({
      code: sample ? "no-trigger-match" : "no-listener",
      severity: "warning",
      event: eventName,
      message: sample
        ? `no enabled workflow trigger matched event "${eventName}" and payload filters`
        : `no enabled workflow trigger listens to event "${eventName}"`,
    });
  }

  return {
    graph,
    query: explainQuery(options, eventName),
    outcome: inputSchemaRejections.length > 0
      ? "dead-letter"
      : sample ? outcomeForMatches(candidates) : "unknown",
    matches,
    reasons,
    ...(sample ? { redactedSamplePayload: projectEvidenceObject(sample.payload, "daemon-api") } : {}),
  };
}

export function formatAutomationExplainResult(result: AutomationExplainResult): string {
  const lines: string[] = [];
  lines.push("Automation Explain");
  lines.push("==================");
  if (result.query.workflowName) lines.push(`Workflow: ${result.query.workflowName}`);
  if (result.query.eventName) lines.push(`Event: ${result.query.eventName}`);
  lines.push(`Outcome: ${result.outcome}`);
  lines.push("");
  lines.push("Matches:");
  if (result.matches.length === 0) {
    lines.push("  (none)");
  } else {
    for (const match of result.matches) {
      const batch = match.batch
        ? ` batch(max=${match.batch.maxCount ?? "time"}, buffer=${match.batch.maxBufferSize})`
        : "";
      lines.push(`  - ${match.workflow} trigger#${match.triggerIndex} ${match.triggerEvent}${batch}`);
      for (const effect of match.effects) {
        lines.push(`    effect: ${effect.effectId} risk=${effect.risk}`);
      }
      for (const edge of match.downstream) {
        lines.push(`    downstream: ${edge.kind} ${edge.target}`);
      }
    }
  }
  lines.push("");
  lines.push("Reasons:");
  if (result.reasons.length === 0) {
    lines.push("  (none)");
  } else {
    for (const reason of result.reasons) {
      const where = reason.workflow ? ` [${reason.workflow}]` : "";
      lines.push(`  - ${reason.severity}${where}: ${reason.message}`);
    }
  }
  if (result.redactedSamplePayload) {
    lines.push("");
    lines.push("Redacted sample payload:");
    lines.push(JSON.stringify(result.redactedSamplePayload, null, 2));
  }
  return lines.join("\n");
}

export function formatAutomationBatchSummary(batch: AutomationBatchSummary): string {
  const parts: string[] = [];
  if (batch.maxCount !== undefined) parts.push(`${batch.maxCount} event(s)`);
  if (batch.maxAgeMs !== undefined) parts.push(formatDuration(batch.maxAgeMs));
  if (batch.idleTimeoutMs !== undefined) parts.push(`${formatDuration(batch.idleTimeoutMs)} idle`);
  if (batch.flushEvent) parts.push(`flush=${batch.flushEvent}`);
  return parts.length > 0 ? parts.join(", ") : "manual flush only";
}
