import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { WORKFLOW_BATCH_FLUSH_EVENT } from "#core/workflow/trigger-types.js";
import type { MatchCandidate } from "./explain-match-candidates.js";
import type {
  AutomationExplainOptions,
  AutomationExplainReason,
  AutomationExplainResult,
  AutomationExplainSampleEvent,
} from "./types.js";

export function reasonsForCandidates(
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

export function batchReason(candidate: MatchCandidate): AutomationExplainReason | null {
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

export function outcomeForMatches(
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

export function workflowInputSchemaRejections(
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

export function missingWorkflowReason(workflowName: string): AutomationExplainReason {
  return {
    code: "workflow-not-found",
    severity: "blocker",
    workflow: workflowName,
    message: `workflow "${workflowName}" is not loaded`,
  };
}

export function explainQuery(
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
