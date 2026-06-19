import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import {
  type BusEnvelope,
  EventBus,
  type EventSchemaReference,
} from "#core/events/event-bus.js";
import {
  type EventEnvelope,
  type EventJsonObject,
  eventEnvelopeToBusEnvelope,
} from "#core/events/event-journal.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import { WorkflowEventBatchManager } from "#core/workflow/event-batches.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { workflowDispatchIdempotency } from "#core/workflow/workflow-idempotency.js";
import {
  buildDryRunPlan,
  type DryRunResult,
} from "../execution/dry-run.js";
import {
  type AutomationBlocker,
  type AutomationExplainReason,
  type AutomationExplainResult,
  explainAutomation,
} from "../graph/index.js";
import { eventJournalForProject } from "../utils.js";
import type {
  WorkflowSimulationDryRun,
  WorkflowSimulationEffectPreview,
  WorkflowSimulationInputResult,
  WorkflowSimulationJournalSelector,
  WorkflowSimulationOutcome,
  WorkflowSimulationRequest,
  WorkflowSimulationResult,
  WorkflowSimulationSource,
  WorkflowSimulationSummary,
} from "./types.js";

type SimulationEvent = {
  source: WorkflowSimulationSource;
  event: string;
  payload: WorkflowRunTrigger["payload"];
  eventId?: string;
  schemaRef?: EventSchemaReference | null;
  envelope?: EventEnvelope;
};

type DispatchIdempotencyPreview = {
  blocker?: AutomationBlocker;
  reason?: AutomationExplainReason;
};

type QueuedBatchFlushPreview = {
  definition: WorkflowDefinition;
  runTrigger: WorkflowRunTrigger;
};

type BatchSimulationState = {
  handleEvent(event: SimulationEvent): QueuedBatchFlushPreview[];
  cleanup(): void;
};

export type SimulateAutomationArgs = {
  projectDir: string;
  definitions: readonly WorkflowDefinition[];
  moduleManifests?: readonly ModuleCapabilityManifestProjection[];
  availableToolNames?: ReadonlySet<string>;
  request: WorkflowSimulationRequest;
};

const OUTCOMES: readonly WorkflowSimulationOutcome[] = [
  "would-ignore",
  "would-batch",
  "would-queue",
  "would-block",
  "would-ask-owner",
  "would-dlq",
  "would-perform-effect",
  "would-noop",
  "unknown",
];

function isPayload(
  value: WorkflowSimulationRequest["payload"],
): value is WorkflowRunTrigger["payload"] {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestPayload(request: WorkflowSimulationRequest): WorkflowRunTrigger["payload"] {
  return isPayload(request.payload) ? request.payload : {};
}

function eventFromEnvelope(envelope: EventEnvelope, source: WorkflowSimulationSource): SimulationEvent {
  const bus = eventEnvelopeToBusEnvelope(envelope);
  return {
    source,
    event: bus.type,
    payload: bus.payload as WorkflowRunTrigger["payload"],
    eventId: envelope.id,
    schemaRef: bus.schemaRef,
    envelope,
  };
}

function syntheticEvent(request: WorkflowSimulationRequest): SimulationEvent | null {
  if (!request.event) return null;
  return {
    source: { kind: "synthetic" },
    event: request.event,
    payload: requestPayload(request),
    ...(request.eventId ? { eventId: request.eventId } : {}),
  };
}

function envelopeForDryRun(event: SimulationEvent): EventEnvelope {
  if (event.envelope) return event.envelope;
  const timestamp = new Date(0).toISOString();
  return {
    id: event.eventId ?? "simulation-event",
    sequence: 0,
    event: {
      name: event.event,
      schema: event.schemaRef ?? { name: event.event, version: 1 },
    },
    source: { kind: "unknown", id: "simulation" },
    scope: { kind: "daemon" },
    timestamps: {
      occurredAt: timestamp,
      receivedAt: timestamp,
      emittedAt: timestamp,
      journaledAt: timestamp,
    },
    producer: { kind: "unknown" },
    causality: {},
    trace: {},
    idempotency: {},
    data: {
      classification: "internal",
      sensitivity: "internal",
      dataClasses: ["operational-metadata"],
      redactionProfile: "plain",
      storageProfile: "internal-storage",
    },
    payload: {
      kind: "inline",
      payload: event.payload as EventJsonObject,
    },
    retention: { kind: "retain" },
  };
}

function journalLimit(selector: WorkflowSimulationJournalSelector): number {
  if (selector.limit === undefined) return selector.id ? 1 : 20;
  return Number.isInteger(selector.limit) && selector.limit > 0
    ? Math.min(selector.limit, 100)
    : 20;
}

function journalEvents(
  projectDir: string,
  selector: WorkflowSimulationJournalSelector,
): SimulationEvent[] {
  const journal = eventJournalForProject(projectDir);
  const events = journal.query({
    id: selector.id,
    after: selector.after,
    type: selector.type,
    typePrefix: selector.typePrefix,
    limit: journalLimit(selector),
  });
  return events.map((envelope) =>
    eventFromEnvelope(envelope, {
      kind: "journal",
      journalId: envelope.id,
    })
  );
}

function resolveEvents(
  projectDir: string,
  request: WorkflowSimulationRequest,
): SimulationEvent[] {
  if (request.envelope) {
    return [eventFromEnvelope(request.envelope, { kind: "envelope" })];
  }
  if (request.journal) {
    return journalEvents(projectDir, request.journal);
  }
  const synthetic = syntheticEvent(request);
  if (synthetic) return [synthetic];
  throw new Error(
    "workflow simulation requires an event, event envelope, or journal selector",
  );
}

function ownerConfirmationPresent(blockers: readonly AutomationBlocker[]): boolean {
  return blockers.some((blocker) => blocker.kind === "owner-confirmation");
}

function blockingPresent(blockers: readonly AutomationBlocker[]): boolean {
  return blockers.some((blocker) =>
    blocker.kind === "setup" ||
    blocker.kind === "owner-confirmation" ||
    blocker.kind === "approval" ||
    blocker.kind === "idempotency" ||
    blocker.kind === "schema" ||
    blocker.kind === "source"
  );
}

function effectPreviews(
  explain: AutomationExplainResult,
): WorkflowSimulationEffectPreview[] {
  return explain.matches.flatMap((match) =>
    match.effects.map((effect) => {
      const blocked = effect.simulation.blocked;
      return {
        ...effect,
        workflow: match.workflow,
        wouldPerform: !blocked,
        blocked,
        ...(effect.simulation.reason ? { reason: effect.simulation.reason } : {}),
      };
    })
  );
}

function blockers(explain: AutomationExplainResult): AutomationBlocker[] {
  return explain.matches.flatMap((match) => match.blockers);
}

function outcomeForExplain(
  explain: AutomationExplainResult,
  effects: readonly WorkflowSimulationEffectPreview[],
  blockersForMatches: readonly AutomationBlocker[],
): WorkflowSimulationOutcome {
  switch (explain.outcome) {
    case "ignored":
      return "would-ignore";
    case "batched":
      return "would-batch";
    case "dead-letter":
      return "would-dlq";
    case "no-op":
      return "would-noop";
    case "blocked":
      return ownerConfirmationPresent(blockersForMatches)
        ? "would-ask-owner"
        : "would-block";
    case "queued":
      if (ownerConfirmationPresent(blockersForMatches)) return "would-ask-owner";
      if (blockingPresent(blockersForMatches)) return "would-block";
      if (effects.some((effect) => effect.wouldPerform)) return "would-perform-effect";
      return "would-queue";
    case "unknown":
      return "unknown";
  }
}

function workflowRunTriggerForEvent(event: SimulationEvent): WorkflowRunTrigger {
  return {
    event: event.event,
    schemaRef: event.schemaRef ?? null,
    ...(event.eventId ? { eventId: event.eventId } : {}),
    payload: event.payload,
  };
}

function busEnvelopeForEvent(event: SimulationEvent): BusEnvelope {
  return {
    type: event.event,
    schemaRef: event.schemaRef ?? null,
    ...(event.eventId ? { eventId: event.eventId } : {}),
    payload: event.payload,
  };
}

function eventFromQueuedBatchFlush(
  flush: QueuedBatchFlushPreview,
): SimulationEvent {
  return {
    source: {
      kind: "batch-flush",
      label: flush.definition.name,
    },
    event: flush.runTrigger.event,
    payload: flush.runTrigger.payload,
    schemaRef: flush.runTrigger.schemaRef,
    ...(flush.runTrigger.eventId ? { eventId: flush.runTrigger.eventId } : {}),
  };
}

function payloadString(
  payload: WorkflowRunTrigger["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function defaultScopeIdForEvent(event: SimulationEvent): string {
  const payloadScope = payloadString(event.payload, "scopeId") ??
    payloadString(event.payload, "projectId");
  if (payloadScope !== undefined) return payloadScope;
  if (event.envelope?.scope.kind === "scope") return event.envelope.scope.scopeId;
  return "default";
}

function createBatchSimulationState(
  definitions: readonly WorkflowDefinition[],
): BatchSimulationState {
  const tempProjectDir = mkdtempSync(join(tmpdir(), "kota-workflow-simulation-"));
  const bus = new EventBus();
  const store = new WorkflowRunStore(tempProjectDir);
  const queuedFlushes: QueuedBatchFlushPreview[] = [];
  const scopedBuses = new Map<string, ProjectScopedEventBus>();
  let currentScopeId = "default";

  const projectBus = (): ProjectScopedEventBus => {
    const existing = scopedBuses.get(currentScopeId);
    if (existing) return existing;
    const created = new ProjectScopedEventBus(bus, currentScopeId);
    scopedBuses.set(currentScopeId, created);
    return created;
  };

  const manager = new WorkflowEventBatchManager(
    store,
    () => false,
    (definition, _trigger, runTrigger) => {
      queuedFlushes.push({ definition, runTrigger });
    },
    () => {},
    projectBus,
    () => {},
  );
  manager.setup([...definitions]);

  return {
    handleEvent(event) {
      const before = queuedFlushes.length;
      currentScopeId = defaultScopeIdForEvent(event);
      manager.handleEvent(busEnvelopeForEvent(event));
      return queuedFlushes.slice(before);
    },
    cleanup() {
      manager.clearAll();
      rmSync(tempProjectDir, { recursive: true, force: true });
    },
  };
}

function idempotencyStoreForProject(
  projectDir: string,
  event: SimulationEvent,
): IdempotencyStore | null {
  const dir = join(projectDir, ".kota", "idempotency");
  if (!existsSync(dir)) return null;
  return new IdempotencyStore(dir, defaultScopeIdForEvent(event));
}

function expiredAt(expiresAt: string | undefined): boolean {
  return expiresAt !== undefined && Date.parse(expiresAt) <= Date.now();
}

function dispatchIdempotencyPreview(
  store: IdempotencyStore,
  workflow: string,
  event: SimulationEvent,
): DispatchIdempotencyPreview | null {
  const identity = workflowDispatchIdempotency(
    store,
    workflow,
    workflowRunTriggerForEvent(event),
  );
  if (!identity) return null;

  const entry = store.get(identity.scopeId, "workflow-dispatch", identity.key);
  if (!entry || entry.status === "expired") return null;

  const messagePrefix = `workflow dispatch idempotency key ${identity.key}`;
  if (expiredAt(entry.expiresAt)) {
    return {
      blocker: {
        kind: "idempotency",
        workflow,
        event: event.event,
        reason: `${messagePrefix} is expired`,
      },
      reason: {
        code: "idempotency-expired",
        severity: "blocker",
        workflow,
        event: event.event,
        message: `${messagePrefix} is expired`,
      },
    };
  }

  if (entry.parameterFingerprint !== identity.parameterFingerprint) {
    return {
      blocker: {
        kind: "idempotency",
        workflow,
        event: event.event,
        reason: `${messagePrefix} was reused with different dispatch parameters`,
      },
      reason: {
        code: "idempotency-rejected",
        severity: "blocker",
        workflow,
        event: event.event,
        message: `${messagePrefix} was reused with different dispatch parameters`,
      },
    };
  }

  if (entry.firstResult !== undefined) {
    return {
      reason: {
        code: "idempotency-duplicate",
        severity: "info",
        workflow,
        event: event.event,
        message: `${messagePrefix} would replay the first workflow dispatch`,
      },
    };
  }

  return {
    reason: {
      code: "idempotency-duplicate",
      severity: "info",
      workflow,
      event: event.event,
      message: `${messagePrefix} is already in progress`,
    },
  };
}

function idempotencyPreviews(
  projectDir: string,
  event: SimulationEvent,
  explain: AutomationExplainResult,
): DispatchIdempotencyPreview[] {
  const store = idempotencyStoreForProject(projectDir, event);
  if (!store) return [];
  return explain.matches.flatMap((match) => {
    const preview = dispatchIdempotencyPreview(store, match.workflow, event);
    return preview ? [preview] : [];
  });
}

function idempotencyDuplicatePresent(
  previews: readonly DispatchIdempotencyPreview[],
): boolean {
  return previews.some((preview) =>
    preview.reason?.code === "idempotency-duplicate" && preview.blocker === undefined
  );
}

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

async function dryRunsForMatches(
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

async function simulateEvent(
  args: SimulateAutomationArgs,
  event: SimulationEvent,
): Promise<WorkflowSimulationInputResult> {
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
  const idempotency = idempotencyPreviews(args.projectDir, event, explain);
  const matchBlockers = [
    ...blockers(explain),
    ...idempotency.flatMap((preview) => preview.blocker ? [preview.blocker] : []),
  ];
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
    outcome: idempotencyDuplicatePresent(idempotency)
      ? "would-noop"
      : outcomeForExplain(explain, effects, matchBlockers),
    reasons: [
      ...explain.reasons,
      ...idempotency.flatMap((preview) => preview.reason ? [preview.reason] : []),
    ],
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
  const events = resolveEvents(args.projectDir, args.request);
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

export function eventEnvelopePayloadForFixture(
  envelope: EventEnvelope,
): EventJsonObject {
  const bus = eventEnvelopeToBusEnvelope(envelope);
  return bus.payload as EventJsonObject;
}
