import { projectEvidenceObject } from "#core/evidence/policy.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  type AssembleCompiledAutomationGraphOptions,
  assembleCompiledAutomationGraph,
} from "./explain-graph.js";
import {
  explainMatch,
  matchingCandidates,
} from "./explain-match-candidates.js";
import {
  idempotencyDuplicateReason,
  idempotencyRejectedReason,
  schemaError,
  sourceIgnoredReason,
} from "./explain-match-payload.js";
import {
  batchReason,
  explainQuery,
  missingWorkflowReason,
  outcomeForMatches,
  reasonsForCandidates,
  workflowInputSchemaRejections,
} from "./explain-match-reasons.js";
import type {
  AutomationExplainOptions,
  AutomationExplainReason,
  AutomationExplainResult,
} from "./types.js";

function queryEventName(options: AutomationExplainOptions): string | undefined {
  return options.sampleEvent?.event ?? options.eventName;
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
