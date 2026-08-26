import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { explainAutomation } from "../graph/index.js";
import {
  createBatchSimulationState,
  eventFromQueuedBatchFlush,
} from "./batches.js";
import { dryRunsForMatches } from "./dry-runs.js";
import {
  resolveEvents,
  type SimulationEvent,
} from "./events.js";
import {
  blockers,
  effectPreviews,
  OUTCOMES,
  outcomeForExplain,
} from "./outcomes.js";
import type {
  WorkflowSimulationInputResult,
  WorkflowSimulationOutcome,
  WorkflowSimulationRequest,
  WorkflowSimulationResult,
  WorkflowSimulationSummary,
} from "./types.js";

export { eventEnvelopePayloadForFixture } from "./events.js";

export type SimulateAutomationArgs = {
  scopeRoot: string;
  definitions: readonly WorkflowDefinition[];
  moduleManifests?: readonly ModuleCapabilityManifestProjection[];
  availableToolNames?: ReadonlySet<string>;
  request: WorkflowSimulationRequest;
};

async function simulateEvent(
  args: SimulateAutomationArgs,
  event: SimulationEvent,
): Promise<WorkflowSimulationInputResult> {
  if (event.availability?.kind === "policy-pruned") {
    const explain = explainAutomation(args.definitions, {
      moduleManifests: args.moduleManifests ?? [],
      ...(args.request.workflowName ? { workflowName: args.request.workflowName } : {}),
      eventName: event.event,
    });
    return {
      source: event.source,
      event: event.event,
      ...(event.eventId ? { eventId: event.eventId } : {}),
      availability: event.availability,
      outcome: "would-noop",
      reasons: [
        {
          code: event.availability.reasonCode,
          severity: "warning",
          event: event.event,
          message:
            `journal event ${event.availability.id} payload is unavailable by evidence retention policy; retained metadata only`,
        },
      ],
      matches: [],
      blockers: [],
      policyGates: [],
      effects: [],
      dryRuns: [],
      explain,
    };
  }
  const explain = explainAutomation(args.definitions, {
    moduleManifests: args.moduleManifests ?? [],
    ...(args.request.workflowName ? { workflowName: args.request.workflowName } : {}),
    eventName: event.event,
    sampleEvent: {
      event: event.event,
      payload: event.payload,
      ...(event.eventId ? { eventId: event.eventId } : {}),
    },
  });
  const effects = effectPreviews(explain);
  const matchBlockers = blockers(explain);
  const dryRuns = await dryRunsForMatches(
    args.definitions,
    event,
    explain,
    args.availableToolNames,
  );
  return {
    source: event.source,
    event: event.event,
    ...(event.eventId ? { eventId: event.eventId } : {}),
    outcome: outcomeForExplain(explain, effects, matchBlockers),
    reasons: explain.reasons,
    matches: explain.matches.map((match) => ({
      workflow: match.workflow,
      triggerIndex: match.triggerIndex,
      triggerEvent: match.triggerEvent,
    })),
    blockers: matchBlockers,
    policyGates: explain.matches.flatMap((match) => {
      const workflow = explain.graph.automation.workflows.find(
        (candidate) => candidate.name === match.workflow,
      );
      return workflow?.policyGates ?? [];
    }),
    effects,
    dryRuns,
    explain,
  };
}

function emptySummary(): WorkflowSimulationSummary {
  const summary = Object.fromEntries(
    OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<WorkflowSimulationOutcome, number>;
  return { total: 0, ...summary };
}

function summarize(
  inputs: readonly WorkflowSimulationInputResult[],
): WorkflowSimulationSummary {
  const summary = emptySummary();
  summary.total = inputs.length;
  for (const input of inputs) {
    summary[input.outcome] += 1;
  }
  return summary;
}

function requestSummary(request: WorkflowSimulationRequest): WorkflowSimulationResult["request"] {
  return {
    ...(request.workflowName ? { workflowName: request.workflowName } : {}),
    ...(request.event ? { event: request.event } : {}),
    ...(request.eventId ? { eventId: request.eventId } : {}),
    ...(request.journal ? { journal: request.journal } : {}),
    ...(request.envelope?.id ? { envelopeId: request.envelope.id } : {}),
  };
}

export async function simulateAutomation(
  args: SimulateAutomationArgs,
): Promise<WorkflowSimulationResult> {
  const events = resolveEvents(args.scopeRoot, args.request);
  const batchSimulation = createBatchSimulationState(args.definitions);
  const inputs: WorkflowSimulationInputResult[] = [];
  try {
    for (const event of events) {
      const input = await simulateEvent(args, event);
      inputs.push(input);
      if (input.outcome !== "would-batch") continue;
      const flushes = batchSimulation.handleEvent(event);
      for (const flush of flushes) {
        inputs.push(await simulateEvent(args, eventFromQueuedBatchFlush(flush)));
      }
    }
  } finally {
    batchSimulation.cleanup();
  }
  return {
    ok: true,
    request: requestSummary(args.request),
    inputs,
    summary: summarize(inputs),
  };
}
