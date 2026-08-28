import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type {
  EventEnvelope,
  EventJsonObject,
  EventJsonValue,
} from "#core/events/event-journal.js";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import { WORKFLOW_BATCH_FLUSH_EVENT } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { workflowDispatchIdempotency } from "#core/workflow/workflow-idempotency.js";
import { eventJournalForScope } from "../utils.js";
import { simulateAutomation } from "./engine.js";
import {
  getSimulationFixture,
  SIMULATION_FIXTURES,
} from "./fixtures.js";

type StrictPayload = {
  name: string;
};

const strictEvent = defineDaemonWideModuleEvent<StrictPayload>(
  "simulation.strict",
  ["name"],
  {
    payloadSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
      },
    },
  },
);

function workspaceRoot(): string {
  const dir = join(
    tmpdir(),
    `kota-simulation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return dir;
}

function eventEnvelope(args: {
  id: string;
  sequence: number;
  event: string;
  payload: EventJsonObject;
}): EventEnvelope {
  const timestamp = "2026-06-05T12:00:00.000Z";
  return {
    id: args.id,
    sequence: args.sequence,
    event: {
      name: args.event,
      schema: { name: args.event, version: 1 },
    },
    source: { kind: "unknown", id: "simulation-test" },
    scope: {
      kind: "scope",
      scopeId: "scope-a",
      lineage: ["scope-a"],
    },
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
      payload: args.payload,
    },
    retention: { kind: "retain" },
  };
}

function idempotencyStore(dir: string): IdempotencyStore {
  return new IdempotencyStore(join(dir, ".kota", "idempotency"), "scope-a");
}

function recordWorkflowDispatch(args: {
  dir: string;
  workflowName: string;
  event: string;
  eventId: string;
  payload: Record<string, EventJsonValue | undefined>;
  runId: string;
}): IdempotencyStore {
  const store = idempotencyStore(args.dir);
  const identity = workflowDispatchIdempotency(store.getDefaultScopeId(), args.workflowName, {
    event: args.event,
    schemaRef: { name: args.event, version: 1 },
    eventId: args.eventId,
    payload: args.payload,
  });
  if (!identity) throw new Error("expected workflow dispatch idempotency");
  store.record({
    ...identity,
    operation: "event-ingestion",
    result: {
      workflowName: args.workflowName,
      runId: args.runId,
      triggerEvent: args.event,
      queuedAt: "2026-06-05T12:00:00.000Z",
    },
  });
  return store;
}

function workflow(
  name: string,
  overrides: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    name,
    enabled: true,
    moduleRoot: "/tmp/kota-simulation",
    definitionPath: `/tmp/kota-simulation/${name}.ts`,
    tags: [],
    triggers: [],
    steps: [],
    ...overrides,
    repository: overrides.repository ?? "none",
  };
}

function capabilityManifest(args: {
  hooks: readonly ("owner-confirmation" | "setup")[];
  setupState?: "ready" | "missing";
  simulationBlocked?: boolean;
}): ModuleCapabilityManifestProjection {
  const setupState = args.setupState ?? "ready";
  return {
    schemaVersion: 1,
    moduleName: "booking",
    dependencies: [],
    capabilities: [
      {
        id: "booking.write",
        description: "Book an external provider resource",
        scope: "external",
        scopePolicyHooks: args.hooks,
        setupRequirementIds: args.hooks.includes("setup")
          ? ["booking-oauth"]
          : [],
      },
    ],
    dataClasses: [],
    contributions: {
      tools: ["book_court"],
      workflows: [],
      workflowTriggers: [],
      channels: [],
      skills: [],
      agents: [],
      commands: [],
      routes: [],
      controlRoutes: [],
      events: [],
      eventFlows: [],
      clients: {
        localNamespaces: [],
        daemonFactory: false,
      },
      setupRequirements: args.hooks.includes("setup")
        ? [
            {
              id: "booking-oauth",
              kind: "oauth",
              setupMode: "url",
              sensitivity: "oauth",
              required: true,
              healthCapabilityIds: ["booking.write"],
              statusLinks: {
                list: "/setup",
                refresh: "/setup/booking-oauth/refresh",
                revoke: "/setup/booking-oauth/revoke",
                start: "/setup/booking-oauth/start",
              },
              availability: {
                state: setupState,
                reason: setupState,
                message: setupState === "ready"
                  ? "booking provider ready"
                  : "booking provider OAuth is missing",
              },
            },
          ]
        : [],
    },
    effects: [
      {
        id: "book-court",
        description: "Book a court through an external provider",
        source: "tool",
        target: "book_court",
        effect: {
          kind: "write",
          scope: "external-network",
          idempotent: false,
          openWorld: true,
        },
        risk: "dangerous",
        categories: ["external-write", "owner-visible"],
        capabilityIds: ["booking.write"],
        simulation: args.simulationBlocked
          ? {
              blocked: true,
              reason: "external provider writes are blocked in simulation",
            }
          : { blocked: false },
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: ["external provider writes are blocked in simulation"],
    },
    readiness: {
      setupRequirementIds: args.hooks.includes("setup")
        ? ["booking-oauth"]
        : [],
      healthCapabilityIds: [],
      healthCheck: "not-declared",
    },
  };
}

const sportsRoute = workflow("sports-route", {
  triggers: [
    {
      event: "inbound.signal.received",
      cooldownMs: 0,
      batch: {
        maxCount: 2,
        groupBy: ["sourceId"],
        maxBufferSize: 10,
        overflow: "flush-oldest",
      },
    },
  ],
});

const progressReviewer = workflow("progress-reviewer", {
  triggers: [
    {
      event: "autonomy.progress-review.requested",
      cooldownMs: 0,
    },
    {
      event: "autonomy.progress-review.schedule",
      cooldownMs: 0,
    },
    {
      event: "workflow.completed",
      cooldownMs: 0,
      filter: { tags: ["monitored"] },
      batch: {
        maxCount: 5,
        maxAgeMs: 6 * 60 * 60 * 1000,
        groupBy: ["scopeId"],
        maxBufferSize: 20,
        overflow: "flush-oldest",
      },
    },
  ],
});

const bookingWorkflow = workflow("booking-workflow", {
  triggers: [{ event: "booking.requested", cooldownMs: 0 }],
  steps: [{ id: "book", type: "tool", tool: "book_court" }],
});

const strictWorkflow = workflow("strict-workflow", {
  triggers: [{ event: "simulation.strict", cooldownMs: 0 }],
});

const overflowBatchWorkflow = workflow("overflow-batch", {
  triggers: [
    {
      event: "task.changed",
      cooldownMs: 0,
      batch: {
        maxCount: 10,
        groupBy: ["bucket"],
        maxBufferSize: 1,
        overflow: "flush-oldest",
      },
    },
  ],
  steps: [
    {
      id: "summarize",
      type: "code",
      run: () => ({ ok: true }),
    },
  ],
});

describe("workflow automation simulation engine", () => {
  let dir: string;

  beforeEach(() => {
    dir = workspaceRoot();
    resetModuleEventRegistry();
    initModuleEventRegistry().register("simulation", strictEvent);
  });

  afterEach(() => {
    resetModuleEventRegistry();
    rmSync(dir, { recursive: true, force: true });
  });

  it("previews ignored, batched, batch-flush, duplicate, and DLQ outcomes", async () => {
    const definitions = [sportsRoute, progressReviewer, strictWorkflow];

    const ignored = await simulateAutomation({
      scopeRoot: dir,
      definitions,
      request: {
        event: "inbound.signal.received",
        payload: {
          sourceStatus: "archived",
          actor: { trust: "trusted" },
        },
      },
    });
    expect(ignored.inputs[0]?.outcome).toBe("would-ignore");
    expect(ignored.inputs[0]?.reasons[0]?.code).toBe("source-ignored");

    const batched = await simulateAutomation({
      scopeRoot: dir,
      definitions,
      request: {
        event: "inbound.signal.received",
        payload: {
          scopeId: "scope-a",
          sourceId: "sports-chat",
          actor: { trust: "trusted" },
        },
      },
    });
    expect(batched.inputs[0]?.outcome).toBe("would-batch");
    expect(batched.inputs[0]?.matches[0]).toMatchObject({
      workflow: "sports-route",
    });

    const flushed = await simulateAutomation({
      scopeRoot: dir,
      definitions,
      request: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload: {
          batch: {
            workflow: "progress-reviewer",
          },
        },
      },
    });
    expect(flushed.inputs[0]?.outcome).toBe("would-queue");
    expect(flushed.inputs[0]?.dryRuns[0]).toMatchObject({
      workflow: "progress-reviewer",
      pass: true,
      triggerMatch: {
        matched: true,
        matchedEvent: WORKFLOW_BATCH_FLUSH_EVENT,
      },
    });

    const duplicate = await simulateAutomation({
      scopeRoot: dir,
      definitions,
      request: {
        event: "booking.requested",
        payload: {
          idempotencyStatus: "replayed",
        },
      },
    });
    expect(duplicate.inputs[0]?.outcome).toBe("would-noop");
    expect(duplicate.inputs[0]?.reasons[0]?.code).toBe("idempotency-duplicate");

    const dlq = await simulateAutomation({
      scopeRoot: dir,
      definitions,
      request: {
        event: "simulation.strict",
        payload: {
          name: 42,
        },
      },
    });
    expect(dlq.inputs[0]?.outcome).toBe("would-dlq");
    expect(dlq.inputs[0]?.reasons[0]?.code).toBe("schema-invalid");
  });

  it("composes journaled event ranges through the batch manager until maxCount flushes", async () => {
    eventJournalForScope(dir).appendEnvelope(eventEnvelope({
      id: "evtj-sports-1",
      sequence: 10,
      event: "inbound.signal.received",
      payload: {
        scopeId: "scope-a",
        sourceId: "sports-chat",
        actor: { trust: "trusted" },
        body: { text: "one" },
      },
    }));
    eventJournalForScope(dir).appendEnvelope(eventEnvelope({
      id: "evtj-sports-2",
      sequence: 11,
      event: "inbound.signal.received",
      payload: {
        scopeId: "scope-a",
        sourceId: "sports-chat",
        actor: { trust: "trusted" },
        body: { text: "two" },
      },
    }));

    const result = await simulateAutomation({
      scopeRoot: dir,
      definitions: [sportsRoute],
      request: {
        journal: {
          type: "inbound.signal.received",
          limit: 2,
        },
      },
    });

    expect(result.inputs.map((input) => input.outcome)).toEqual([
      "would-batch",
      "would-batch",
      "would-queue",
    ]);
    expect(result.inputs[2]).toMatchObject({
      source: { kind: "batch-flush", label: "sports-route" },
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      outcome: "would-queue",
      dryRuns: [
        {
          workflow: "sports-route",
          pass: true,
          triggerMatch: {
            matched: true,
            matchedEvent: WORKFLOW_BATCH_FLUSH_EVENT,
          },
        },
      ],
    });
    expect(result.summary["would-batch"]).toBe(2);
    expect(result.summary["would-queue"]).toBe(1);
  });

  it("previews overflow flushes through the existing batch policy", async () => {
    eventJournalForScope(dir).appendEnvelope(eventEnvelope({
      id: "evtj-overflow-1",
      sequence: 20,
      event: "task.changed",
      payload: {
        scopeId: "scope-a",
        bucket: "open",
        taskId: "task-one",
      },
    }));
    eventJournalForScope(dir).appendEnvelope(eventEnvelope({
      id: "evtj-overflow-2",
      sequence: 21,
      event: "task.changed",
      payload: {
        scopeId: "scope-a",
        bucket: "open",
        taskId: "task-two",
      },
    }));

    const result = await simulateAutomation({
      scopeRoot: dir,
      definitions: [overflowBatchWorkflow],
      request: {
        journal: {
          type: "task.changed",
          limit: 2,
        },
      },
    });

    const flush = result.inputs[2];
    expect(result.inputs.map((input) => input.outcome)).toEqual([
      "would-batch",
      "would-batch",
      "would-queue",
    ]);
    expect(flush?.explain.redactedSamplePayload?.reason).toBe("overflow");
    expect(flush?.explain.redactedSamplePayload?.count).toBe(1);
    expect(flush?.dryRuns[0]).toMatchObject({
      workflow: "overflow-batch",
      pass: true,
      steps: [{ id: "summarize" }],
    });
  });

  it("previews setup blockers, owner confirmation gates, and side effects from manifests", async () => {
    const owner = await simulateAutomation({
      scopeRoot: dir,
      definitions: [bookingWorkflow],
      moduleManifests: [capabilityManifest({ hooks: ["owner-confirmation"] })],
      request: {
        event: "booking.requested",
        payload: {},
      },
    });
    expect(owner.inputs[0]?.outcome).toBe("would-ask-owner");
    expect(owner.inputs[0]?.blockers[0]?.kind).toBe("owner-confirmation");

    const setup = await simulateAutomation({
      scopeRoot: dir,
      definitions: [bookingWorkflow],
      moduleManifests: [capabilityManifest({ hooks: ["setup"], setupState: "missing" })],
      request: {
        event: "booking.requested",
        payload: {},
      },
    });
    expect(setup.inputs[0]?.outcome).toBe("would-block");
    expect(setup.inputs[0]?.blockers[0]).toMatchObject({
      kind: "setup",
      setupRequirementId: "booking-oauth",
    });

    const effect = await simulateAutomation({
      scopeRoot: dir,
      definitions: [bookingWorkflow],
      moduleManifests: [capabilityManifest({ hooks: [] })],
      request: {
        event: "booking.requested",
        payload: {},
      },
    });
    expect(effect.inputs[0]?.outcome).toBe("would-perform-effect");
    expect(effect.inputs[0]?.effects[0]).toMatchObject({
      effectId: "book-court",
      wouldPerform: true,
    });

    const blockedEffect = await simulateAutomation({
      scopeRoot: dir,
      definitions: [bookingWorkflow],
      moduleManifests: [capabilityManifest({ hooks: [], simulationBlocked: true })],
      request: {
        event: "booking.requested",
        payload: {},
      },
    });
    expect(blockedEffect.inputs[0]?.outcome).toBe("would-queue");
    expect(blockedEffect.inputs[0]?.effects[0]).toMatchObject({
      effectId: "book-court",
      blocked: true,
      wouldPerform: false,
    });
  });

  it("checks typed envelope duplicates through workflow dispatch idempotency", async () => {
    const payload = {
      scopeId: "scope-a",
      requestedBy: "operator",
      idempotencyStatus: "replayed",
    };
    const envelope = eventEnvelope({
      id: "evtj-booking-duplicate",
      sequence: 1,
      event: "booking.requested",
      payload,
    });
    const store = recordWorkflowDispatch({
      dir,
      workflowName: "booking-workflow",
      event: "booking.requested",
      eventId: envelope.id,
      payload,
      runId: "booking-run-1",
    });

    const preview = await simulateAutomation({
      scopeRoot: dir,
      definitions: [bookingWorkflow],
      request: {
        envelope,
      },
    });

    expect(preview.inputs[0]?.outcome).toBe("would-noop");
    expect(preview.inputs[0]?.reasons).toContainEqual(
      expect.objectContaining({
        code: "idempotency-duplicate",
        event: "booking.requested",
      }),
    );
    expect(preview.inputs[0]?.explain.graph.automation.workflows).toContainEqual(
      expect.objectContaining({ name: "booking-workflow" }),
    );
    expect(store.list({ operation: "event-ingestion" })).toMatchObject([
      {
        status: "accepted",
        duplicateCount: 0,
      },
    ]);
  });

  it("replays committed fixture envelopes and journal cursors without live provider calls", async () => {
    const fixture = getSimulationFixture("weekly-progress-review-journal-replay");
    expect(fixture?.request.envelope).toBeDefined();
    const envelope = fixture!.request.envelope!;
    eventJournalForScope(dir).appendEnvelope(envelope);

    const replayed = await simulateAutomation({
      scopeRoot: dir,
      definitions: [progressReviewer],
      request: {
        journal: {
          id: envelope.id,
        },
      },
    });

    expect(replayed.inputs).toHaveLength(1);
    expect(replayed.inputs[0]).toMatchObject({
      source: {
        kind: "journal",
        journalId: envelope.id,
      },
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      outcome: "would-queue",
      dryRuns: [
        {
          workflow: "progress-reviewer",
          pass: true,
          triggerMatch: {
            matched: true,
            matchedEvent: WORKFLOW_BATCH_FLUSH_EVENT,
          },
        },
      ],
    });
  });

  it("checks journal replay duplicates through workflow dispatch idempotency", async () => {
    const payload = {
      scopeId: "scope-a",
      requestedBy: "operator",
      idempotencyStatus: "replayed",
    };
    const envelope = eventEnvelope({
      id: "evtj-booking-journal-duplicate",
      sequence: 2,
      event: "booking.requested",
      payload,
    });
    eventJournalForScope(dir).appendEnvelope(envelope);
    recordWorkflowDispatch({
      dir,
      workflowName: "booking-workflow",
      event: "booking.requested",
      eventId: envelope.id,
      payload,
      runId: "booking-run-2",
    });

    const replayed = await simulateAutomation({
      scopeRoot: dir,
      definitions: [bookingWorkflow],
      request: {
        journal: {
          id: envelope.id,
        },
      },
    });

    expect(replayed.inputs[0]).toMatchObject({
      source: {
        kind: "journal",
        journalId: envelope.id,
      },
      outcome: "would-noop",
    });
    expect(replayed.inputs[0]?.reasons).toContainEqual(
      expect.objectContaining({
        code: "idempotency-duplicate",
      }),
    );
    expect(replayed.inputs[0]?.explain.graph.automation.workflows).toContainEqual(
      expect.objectContaining({ name: "booking-workflow" }),
    );
  });

  it("keeps provider fixture coverage visible", () => {
    expect(SIMULATION_FIXTURES.map((fixture) => fixture.name)).toEqual(
      expect.arrayContaining([
        "telegram-sports-ignored",
        "telegram-sports-batched",
        "telegram-sports-accepted",
        "slack-high-volume-batched",
        "gmail-owner-confirmation-message",
        "file-watch-change",
        "task-progress-batched",
        "weekly-progress-review-journal-replay",
      ]),
    );
  });
});
