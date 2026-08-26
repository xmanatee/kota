import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineDaemonWideModuleEvent,
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { EVIDENCE_REDACTED } from "#core/evidence/policy.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { handleWorkflowExplain } from "./explain.js";

type CodeHookPayload = {
  repository: string;
  ref: string;
  authorization?: string;
};

type ChannelPayload = {
  scopeId: string;
  channel: string;
  conversationId: string;
  sourceStatus?: string;
  accessToken?: string;
};

const channelEvent = defineDaemonWideModuleEvent<ChannelPayload>(
  "inbound.signal.received",
  ["scopeId", "channel", "conversationId", "sourceStatus", "accessToken"],
  {
    sensitivity: "sensitive",
    filterablePaths: ["channel", "sourceStatus"],
    payloadSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        scopeId: { type: "string" },
        channel: { type: "string" },
        conversationId: { type: "string" },
        sourceStatus: { type: "string", required: false },
        accessToken: { type: "string", required: false, sensitivity: "secret" },
      },
    },
  },
);

const codeHookEvent = defineDaemonWideModuleEvent<CodeHookPayload>(
  "code.hook.received",
  ["repository", "ref", "authorization"],
  {
    sensitivity: "sensitive",
    payloadSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        repository: { type: "string" },
        ref: { type: "string" },
        authorization: { type: "string", required: false, sensitivity: "secret" },
      },
    },
  },
);

function makeRequest(body: object): IncomingMessage {
  return Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
}

function makeResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn((status: number) => {
      result.status = status;
    }),
    end: vi.fn((body: string) => {
      result.body = JSON.parse(body);
    }),
  } as unknown as ServerResponse;
  return { res, result };
}

function workflowDefinition(): WorkflowDefinition {
  return {
    name: "apply-code-hook",
    enabled: true,
    moduleRoot: "/tmp/kota-route-test",
    repository: "none",
    tags: [],
    definitionPath: "/tmp/kota-route-test/workflow.ts",
    triggers: [
      {
        event: "code.hook.received",
        cooldownMs: 0,
      },
    ],
    steps: [],
  };
}

function channelWorkflowDefinition(): WorkflowDefinition {
  return {
    name: "channel-match",
    enabled: true,
    moduleRoot: "/tmp/kota-route-test",
    repository: "none",
    tags: [],
    definitionPath: "/tmp/kota-route-test/channel-workflow.ts",
    triggers: [
      {
        event: "inbound.signal.received",
        cooldownMs: 0,
      },
    ],
    steps: [],
  };
}

beforeEach(() => {
  resetModuleEventRegistry();
  const events = initModuleEventRegistry();
  events.register("inbound-signals", channelEvent);
  events.register("code-hooks", codeHookEvent);
});

afterEach(() => {
  resetModuleEventRegistry();
});

describe("handleWorkflowExplain", () => {
  it("returns an ignored daemon API explanation for a Telegram-like channel event", async () => {
    const { res, result } = makeResponse();

    await handleWorkflowExplain(
      makeRequest({
        workflow: "channel-match",
        event: "inbound.signal.received",
        payload: {
          scopeId: "scope-a",
          channel: "telegram",
          conversationId: "thread-1",
          sourceStatus: "blocked",
          accessToken: "secret-token",
        },
        eventId: "telegram-update-1",
      }),
      res,
      {
        definitions: [channelWorkflowDefinition()],
        moduleManifests: [],
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      query: {
        workflowName: "channel-match",
        eventName: "inbound.signal.received",
      },
      outcome: "ignored",
      matches: [],
      reasons: [
        {
          code: "source-ignored",
          severity: "blocker",
          event: "inbound.signal.received",
          message: "source status is blocked",
        },
      ],
      redactedSamplePayload: {
        scopeId: "scope-a",
        channel: "telegram",
        conversationId: "thread-1",
        sourceStatus: "blocked",
        accessToken: EVIDENCE_REDACTED,
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("secret-token");
  });

  it("returns a queued explanation with a redacted sample payload", async () => {
    const { res, result } = makeResponse();

    await handleWorkflowExplain(
      makeRequest({
        workflow: "apply-code-hook",
        event: "code.hook.received",
        payload: {
          repository: "acme/repo",
          ref: "refs/heads/main",
          authorization: "Bearer secret-token",
        },
      }),
      res,
      {
        definitions: [workflowDefinition()],
        moduleManifests: [],
      },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      outcome: "queued",
      matches: [
        {
          workflow: "apply-code-hook",
          triggerEvent: "code.hook.received",
        },
      ],
    });
    expect(
      (result.body as { redactedSamplePayload?: { authorization?: unknown } })
        .redactedSamplePayload?.authorization,
    ).toEqual(EVIDENCE_REDACTED);
    expect(JSON.stringify(result.body)).not.toContain("secret-token");
  });

  it("returns 422 for schema-invalid sample payloads", async () => {
    const { res, result } = makeResponse();

    await handleWorkflowExplain(
      makeRequest({
        eventName: "code.hook.received",
        payload: {
          repository: 42,
          ref: "refs/heads/main",
        },
      }),
      res,
      {
        definitions: [workflowDefinition()],
        moduleManifests: [],
      },
    );

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      outcome: "dead-letter",
      reasons: [
        {
          code: "schema-invalid",
          severity: "blocker",
          event: "code.hook.received",
        },
      ],
    });
  });
});
