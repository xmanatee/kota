import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { WorkflowBatchDispatchInput } from "#core/workflow/event-batches.js";
import {
  type InboundSignalReceivedPayload,
  type InboundSignalRoutedPayload,
  inboundSignalReceived,
  inboundSignalRouted,
  normalizeInboundSignalInput,
  validateInboundSignalPayload,
} from "./events.js";
import inboundSignalsModule from "./index.js";
import {
  inboundSignalRouteStatusControlRoutes,
  inboundSignalRouteStatusRoutes,
} from "./routes.js";
import {
  dispatchInboundSignalRoute,
  type InboundSignalRoutingConfig,
  type InboundSignalRoutingStatus,
  inboundSignalRoutingStatus,
  validateInboundSignalRoutingConfig,
} from "./routing.js";

const RECEIVED_AT = "2026-05-25T02:40:00.000Z";

function sampleSignal(): InboundSignalReceivedPayload {
  return {
    scopeId: "project-1",
    projectId: "project-1",
    provider: "webhook",
    channel: "http",
    accountId: "manual",
    sourceId: "curl/demo",
    sourceUrl: "https://example.test/signals/demo",
    externalId: "delivery-1",
    occurredAt: "2026-05-25T02:39:55.000Z",
    receivedAt: RECEIVED_AT,
    actor: {
      id: "owner@example.test",
      displayName: "Owner",
      trust: "trusted",
      trustReason: "authenticated daemon API token",
    },
    body: {
      kind: "message",
      format: "plain",
      text: "Capture this into the appropriate workflow.",
    },
  };
}

function makeRouteStatus(): InboundSignalRoutingStatus {
  return {
    routes: [],
    validation: { ok: true, routes: [] },
  };
}

function makeRecordingTransport(
  response: InboundSignalRoutingStatus | null,
): {
  transport: DaemonTransport;
  calls: Array<{ method: string; path: string; body: unknown }>;
} {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  return {
    calls,
    transport: {
      baseUrl: "http://127.0.0.1:0",
      authHeaders: () => ({}),
      request: async <T>(method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        return response as T | null;
      },
      requestStrict: async <_T>() => {
        throw new Error("requestStrict not expected");
      },
      fetchRaw: async () => new Response(null, { status: 200 }),
      events: async function* () {
        // empty generator
      },
    },
  };
}

function makeModuleContext(options: {
  workflowNames: readonly string[];
  agentNames?: readonly string[];
  config?: InboundSignalRoutingConfig;
}): ModuleContext {
  const workflowNames = [...options.workflowNames];
  const agentNames = [...(options.agentNames ?? [])];
  const summary: ModuleSummary = {
    name: "test",
    source: "project",
    dependencies: [],
    toolNames: [],
    workflowNames,
    channelNames: [],
    skillNames: [],
    agentNames,
    agents: [],
    skills: [],
    commandNames: [],
    routeSummaries: [],
  };
  const ctx = {
    cwd: process.cwd(),
    verbose: false,
    config: {},
    storage: {},
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getSecret: () => null,
    getModuleConfig: <T>() => options.config as T | undefined,
    getRegisteredConfigKeys: () => new Set(),
    getRoutes: () => [],
    getContributedControlRoutes: () => [],
    getContributedWorkflows: () =>
      workflowNames.map((name) => ({
        name,
        definitionPath: `test/${name}.ts`,
        triggers: [],
        steps: [],
      })),
    getContributedChannels: () => [],
    getContributedUiSurfaces: () => [],
    getModuleSummaries: () => [summary],
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    callTool: async () => ({ content: "" }),
    listTools: () => [],
    events: {
      emit: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      emitExternal: vi.fn(),
      subscribeExternal: vi.fn(() => () => undefined),
      listenerCount: () => 0,
    },
    getProvider: () => null,
    createSession: () => ({
      send: async () => "",
      close: vi.fn(),
    }),
    client: {},
  };
  return ctx as unknown as ModuleContext;
}

describe("inbound-signals module", () => {
  it("owns the project-scoped inbound signal event declaration", () => {
    expect(inboundSignalsModule.events).toEqual([
      inboundSignalReceived,
      inboundSignalRouted,
    ]);
    expect(inboundSignalReceived.name).toBe("inbound.signal.received");
    expect(inboundSignalReceived.scope).toBe("project");
    expect(inboundSignalReceived.fields).toEqual([
      "scopeId",
      "projectId",
      "provider",
      "channel",
      "accountId",
      "sourceId",
      "sourceUrl",
      "externalId",
      "occurredAt",
      "receivedAt",
      "actor",
      "body",
    ]);
    expect(inboundSignalReceived.workflowTriggerPolicy).toBe("blocked");
  });

  it("owns the routed audit event declaration that workflows can filter", () => {
    expect(inboundSignalRouted.name).toBe("inbound.signal.routed");
    expect(inboundSignalRouted.scope).toBe("project");
    expect(inboundSignalRouted.filterablePaths).toEqual([
      "scopeId",
      "projectId",
      "routeId",
      "decision",
      "sourceStatus",
      "provider",
      "channel",
      "accountId",
      "sourceId",
      "actorTrust",
      "policy.blockedHandling",
    ]);
    expect(inboundSignalRouted.workflowTriggerPolicy).toBe("blocked");
  });

  it("keeps public and daemon-control route paths distinct", async () => {
    const status = makeRouteStatus();

    expect(
      inboundSignalRouteStatusRoutes(() => status).map((route) =>
        `${route.method} ${route.path}`
      ),
    ).toEqual(["GET /api/inbound-signals/routes"]);
    expect(
      inboundSignalRouteStatusControlRoutes(() => status).map((route) =>
        `${route.method} ${route.path} (${route.capabilityScope})`
      ),
    ).toEqual(["GET /inbound-signals/routes (read)"]);

    const { transport, calls } = makeRecordingTransport(status);
    const client = inboundSignalsModule.daemonClient!(transport).inboundSignals!;
    await expect(client.listRoutes({ projectId: "project-1" })).resolves.toEqual(
      status,
    );
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/inbound-signals/routes?projectId=project-1",
        body: undefined,
      },
    ]);
  });

  it("keeps built-in GitHub mention workflows reachable through declarative routes", async () => {
    const ctx = makeModuleContext({
      workflowNames: [
        "github-mention-intake",
        "github-mention-responder",
        "progress-reviewer",
      ],
    });
    const client = inboundSignalsModule.localClient!(ctx).inboundSignals!;

    await expect(client.listRoutes()).resolves.toMatchObject({
      validation: { ok: true },
      routes: [
        {
          id: "github-issue-comment-mentions",
          provider: "github",
          channel: "github.issue_comment",
          targets: [
            { kind: "workflow", name: "github-mention-intake" },
            { kind: "workflow", name: "github-mention-responder" },
            {
              kind: "workflow",
              name: "progress-reviewer",
              batch: {
                mode: "workflow-trigger",
                maxItems: 10,
                idleMs: 600000,
                maxBufferSize: 30,
                overflow: "flush-oldest",
                groupBy: ["channel", "sourceId"],
              },
            },
          ],
        },
      ],
    });
  });

  it("adds progress-reviewer as a batched target on configured routes", async () => {
    const ctx = makeModuleContext({
      workflowNames: ["capture-inbound-signal", "progress-reviewer"],
      config: {
        routes: [
          {
            id: "slack-capture",
            provider: "slack",
            channel: "slack.message",
            targets: [{ kind: "workflow", name: "capture-inbound-signal" }],
          },
        ],
      },
    });
    const client = inboundSignalsModule.localClient!(ctx).inboundSignals!;

    const status = await client.listRoutes();
    expect(status.validation).toMatchObject({ ok: true });
    expect(status.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "slack-capture",
          targets: expect.arrayContaining([
            { kind: "workflow", name: "capture-inbound-signal" },
            {
              kind: "workflow",
              name: "progress-reviewer",
              batch: expect.objectContaining({
                mode: "workflow-trigger",
                maxItems: 10,
                idleMs: 600000,
              }),
            },
          ]),
        }),
      ]),
    );
  });

  it("validates the required scope, identity, trust, source, timestamp, and body fields", () => {
    expect(validateInboundSignalPayload(sampleSignal())).toMatchObject({ ok: true });

    expect(
      validateInboundSignalPayload({ ...sampleSignal(), scopeId: "" }),
    ).toEqual({
      ok: false,
      error: "scopeId must be a non-empty string",
    });
    expect(
      validateInboundSignalPayload({ ...sampleSignal(), projectId: "" }),
    ).toEqual({
      ok: false,
      error: "projectId must be a non-empty string",
    });
    expect(
      validateInboundSignalPayload({ ...sampleSignal(), projectId: "other" }),
    ).toEqual({
      ok: false,
      error: "scopeId and projectId must match",
    });
    expect(
      validateInboundSignalPayload({
        ...sampleSignal(),
        actor: { ...sampleSignal().actor, trust: "unknown" as never },
      }),
    ).toEqual({
      ok: false,
      error: "actor.trust must be trusted, untrusted, or blocked",
    });
    expect(
      validateInboundSignalPayload({
        ...sampleSignal(),
        body: { kind: "message", format: "plain", text: "" },
      }),
    ).toEqual({
      ok: false,
      error: "body.text must be a non-empty string",
    });
    expect(
      validateInboundSignalPayload({
        ...sampleSignal(),
        occurredAt: "not-a-date",
      }),
    ).toEqual({
      ok: false,
      error: "occurredAt must be an ISO-compatible timestamp",
    });
  });

  it("rejects malformed internal message bodies at the event emit boundary", () => {
    const bus = new EventBus();
    const received: InboundSignalReceivedPayload[] = [];
    bus.on(inboundSignalReceived, (payload) => received.push(payload));

    expect(() =>
      bus.emit(inboundSignalReceived, {
        ...sampleSignal(),
        body: { kind: "message" },
      } as unknown as never),
    ).toThrow(/payload\.body\.format is required/);
    expect(received).toEqual([]);
  });

  it("normalizes an adapter input by injecting project scope and receive time", () => {
    const result = normalizeInboundSignalInput(
      {
        provider: "webhook",
        channel: "http",
        accountId: "manual",
        sourceId: "curl/demo",
        sourceUrl: "https://example.test/signals/demo",
        externalId: "delivery-2",
        occurredAt: "2026-05-25T02:41:00.000Z",
        actor: {
          id: "owner@example.test",
          displayName: "Owner",
          trust: "trusted",
          trustReason: "authenticated daemon API token",
        },
        body: {
          kind: "action",
          action: "task.capture",
          label: "Capture task request",
          data: { title: "Investigate inbound automation", urgent: false },
        },
      },
      { projectId: "project-2", receivedAt: RECEIVED_AT },
    );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        scopeId: "project-2",
        projectId: "project-2",
        receivedAt: RECEIVED_AT,
        body: {
          kind: "action",
          action: "task.capture",
        },
      },
    });
  });
});

const routingContext = {
  workflowNames: new Set(["capture-inbound-signal", "audit-inbound-signal"]),
  agentNames: new Set(["owner-triage"]),
};

describe("inbound signal routing", () => {
  it("validates route targets and rejects ambiguous overlapping route rules", () => {
    const result = validateInboundSignalRoutingConfig(
      {
        routes: [
          {
            id: "slack-capture",
            provider: "slack",
            channel: "slack.message",
            targets: [{ kind: "workflow", name: "capture-inbound-signal" }],
          },
          {
            id: "slack-capture-specific",
            provider: "slack",
            channel: "slack.message",
            sourceId: "slack:T123:channel:D123",
            targets: [{ kind: "workflow", name: "missing-workflow" }],
          },
        ],
      },
      routingContext,
    );

    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        {
          routeId: "slack-capture-specific",
          message: 'target workflow "missing-workflow" is not registered',
        },
        {
          routeId: "slack-capture",
          message:
            'route overlaps route "slack-capture-specific"; combine targets into one deterministic rule',
        },
      ]),
    });
  });

  it("requires agent route targets to declare their execution budget", () => {
    const result = validateInboundSignalRoutingConfig(
      {
        routes: [
          {
            id: "slack-agent",
            provider: "slack",
            channel: "slack.message",
            targets: [{ kind: "agent", name: "owner-triage" } as never],
          },
        ],
      },
      routingContext,
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          routeId: "slack-agent",
          message: "target.maxTurns must be a positive integer for agent targets",
        },
      ],
    });
  });

  it("projects routes and source statuses through the shared inspection contract", () => {
    const status = inboundSignalRoutingStatus(
      {
        routes: [
          {
            id: "telegram-blocked-chat",
            provider: "telegram",
            channel: "telegram.message",
            actorTrust: "blocked",
            sourceStatus: "blocked",
            targets: [{ kind: "workflow", name: "audit-inbound-signal" }],
          },
        ],
      },
      routingContext,
    );

    expect(status).toEqual({
      validation: {
        ok: true,
        routes: [
          {
            id: "telegram-blocked-chat",
            provider: "telegram",
            channel: "telegram.message",
            actorTrust: "blocked",
            sourceStatus: "blocked",
            targets: [{ kind: "workflow", name: "audit-inbound-signal" }],
          },
        ],
      },
      routes: [
        {
          id: "telegram-blocked-chat",
          provider: "telegram",
          channel: "telegram.message",
          accountId: "*",
          sourceId: "*",
          actorTrust: "blocked",
          scopeId: "(signal scope)",
          sourceStatus: "blocked",
          blockedHandling: "audit-only",
          targets: [{ kind: "workflow", name: "audit-inbound-signal" }],
          batch: null,
          processing: null,
        },
      ],
    });
  });

  it("routes an active configured source into a workflow batch with scoped payload", async () => {
    const emitted: InboundSignalRoutedPayload[] = [];
    const batched: WorkflowBatchDispatchInput[] = [];
    const config: InboundSignalRoutingConfig = {
      routes: [
        {
          id: "slack-capture",
          provider: "slack",
          channel: "slack.message",
          actorTrust: "trusted",
          scopeId: "project-routed",
          targets: [{ kind: "workflow", name: "capture-inbound-signal" }],
          batch: {
            mode: "workflow-trigger",
            maxItems: 25,
            maxAgeMs: 120000,
            groupBy: ["provider", "sourceId"],
          },
          processing: {
            classifier: "cheap",
            modelTier: "balanced",
          },
        },
      ],
    };

    const result = await dispatchInboundSignalRoute({
      config,
      signal: { ...sampleSignal(), provider: "slack", channel: "slack.message" },
      context: routingContext,
      deps: {
        async triggerWorkflow() {
          throw new Error("immediate workflow dispatch not expected");
        },
        async batchWorkflow(input) {
          batched.push(input);
          return {
            ok: true,
            status: "batched",
          };
        },
        emitRouted(payload) {
          emitted.push(payload);
        },
      },
    });

    expect(batched).toHaveLength(1);
    expect(batched[0]).toMatchObject({
      workflowName: "capture-inbound-signal",
      event: "inbound.signal.received",
      schemaRef: null,
      batch: {
        maxCount: 25,
        maxAgeMs: 120000,
        groupBy: ["provider", "sourceId"],
        maxBufferSize: 100,
        overflow: "flush-oldest",
      },
      payload: {
        scopeId: "project-routed",
        projectId: "project-routed",
        routeId: "slack-capture",
        provider: "slack",
        channel: "slack.message",
        policy: {
          batch: {
            mode: "workflow-trigger",
            maxItems: 25,
            maxAgeMs: 120000,
            maxBufferSize: 100,
            overflow: "flush-oldest",
            groupBy: ["provider", "sourceId"],
          },
          processing: {
            classifier: "cheap",
            modelTier: "balanced",
          },
        },
      },
    });
    expect(emitted).toEqual([result]);
    expect(result).toMatchObject({
      scopeId: "project-routed",
      projectId: "project-routed",
      routeId: "slack-capture",
      decision: "dispatched",
      targets: [
        {
          kind: "workflow",
          name: "capture-inbound-signal",
          status: "batched",
        },
      ],
    });
  });

  it("routes an active configured source to a registered agent target", async () => {
    const emitted: InboundSignalRoutedPayload[] = [];
    const triggered: Array<{
      name: string;
      maxTurns: number;
      autonomyMode: "passive" | "autonomous";
      payload: Record<string, unknown>;
    }> = [];
    const config: InboundSignalRoutingConfig = {
      routes: [
        {
          id: "slack-agent-triage",
          provider: "slack",
          channel: "slack.message",
          actorTrust: "trusted",
          scopeId: "project-agent-routed",
          processing: {
            allowNonReadActions: true,
          },
          targets: [{ kind: "agent", name: "owner-triage", maxTurns: 4 }],
        },
      ],
    };

    const result = await dispatchInboundSignalRoute({
      config,
      signal: { ...sampleSignal(), provider: "slack", channel: "slack.message" },
      context: routingContext,
      deps: {
        async triggerWorkflow() {
          throw new Error("workflow dispatch not expected");
        },
        async triggerAgent(name, options) {
          triggered.push({
            name,
            maxTurns: options.maxTurns,
            autonomyMode: options.autonomyMode,
            payload: options.payload,
          });
          return { ok: true, sessionId: "agent-session-slack-triage" };
        },
        emitRouted(payload) {
          emitted.push(payload);
        },
      },
    });

    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({
      name: "owner-triage",
      maxTurns: 4,
      autonomyMode: "autonomous",
      payload: {
        scopeId: "project-agent-routed",
        projectId: "project-agent-routed",
        routeId: "slack-agent-triage",
        provider: "slack",
        channel: "slack.message",
        target: {
          kind: "agent",
          name: "owner-triage",
          maxTurns: 4,
        },
      },
    });
    expect(emitted).toEqual([result]);
    expect(result).toMatchObject({
      scopeId: "project-agent-routed",
      projectId: "project-agent-routed",
      routeId: "slack-agent-triage",
      decision: "dispatched",
      targets: [
        {
          kind: "agent",
          name: "owner-triage",
          status: "completed",
          sessionId: "agent-session-slack-triage",
        },
      ],
    });
  });

  it("records a blocked-source routed event without starting processing workflows", async () => {
    const emitted: InboundSignalRoutedPayload[] = [];
    const triggerWorkflow = vi.fn(async () => ({
      ok: false as const,
      reason: "already_queued" as const,
    }));
    const blockedSignal = {
      ...sampleSignal(),
      provider: "telegram",
      channel: "telegram.message",
      actor: {
        ...sampleSignal().actor,
        trust: "blocked" as const,
        trustReason: "Telegram chat id is configured as blocked",
      },
    };

    const result = await dispatchInboundSignalRoute({
      config: {
        routes: [
          {
            id: "telegram-blocked-chat",
            provider: "telegram",
            channel: "telegram.message",
            actorTrust: "blocked",
            sourceStatus: "blocked",
            targets: [{ kind: "workflow", name: "capture-inbound-signal" }],
          },
        ],
      },
      signal: blockedSignal,
      context: routingContext,
      deps: {
        triggerWorkflow,
        emitRouted(payload) {
          emitted.push(payload);
        },
      },
    });

    expect(triggerWorkflow).not.toHaveBeenCalled();
    expect(emitted).toEqual([result]);
    expect(result).toMatchObject({
      routeId: "telegram-blocked-chat",
      decision: "blocked",
      sourceStatus: "blocked",
      actorTrust: "blocked",
      targets: [
        {
          kind: "workflow",
          name: "capture-inbound-signal",
          status: "skipped",
          reason: "source status is blocked; route is audit-only",
        },
      ],
    });
  });

  it("records an archived-source routed event without starting processing workflows and exposes status", async () => {
    const emitted: InboundSignalRoutedPayload[] = [];
    const triggerWorkflow = vi.fn(async () => ({
      ok: true as const,
      path: "daemon" as const,
      queued: "capture-inbound-signal",
      runId: "run-archived",
    }));
    const config: InboundSignalRoutingConfig = {
      routes: [
        {
          id: "slack-archived-channel",
          provider: "slack",
          channel: "slack.message",
          sourceId: "slack:T123:channel:CARCHIVE",
          sourceStatus: "archived",
          targets: [{ kind: "workflow", name: "capture-inbound-signal" }],
        },
      ],
    };

    const status = inboundSignalRoutingStatus(config, routingContext);
    expect(status.routes).toEqual([
      expect.objectContaining({
        id: "slack-archived-channel",
        sourceId: "slack:T123:channel:CARCHIVE",
        sourceStatus: "archived",
        blockedHandling: "audit-only",
      }),
    ]);

    const result = await dispatchInboundSignalRoute({
      config,
      signal: {
        ...sampleSignal(),
        provider: "slack",
        channel: "slack.message",
        accountId: "slack:T123",
        sourceId: "slack:T123:channel:CARCHIVE",
      },
      context: routingContext,
      deps: {
        triggerWorkflow,
        emitRouted(payload) {
          emitted.push(payload);
        },
      },
    });

    expect(triggerWorkflow).not.toHaveBeenCalled();
    expect(emitted).toEqual([result]);
    expect(result).toMatchObject({
      routeId: "slack-archived-channel",
      decision: "archived",
      sourceStatus: "archived",
      sourceId: "slack:T123:channel:CARCHIVE",
      targets: [
        {
          kind: "workflow",
          name: "capture-inbound-signal",
          status: "skipped",
          reason: "source status is archived; route is audit-only",
        },
      ],
    });
  });
});
