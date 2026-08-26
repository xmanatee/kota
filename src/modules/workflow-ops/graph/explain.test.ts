import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { EVIDENCE_REDACTED } from "#core/evidence/policy.js";
import {
  buildModuleCapabilityManifestProjection,
  type ModuleCapabilityManifestProjection,
  type ModuleManifestContributionSnapshot,
} from "#core/modules/module-manifest.js";
import { daemonWriteEffect } from "#core/tools/effect.js";
import type { WorkflowStep } from "#core/workflow/step-types.js";
import type {
  WorkflowRunTrigger,
  WorkflowTrigger,
} from "#core/workflow/trigger-types.js";
import { WORKFLOW_BATCH_FLUSH_EVENT } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { assembleCompiledAutomationGraph, explainAutomation } from "./explain.js";

type ChannelPayload = {
  scopeId: string;
  channel: string;
  conversationId: string;
  sourceStatus?: string;
  actor?: { trust?: string };
  accessToken?: string;
  idempotencyStatus?: string;
};

type CodeHookPayload = {
  repository: string;
  ref: string;
  changedFiles?: readonly string[];
  authorization?: string;
  idempotencyStatus?: string;
};

const channelEvent = defineDaemonWideModuleEvent<ChannelPayload>(
  "inbound.signal.received",
  [
    "scopeId",
    "channel",
    "conversationId",
    "sourceStatus",
    "actor",
    "accessToken",
    "idempotencyStatus",
  ],
  {
    sensitivity: "sensitive",
    filterablePaths: ["channel", "sourceStatus", "actor.trust"],
    payloadSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        scopeId: { type: "string" },
        channel: { type: "string" },
        conversationId: { type: "string" },
        sourceStatus: { type: "string", required: false },
        actor: {
          type: "object",
          required: false,
          additionalProperties: true,
          properties: {
            trust: { type: "string", required: false },
          },
        },
        accessToken: { type: "string", required: false, sensitivity: "secret" },
        idempotencyStatus: { type: "string", required: false },
      },
    },
  },
);

const codeHookEvent = defineDaemonWideModuleEvent<CodeHookPayload>(
  "code.hook.received",
  ["repository", "ref", "changedFiles", "authorization", "idempotencyStatus"],
  {
    sensitivity: "sensitive",
    filterablePaths: ["repository", "ref"],
    payloadSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        repository: { type: "string" },
        ref: { type: "string" },
        changedFiles: {
          type: "array",
          required: false,
          items: { type: "string" },
        },
        authorization: { type: "string", required: false, sensitivity: "secret" },
        idempotencyStatus: { type: "string", required: false },
      },
    },
  },
);

function trigger(
  overrides: Partial<WorkflowTrigger> & Pick<WorkflowTrigger, "event">,
): WorkflowTrigger {
  return {
    cooldownMs: 0,
    ...overrides,
  };
}

function workflow(
  overrides: {
    name: string;
    triggers?: readonly WorkflowTrigger[];
    steps?: readonly WorkflowStep[];
    enabled?: boolean;
    inputSchema?: Record<string, unknown>;
  },
): WorkflowDefinition {
  return {
    name: overrides.name,
    enabled: overrides.enabled ?? true,
    moduleRoot: "/tmp/kota-tests",
    repository: "none",
    tags: [],
    definitionPath: `/tmp/kota-tests/${overrides.name}/workflow.ts`,
    triggers: [...(overrides.triggers ?? [trigger({ event: "runtime.idle" })])],
    steps: [...(overrides.steps ?? [])],
    ...(overrides.inputSchema !== undefined ? { inputSchema: overrides.inputSchema } : {}),
  };
}

function baseSnapshot(
  overrides: Partial<ModuleManifestContributionSnapshot> = {},
): ModuleManifestContributionSnapshot {
  return {
    dependencies: [],
    tools: [],
    effects: [],
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
    localClientNamespaces: [],
    hasDaemonClientFactory: false,
    setupRequirements: [],
    hasHealthCheck: false,
    ...overrides,
  };
}

function channelManifest(): ModuleCapabilityManifestProjection {
  return buildModuleCapabilityManifestProjection(
    "channel-telegram",
    {
      schemaVersion: 1,
      capabilities: [
        {
          id: "channel-telegram.send",
          description: "Send Telegram messages.",
          scope: "scope",
          scopePolicyHooks: ["setup"],
          setupRequirementIds: ["telegram-token"],
        },
      ],
      dataClasses: [],
      simulation: {
        support: "unsupported",
        blockedReasons: ["daemon writes are isolated in explain tests"],
      },
    },
    baseSnapshot({
      tools: [
        {
          name: "send_channel_reply",
          description: "Send a channel reply.",
          effect: daemonWriteEffect(),
        },
      ],
      setupRequirements: [
        {
          id: "telegram-token",
          kind: "secret",
          setupMode: "url",
          sensitivity: "secret",
          required: true,
          healthCapabilityIds: [],
          statusLinks: {
            list: "/setup",
            refresh: "/setup/telegram-token/refresh",
            revoke: "/setup/telegram-token/revoke",
            start: "/setup/telegram-token/start",
          },
          availability: {
            state: "missing",
            reason: "missing_secret",
            message: "Telegram token is missing.",
          },
        },
      ],
    }),
  );
}

function ownerGateManifest(): ModuleCapabilityManifestProjection {
  return buildModuleCapabilityManifestProjection(
    "code-hooks",
    {
      schemaVersion: 1,
      capabilities: [
        {
          id: "code-hooks.apply",
          description: "Apply changes from code hooks.",
          scope: "scope",
          scopePolicyHooks: ["owner-confirmation"],
        },
      ],
      dataClasses: [],
      simulation: {
        support: "unsupported",
        blockedReasons: ["daemon writes are isolated in explain tests"],
      },
    },
    baseSnapshot({
      tools: [
        {
          name: "apply_code_hook",
          description: "Apply a code hook.",
          effect: daemonWriteEffect(),
        },
      ],
    }),
  );
}

function sample(
  event: string,
  payload: WorkflowRunTrigger["payload"],
): { event: string; payload: WorkflowRunTrigger["payload"] } {
  return { event, payload };
}

beforeEach(() => {
  resetModuleEventRegistry();
  const moduleEvents = initModuleEventRegistry();
  moduleEvents.register("inbound-signals", channelEvent);
  moduleEvents.register("code-hooks", codeHookEvent);
});

afterEach(() => {
  resetModuleEventRegistry();
});

describe("compiled automation explain graph", () => {
  it("matches events to workflows and includes downstream edges", () => {
    const definitions = [
      workflow({
        name: "match-channel-opportunity",
        triggers: [
          trigger({
            event: "inbound.signal.received",
            filter: { channel: "telegram" },
          }),
        ],
        steps: [
          {
            type: "emit",
            id: "matched",
            event: "opportunity.matched",
          },
          {
            type: "trigger",
            id: "start-booking",
            workflow: "book-slot",
            waitFor: "queued",
          },
        ],
      }),
      workflow({
        name: "notify-owner",
        triggers: [trigger({ event: "opportunity.matched" })],
      }),
      workflow({
        name: "book-slot",
        triggers: [trigger({ event: "manual" })],
      }),
    ];

    const result = explainAutomation(definitions, {
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
      }),
    });

    expect(result.outcome).toBe("queued");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      workflow: "match-channel-opportunity",
      triggerIndex: 0,
      triggerEvent: "inbound.signal.received",
    });
    expect(result.matches[0].downstream).toEqual([
      {
        fromWorkflow: "match-channel-opportunity",
        kind: "event",
        target: "opportunity.matched",
        consumers: ["notify-owner"],
        stepId: "matched",
      },
      {
        fromWorkflow: "match-channel-opportunity",
        kind: "workflow",
        target: "book-slot",
        consumers: ["book-slot"],
        stepId: "start-booking",
      },
    ]);
    expect(result.graph.automation.events.find((event) =>
      event.name === "inbound.signal.received"
    )?.schema).toMatchObject({
      declared: true,
      module: "inbound-signals",
      sensitivity: "sensitive",
    });
  });

  it("ignores blocked inbound sources before queue matching", () => {
    const result = explainAutomation([
      workflow({
        name: "match-channel-opportunity",
        triggers: [trigger({ event: "inbound.signal.received" })],
      }),
    ], {
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
        sourceStatus: "blocked",
      }),
    });

    expect(result.outcome).toBe("ignored");
    expect(result.matches).toEqual([]);
    expect(result.reasons).toContainEqual({
      code: "source-ignored",
      severity: "blocker",
      event: "inbound.signal.received",
      message: "source status is blocked",
    });
  });

  it("explains pending batches and generated batch flushes", () => {
    const definitions = [
      workflow({
        name: "batch-channel-signals",
        triggers: [
          trigger({
            event: "inbound.signal.received",
            batch: {
              maxCount: 3,
              maxBufferSize: 50,
              groupBy: ["conversationId"],
              overflow: "flush-oldest",
            },
          }),
        ],
      }),
    ];

    const pending = explainAutomation(definitions, {
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
      }),
    });
    expect(pending.outcome).toBe("batched");
    expect(pending.matches[0].batch).toMatchObject({
      maxCount: 3,
      maxBufferSize: 50,
      groupBy: ["conversationId"],
      overflow: "flush-oldest",
    });
    expect(pending.reasons.map((reason) => reason.code)).toContain("batch-pending");

    const flushed = explainAutomation(definitions, {
      sampleEvent: sample(WORKFLOW_BATCH_FLUSH_EVENT, {
        scopeId: "scope-a",
        sourceEventName: "inbound.signal.received",
        groupingKey: "conversationId=thread-1",
        reason: "count",
        count: 3,
        window: {
          firstEventAt: "2026-06-19T00:00:00.000Z",
          lastEventAt: "2026-06-19T00:01:00.000Z",
          flushedAt: "2026-06-19T00:01:01.000Z",
        },
        inputEvents: [],
        batch: {
          workflow: "batch-channel-signals",
          triggerIndex: 0,
          maxBufferSize: 50,
          overflow: "flush-oldest",
          droppedInputCount: 0,
        },
      }),
    });
    expect(flushed.outcome).toBe("queued");
    expect(flushed.reasons.map((reason) => reason.code)).toContain("batch-flush-match");
  });

  it("surfaces setup blockers from module manifests", () => {
    const result = explainAutomation([
      workflow({
        name: "reply-to-channel",
        triggers: [trigger({ event: "inbound.signal.received" })],
        steps: [
          {
            type: "tool",
            id: "send-reply",
            tool: "send_channel_reply",
          },
        ],
      }),
    ], {
      moduleManifests: [channelManifest()],
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
      }),
    });

    expect(result.outcome).toBe("blocked");
    expect(result.matches[0].blockers).toContainEqual({
      kind: "setup",
      workflow: "reply-to-channel",
      moduleName: "channel-telegram",
      capabilityIds: ["channel-telegram.send"],
      setupRequirementId: "telegram-token",
      state: "missing",
      reason: "Telegram token is missing.",
    });
  });

  it("treats duplicate idempotency status as a no-op", () => {
    const result = explainAutomation([
      workflow({
        name: "match-channel-opportunity",
        triggers: [trigger({ event: "inbound.signal.received" })],
      }),
    ], {
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
        idempotencyStatus: "replayed",
      }),
    });

    expect(result.outcome).toBe("no-op");
    expect(result.reasons).toContainEqual({
      code: "idempotency-duplicate",
      severity: "info",
      event: "inbound.signal.received",
      message: "event idempotency status is replayed",
    });
  });

  it("surfaces owner confirmation gates from module manifests", () => {
    const result = explainAutomation([
      workflow({
        name: "apply-code-hook",
        triggers: [trigger({ event: "code.hook.received" })],
        steps: [
          {
            type: "tool",
            id: "apply",
            tool: "apply_code_hook",
          },
        ],
      }),
    ], {
      moduleManifests: [ownerGateManifest()],
      sampleEvent: sample("code.hook.received", {
        repository: "acme/repo",
        ref: "refs/heads/main",
        changedFiles: ["src/index.ts"],
      }),
    });

    expect(result.outcome).toBe("blocked");
    expect(result.matches[0].blockers).toContainEqual({
      kind: "owner-confirmation",
      workflow: "apply-code-hook",
      capabilityIds: ["code-hooks.apply"],
      reason: "code-hooks.code-hooks.apply participates in owner-confirmation policy",
    });
  });

  it("dead-letters samples that match a trigger but fail the workflow input schema", () => {
    const result = explainAutomation([
      workflow({
        name: "strict-channel-match",
        triggers: [trigger({ event: "inbound.signal.received" })],
        inputSchema: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string" },
          },
          additionalProperties: true,
        },
      }),
    ], {
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
      }),
    });

    expect(result.outcome).toBe("dead-letter");
    expect(result.matches).toHaveLength(1);
    expect(result.reasons).toContainEqual({
      code: "workflow-input-schema-invalid",
      severity: "blocker",
      workflow: "strict-channel-match",
      event: "inbound.signal.received",
      triggerIndex: 0,
      message: 'payload failed workflow inputSchema: payload: missing required field "text"',
    });
  });

  it("does not treat event-type-only filtered triggers as definite matches", () => {
    const result = explainAutomation([
      workflow({
        name: "filtered-channel-match",
        triggers: [
          trigger({
            event: "inbound.signal.received",
            filter: { channel: "telegram" },
          }),
        ],
      }),
    ], {
      eventName: "inbound.signal.received",
    });

    expect(result.outcome).toBe("unknown");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      workflow: "filtered-channel-match",
      triggerIndex: 0,
      triggerEvent: "inbound.signal.received",
      matchedFilter: false,
    });
    expect(result.reasons).toContainEqual({
      code: "filter-payload-required",
      severity: "warning",
      workflow: "filtered-channel-match",
      event: "inbound.signal.received",
      triggerIndex: 0,
      message: 'trigger 0 for filtered-channel-match has filter channel="telegram"; provide a sample payload to determine whether it matches',
    });
  });

  it("dead-letters schema-invalid samples and redacts sensitive payload fields", () => {
    const invalid = explainAutomation([
      workflow({
        name: "apply-code-hook",
        triggers: [trigger({ event: "code.hook.received" })],
      }),
    ], {
      sampleEvent: sample("code.hook.received", {
        repository: 42,
        ref: "refs/heads/main",
        authorization: "Bearer secret-token",
      }),
    });

    expect(invalid.outcome).toBe("dead-letter");
    expect(invalid.reasons[0]).toMatchObject({
      code: "schema-invalid",
      severity: "blocker",
      event: "code.hook.received",
    });
    expect(invalid.redactedSamplePayload?.authorization).toEqual(EVIDENCE_REDACTED);

    const valid = explainAutomation([
      workflow({
        name: "match-channel-opportunity",
        triggers: [trigger({ event: "inbound.signal.received" })],
      }),
    ], {
      sampleEvent: sample("inbound.signal.received", {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
        accessToken: "secret-token",
      }),
    });
    expect(valid.redactedSamplePayload?.accessToken).toEqual(EVIDENCE_REDACTED);
    expect(JSON.stringify(valid)).not.toContain("secret-token");
  });

  it("assembles compiled workflow, event, blocker, effect, and downstream projections", () => {
    const graph = assembleCompiledAutomationGraph([
      workflow({
        name: "reply-to-channel",
        triggers: [trigger({ event: "inbound.signal.received" })],
        steps: [
          { type: "tool", id: "send-reply", tool: "send_channel_reply" },
          { type: "emit", id: "done", event: "channel.reply.sent" },
        ],
      }),
    ], {
      moduleManifests: [channelManifest()],
    });

    expect(graph.automation.workflows[0]).toMatchObject({
      name: "reply-to-channel",
      triggers: [{ event: "inbound.signal.received" }],
      effects: [{ effectId: "tool.send_channel_reply" }],
      blockers: [{ kind: "setup", setupRequirementId: "telegram-token" }],
      downstream: [{ kind: "event", target: "channel.reply.sent" }],
    });
    expect(graph.automation.blockers).toHaveLength(1);
    expect(graph.automation.downstream).toHaveLength(1);
    expect(graph.workflows[0].steps[0].manifestEffect).toMatchObject({
      moduleName: "channel-telegram",
      effectId: "tool.send_channel_reply",
      capabilityIds: ["channel-telegram.send"],
    });
  });
});
