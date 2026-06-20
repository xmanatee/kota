import type { ModuleEventPayloadObject } from "#core/events/module-event.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import { validatePayloadAgainstSchema } from "#core/events/module-event-payload-validation.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { matchesFilter } from "#core/workflow/run-executor-utils.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowRunTrigger,
  type WorkflowTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  type AssembleCompiledAutomationGraphOptions,
  assembleCompiledAutomationGraph,
} from "./explain-graph.js";
import type {
  AutomationExplainOptions,
  AutomationExplainReason,
  AutomationExplainResult,
  AutomationExplainSampleEvent,
  AutomationExplainWorkflowMatch,
  AutomationTriggerSummary,
  AutomationWorkflowNode,
  CompiledAutomationGraph,
} from "./types.js";

type Payload = WorkflowRunTrigger["payload"];
type PayloadValue = Payload[string];

type MatchCandidate = {
  definition: WorkflowDefinition;
  workflow: AutomationWorkflowNode;
  trigger: AutomationTriggerSummary;
  sourceTrigger: WorkflowTrigger;
  sourceKind: "event" | "batch-flush";
  filterState: "matched" | "not-required" | "not-evaluated";
};

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
