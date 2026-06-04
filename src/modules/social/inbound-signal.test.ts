import { describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { enqueueMatchingWorkflows } from "#core/workflow/run-executor-utils.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import {
  type InboundSignalReceivedPayload,
  inboundSignalReceived,
  validateInboundSignalPayload,
} from "#modules/inbound-signals/events.js";
import {
  emitSocialInboundSignal,
  MAX_SOCIAL_TEXT_LENGTH,
  type SocialConnectorConfig,
  type SocialInboundDelivery,
  socialDeliveryFromInboundRequest,
  socialDeliveryToInboundSignal,
} from "./inbound-signal.js";

const connector: SocialConnectorConfig = {
  id: "x-owner",
  provider: "x",
  accountId: "owner-account",
  webhookSecret: "test-secret",
  trustedHandles: ["alice"],
  blockedActorIds: ["blocked-user-id"],
};

const context = {
  projectId: "project-social",
  receivedAt: "2026-05-25T04:45:00.000Z",
  connector,
};

function socialDelivery(
  overrides: Partial<SocialInboundDelivery> = {},
): SocialInboundDelivery {
  return {
    kind: "mention",
    id: "post-123",
    actor: {
      id: "actor-123",
      handle: "alice",
      displayName: "Alice Example",
    },
    text: "@kota please capture this signal",
    url: "https://x.com/alice/status/post-123",
    occurredAt: "2026-05-25T04:44:00.000Z",
    threadId: "thread-1",
    ...overrides,
  };
}

function unwrap(
  result: ReturnType<typeof socialDeliveryToInboundSignal>,
): InboundSignalReceivedPayload {
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

describe("Social inbound signal adapter", () => {
  it("normalizes a configured X mention into a project-scoped inbound signal", () => {
    const parsed = socialDeliveryFromInboundRequest({
      delivery: {
        kind: "mention",
        id: "post-123",
        actor: {
          id: "actor-123",
          handle: "@Alice",
          displayName: "Alice Example",
        },
        text: "@kota please capture this signal",
        url: "https://x.com/alice/status/post-123",
        occurredAt: "2026-05-25T04:44:00.000Z",
        threadId: "thread-1",
        data: { deliveryId: "webhook-delivery-1" },
      },
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const payload = unwrap(
      socialDeliveryToInboundSignal(parsed.value, context),
    );

    expect(validateInboundSignalPayload(payload)).toMatchObject({ ok: true });
    expect(payload).toMatchObject({
      projectId: "project-social",
      provider: "x",
      channel: "x.mention",
      accountId: "x:owner-account",
      sourceId: "x:owner-account:mention:post-123",
      sourceUrl: "https://x.com/alice/status/post-123",
      externalId: "x:mention:post-123",
      occurredAt: "2026-05-25T04:44:00.000Z",
      receivedAt: "2026-05-25T04:45:00.000Z",
      actor: {
        id: "x:user:actor-123",
        displayName: "@alice",
        trust: "trusted",
        trustReason:
          "social actor handle '@alice' matched modules.social inbound trustedHandles",
      },
      body: {
        kind: "action",
        action: "x.mention.received",
        label: "X mention from @alice",
        data: {
          connectorId: "x-owner",
          kind: "mention",
          eventId: "post-123",
          text: "@kota please capture this signal",
          textTruncated: false,
          providerData: { deliveryId: "webhook-delivery-1" },
        },
      },
    });
  });

  it("bounds social-authored text before it reaches workflows", () => {
    const payload = unwrap(
      socialDeliveryToInboundSignal(
        socialDelivery({ text: "x".repeat(MAX_SOCIAL_TEXT_LENGTH + 200) }),
        context,
      ),
    );

    if (payload.body.kind !== "action") {
      throw new Error("expected social signal to carry an action body");
    }
    expect(payload.body.data.text).toHaveLength(MAX_SOCIAL_TEXT_LENGTH);
    expect(payload.body.data.textTruncated).toBe(true);
  });

  it("rejects malformed mention deliveries before emitting", () => {
    const parsed = socialDeliveryFromInboundRequest({
      kind: "mention",
      id: "post-123",
      actor: { id: "actor-123" },
    });

    expect(parsed).toEqual({
      ok: false,
      error: "mention text must be a non-empty string",
    });
  });

  it("emits the shared typed signal only after adapter validation succeeds", () => {
    const events = {
      emit: vi.fn(),
    } as unknown as Pick<ModuleContext["events"], "emit">;
    const signal = socialDeliveryToInboundSignal(socialDelivery(), context);

    const result = emitSocialInboundSignal(events, signal);

    expect(result.emitted).toBe(true);
    if (!result.emitted) throw new Error(result.error);
    expect(events.emit).toHaveBeenCalledWith(
      inboundSignalReceived,
      result.payload,
    );
  });
});

type ProbeDecision = {
  decision: "accept" | "noop";
  projectId: string;
  provider: string;
  channel: string;
  actorTrust: string;
};

const socialSignalProbeWorkflow: WorkflowDefinitionInput = {
  name: "social-signal-probe",
  description: "Test-only bounded workflow for social-origin inbound signals.",
  triggers: [
    {
      event: inboundSignalReceived.name,
      filter: { provider: "x", channel: "x.mention" },
    },
  ],
  steps: [
    {
      id: "decide",
      type: "code",
      validate: (raw) =>
        expectStructuredOutput<ProbeDecision>(raw, [
          "decision",
          "projectId",
          "provider",
          "channel",
          "actorTrust",
        ]),
      run: ({ trigger }): ProbeDecision => {
        const payload = trigger.payload as InboundSignalReceivedPayload;
        return {
          decision: payload.actor.trust === "trusted" ? "accept" : "noop",
          projectId: payload.projectId,
          provider: payload.provider,
          channel: payload.channel,
          actorTrust: payload.actor.trust,
        };
      },
    },
  ],
};

describe("Social-origin inbound signal workflow dispatch", () => {
  it("routes social-origin signals and lets workflows no-op on untrusted actors", async () => {
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(
          "src/modules/social/inbound-signal.test.ts",
          socialSignalProbeWorkflow,
        ),
      ],
      "/tmp/kota-social-probe",
    );
    const queued: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const trustedPayload = unwrap(
      socialDeliveryToInboundSignal(socialDelivery(), context),
    );
    const untrustedPayload = unwrap(
      socialDeliveryToInboundSignal(
        socialDelivery({
          actor: {
            id: "external-actor",
            handle: "external",
            displayName: "External Actor",
          },
        }),
        context,
      ),
    );

    enqueueMatchingWorkflows(
      {
        type: inboundSignalReceived.name,
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
        payload: {
          ...trustedPayload,
          provider: "github",
          channel: "github.issue_comment",
        },
      },
      [definition],
      (_definition, _trigger, run) => queued.push(run),
    );
    expect(queued).toHaveLength(0);

    enqueueMatchingWorkflows(
      {
        type: inboundSignalReceived.name,
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
        payload: trustedPayload,
      },
      [definition],
      (_definition, _trigger, run) => queued.push(run),
    );
    enqueueMatchingWorkflows(
      {
        type: inboundSignalReceived.name,
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
        payload: untrustedPayload,
      },
      [definition],
      (_definition, _trigger, run) => queued.push(run),
    );

    expect(queued).toHaveLength(2);
    expect(queued[0]).toMatchObject({
      event: inboundSignalReceived.name,
      payload: {
        projectId: "project-social",
        provider: "x",
        channel: "x.mention",
        actor: { trust: "trusted" },
      },
    });

    const trustedHarness = new WorkflowTestHarness(socialSignalProbeWorkflow, {
      trigger: queued[0],
      projectDir: "/tmp/kota-social-probe",
    });
    const trustedResult = await trustedHarness.run();

    expect(trustedResult.status).toBe("success");
    expect(trustedResult.steps.decide.output).toEqual({
      decision: "accept",
      projectId: "project-social",
      provider: "x",
      channel: "x.mention",
      actorTrust: "trusted",
    });

    const untrustedHarness = new WorkflowTestHarness(socialSignalProbeWorkflow, {
      trigger: queued[1],
      projectDir: "/tmp/kota-social-probe",
    });
    const untrustedResult = await untrustedHarness.run();

    expect(untrustedResult.status).toBe("success");
    expect(untrustedResult.steps.decide.output).toEqual({
      decision: "noop",
      projectId: "project-social",
      provider: "x",
      channel: "x.mention",
      actorTrust: "untrusted",
    });
  });
});
