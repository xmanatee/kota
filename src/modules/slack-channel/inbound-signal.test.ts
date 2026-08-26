import { describe, expect, it, vi } from "vitest";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  type InboundSignalReceivedPayload,
  type InboundSignalRoutedPayload,
  inboundSignalReceived,
  inboundSignalWorkflowTargeted,
} from "#modules/inbound-signals/events.js";
import { dispatchInboundSignalRoute } from "#modules/inbound-signals/routing.js";
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
        sourceId: "slack:T123:channel:D123",
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

  it("emits non-prefixed Slack text so shared routing decides eligibility", () => {
    const result = slackTextMessageToInboundSignal(
      slackMessage("ordinary chat session message"),
      slackEnvelope(),
      slackSignalContext,
    );

    expect(result).toMatchObject({
      kind: "signal",
      payload: {
        body: {
          kind: "message",
          format: "plain",
          text: "ordinary chat session message",
        },
      },
    });
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

type RoutedProbePayload = {
  projectId: string;
  provider: string;
  channel: string;
  actorTrust: string;
  signal: InboundSignalReceivedPayload;
};

const slackSignalProbeWorkflow: WorkflowDefinitionInput = {
  repository: "read",
  name: "slack-signal-probe",
  description: "Test-only route target for Slack-origin inbound signals.",
  triggers: [{ event: "manual" }],
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
        const payload = trigger.payload as RoutedProbePayload;
        return {
          decision: payload.actorTrust === "trusted" ? "accept" : "noop",
          projectId: payload.projectId,
          provider: payload.provider,
          channel: payload.channel,
          actorTrust: payload.actorTrust,
        };
      },
    },
  ],
};

describe("Slack-origin inbound signal workflow dispatch", () => {
  it("routes a Slack-origin source through the shared dispatcher to a bounded workflow decision", async () => {
    const signal = slackTextMessageToInboundSignal(
      slackMessage(),
      slackEnvelope(),
      slackSignalContext,
    );
    if (signal.kind !== "signal") {
      throw new Error("expected Slack signal");
    }
    const queued: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const routed: InboundSignalRoutedPayload[] = [];

    const routeResult = await dispatchInboundSignalRoute({
      config: {
        routes: [
          {
            id: "slack-d123-capture",
            provider: "slack",
            channel: "slack.message",
            sourceId: "slack:T123:channel:D123",
            targets: [{ kind: "workflow", name: slackSignalProbeWorkflow.name }],
          },
        ],
      },
      signal: signal.payload,
      context: {
        workflowNames: new Set([slackSignalProbeWorkflow.name]),
        agentNames: new Set(),
      },
      deps: {
        async triggerWorkflow(_name, options) {
          queued.push({
            event: options.event ?? "manual",
            payload: options.payload ?? {},
          });
          return {
            ok: true,
            path: "daemon",
            queued: slackSignalProbeWorkflow.name,
            runId: "run-slack-d123",
          };
        },
        emitRouted(payload) {
          routed.push(payload);
        },
      },
    });

    expect(queued).toHaveLength(1);
    expect(routed).toEqual([routeResult]);
    expect(routeResult).toMatchObject({
      routeId: "slack-d123-capture",
      decision: "dispatched",
      sourceId: "slack:T123:channel:D123",
    });
    expect(queued[0]).toMatchObject({
      event: inboundSignalWorkflowTargeted,
      payload: {
        projectId: "project-slack",
        routeId: "slack-d123-capture",
        provider: "slack",
        channel: "slack.message",
        sourceId: "slack:T123:channel:D123",
        actorTrust: "trusted",
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
