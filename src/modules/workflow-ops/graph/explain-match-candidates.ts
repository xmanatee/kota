import { matchesFilter } from "#core/workflow/run-executor-utils.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  payloadNumber,
  payloadString,
} from "./explain-match-payload.js";
import type {
  AutomationExplainSampleEvent,
  AutomationExplainWorkflowMatch,
  AutomationTriggerSummary,
  AutomationWorkflowNode,
  CompiledAutomationGraph,
} from "./types.js";

export type MatchCandidate = {
  definition: WorkflowDefinition;
  workflow: AutomationWorkflowNode;
  trigger: AutomationTriggerSummary;
  sourceTrigger: WorkflowTrigger;
  sourceKind: "event" | "batch-flush";
  filterState: "matched" | "not-required" | "not-evaluated";
};

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

export function matchingCandidates(
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

export function explainMatch(candidate: MatchCandidate): AutomationExplainWorkflowMatch {
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
