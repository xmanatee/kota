import { describe, expect, it, vi } from "vitest";
import { enqueueMatchingWorkflows } from "#core/workflow/run-executor-utils.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import type { InboundSignalReceivedPayload } from "#modules/inbound-signals/events.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import type { SlackEventsApiPayload, SlackMessageEvent } from "./client.js";
import {
  emitSlackTextInboundSignal,
  slackTextMessageToInboundSignal,
} from "./inbound-signal.js";

const RECEIVED_AT = "2026-05-25T03:50:00.000Z";

function slackMessage(
  text = "!task Capture the failed nightly build as follow-up work",
): SlackMessageEvent {
  return {
    type: "message",
    user: "U123",
    channel: "D123",
    text,
    ts: "1770000000.250000",
  };
}

function slackEnvelope(event = slackMessage()): SlackEventsApiPayload {
  return {
    team_id: "T123",
    event_id: "Ev123",
    event_time: 1770000000,
    event,
  };
}

const slackSignalContext = {
  projectId: "project-slack",
  receivedAt: RECEIVED_AT,
  config: {
    prefixes: ["!task"],
    trustedUserIds: ["U123"],
  },
};

describe("Slack channel inbound signal adapter", () => {
  it("normalizes a configured Slack text update into inbound.signal.received", () => {
    const result = slackTextMessageToInboundSignal(
      slackMessage(),
      slackEnvelope(),
      slackSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        projectId: "project-slack",
        provider: "slack",
        channel: "slack.message",
        accountId: "slack:T123",
        sourceId: "slack:T123:channel:D123:message:1770000000.250000",
        externalId: "slack:event:Ev123",
        actor: {
          id: "slack:user:U123",
          trust: "trusted",
        },
        body: {
          kind: "message",
          format: "plain",
          text: "Capture the failed nightly build as follow-up work",
        },
      },
    });
  });

  it("skips non-configured Slack text without emitting", () => {
    const result = slackTextMessageToInboundSignal(
      slackMessage("ordinary chat session message"),
      slackEnvelope(),
      slackSignalContext,
    );

    expect(result).toEqual({ kind: "skip", reason: "prefix-mismatch" });
  });

  it("emits the shared typed event only after adapter validation succeeds", () => {
    const events = { emit: vi.fn() };
    const result = emitSlackTextInboundSignal(
      events,
      slackMessage(),
      slackEnvelope(),
      slackSignalContext,
    );

    expect(result).toMatchObject({ emitted: true });
    if (!result.emitted) throw new Error("expected emit");
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

const slackSignalProbeWorkflow: WorkflowDefinitionInput = {
  name: "slack-signal-probe",
  description: "Test-only bounded workflow for Slack-origin inbound signals.",
  triggers: [
    {
      event: inboundSignalReceived.name,
      filter: { provider: "slack", channel: "slack.message" },
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

describe("Slack-origin inbound signal workflow dispatch", () => {
  it("routes a Slack-origin signal to a bounded workflow decision", async () => {
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(
          "src/modules/slack-channel/inbound-signal.test.ts",
          slackSignalProbeWorkflow,
        ),
      ],
      "/tmp/kota-slack-signal-probe",
    );
    const signal = slackTextMessageToInboundSignal(
      slackMessage(),
      slackEnvelope(),
      slackSignalContext,
    );
    if (signal.kind !== "signal") {
      throw new Error("expected Slack signal");
    }
    const queued: Array<{ event: string; payload: Record<string, unknown> }> = [];

    enqueueMatchingWorkflows(
      {
        type: inboundSignalReceived.name,
        schemaRef: {
          name: inboundSignalReceived.name,
          version: inboundSignalReceived.schema.currentVersion,
        },
        payload: signal.payload,
      },
      [definition],
      (_definition, _trigger, run) => queued.push(run),
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      event: inboundSignalReceived.name,
      payload: {
        projectId: "project-slack",
        provider: "slack",
        channel: "slack.message",
        actor: { trust: "trusted" },
      },
    });

    const harness = new WorkflowTestHarness(slackSignalProbeWorkflow, {
      trigger: queued[0],
      projectDir: "/tmp/kota-slack-signal-probe",
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.decide.output).toEqual({
      decision: "accept",
      projectId: "project-slack",
      provider: "slack",
      channel: "slack.message",
      actorTrust: "trusted",
    });
  });
});
