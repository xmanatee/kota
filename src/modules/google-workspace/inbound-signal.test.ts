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
  calendarEventChangeToInboundSignal,
  emitGoogleWorkspaceInboundSignal,
  type GoogleWorkspaceCalendarEventChange,
  type GoogleWorkspaceGmailMessage,
  type GoogleWorkspaceInboundSignalContext,
  gmailMessageToInboundSignal,
} from "./inbound-signal.js";

const context: GoogleWorkspaceInboundSignalContext = {
  projectId: "project-google",
  accountId: "owner@example.com",
  receivedAt: "2026-05-25T03:25:00.000Z",
  trustedSenders: ["alice@example.com"],
  blockedSenders: ["blocked@example.com"],
  trustedOrganizers: ["organizer@example.com"],
  blockedOrganizers: ["blocked-organizer@example.com"],
};

function unwrap(payload: ReturnType<typeof gmailMessageToInboundSignal>): InboundSignalReceivedPayload {
  if (!payload.ok) throw new Error(payload.error);
  return payload.payload;
}

function gmailMessage(
  from: string,
  overrides: Partial<GoogleWorkspaceGmailMessage> = {},
): GoogleWorkspaceGmailMessage {
  return {
    id: "gmail-msg-1",
    threadId: "thread-1",
    historyId: "101",
    internalDate: "1779680040000",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Please review the queue",
    headers: {
      from,
      to: "owner@example.com",
      subject: "Queue review",
      date: "Mon, 25 May 2026 03:24:00 +0000",
      messageId: "<gmail-msg-1@example.com>",
    },
    text: "Please review the queue before standup.",
    ...overrides,
  };
}

function calendarEvent(
  organizerEmail: string,
  overrides: Partial<GoogleWorkspaceCalendarEventChange> = {},
): GoogleWorkspaceCalendarEventChange {
  return {
    id: "calendar-event-1",
    calendarId: "primary",
    status: "confirmed",
    summary: "Planning review",
    description: "Review incoming tasks",
    location: "Room A",
    htmlLink: "https://calendar.google.com/event?eid=calendar-event-1",
    iCalUID: "calendar-event-1@example.com",
    created: "2026-05-24T18:00:00.000Z",
    updated: "2026-05-25T03:20:00.000Z",
    organizer: {
      email: organizerEmail,
      displayName: "Organizer",
    },
    creator: {
      email: "creator@example.com",
      displayName: "Creator",
    },
    start: { dateTime: "2026-05-25T09:00:00.000Z" },
    end: { dateTime: "2026-05-25T09:30:00.000Z" },
    attendees: [{ email: "owner@example.com", responseStatus: "accepted" }],
    ...overrides,
  };
}

describe("Google Workspace inbound signal adapters", () => {
  it("normalizes a trusted Gmail sender into a project-scoped inbound signal", () => {
    const result = gmailMessageToInboundSignal(
      gmailMessage("Alice Example <alice@example.com>"),
      context,
    );
    const payload = unwrap(result);

    expect(validateInboundSignalPayload(payload)).toMatchObject({ ok: true });
    expect(payload).toMatchObject({
      projectId: "project-google",
      provider: "google-workspace",
      channel: "gmail.message",
      accountId: "google:gmail:owner@example.com",
      sourceId: "google:gmail:owner@example.com:message:gmail-msg-1",
      sourceUrl:
        "https://mail.google.com/mail/u/owner%40example.com/#all/gmail-msg-1",
      externalId: "gmail:gmail-msg-1",
      occurredAt: "2026-05-25T03:24:00.000Z",
      receivedAt: "2026-05-25T03:25:00.000Z",
      actor: {
        id: "google:gmail:alice@example.com",
        displayName: "Alice Example",
        trust: "trusted",
        trustReason:
          "sender 'alice@example.com' matched google-workspace inbound.trustedSenders",
      },
      body: {
        kind: "message",
        format: "plain",
        text: expect.stringContaining("Subject: Queue review"),
      },
    });
    if (payload.body.kind !== "message") {
      throw new Error("expected Gmail signal to carry a message body");
    }
    expect(payload.body.text).toContain("Please review the queue before standup.");
  });

  it("normalizes an untrusted Gmail sender without treating the message as trusted instructions", () => {
    const payload = unwrap(
      gmailMessageToInboundSignal(
        gmailMessage("External Person <external@example.net>"),
        context,
      ),
    );

    expect(payload.actor).toMatchObject({
      id: "google:gmail:external@example.net",
      displayName: "External Person",
      trust: "untrusted",
      trustReason:
        "sender 'external@example.net' did not match google-workspace inbound.trustedSenders",
    });
    if (payload.body.kind !== "message") {
      throw new Error("expected Gmail signal to carry a message body");
    }
    expect(payload.body.text).toContain("From: External Person <external@example.net>");
  });

  it("normalizes a trusted Calendar organizer into a structured action signal", () => {
    const payload = unwrap(
      calendarEventChangeToInboundSignal(
        calendarEvent("organizer@example.com"),
        context,
      ),
    );

    expect(validateInboundSignalPayload(payload)).toMatchObject({ ok: true });
    expect(payload).toMatchObject({
      projectId: "project-google",
      provider: "google-workspace",
      channel: "calendar.event",
      accountId: "google:calendar:owner@example.com",
      sourceId:
        "google:calendar:owner@example.com:primary:event:calendar-event-1",
      sourceUrl: "https://calendar.google.com/event?eid=calendar-event-1",
      externalId: "google-calendar:primary:calendar-event-1",
      occurredAt: "2026-05-25T03:20:00.000Z",
      actor: {
        id: "google:calendar:organizer@example.com",
        displayName: "Organizer",
        trust: "trusted",
        trustReason:
          "organizer 'organizer@example.com' matched google-workspace inbound.trustedOrganizers",
      },
      body: {
        kind: "action",
        action: "google.calendar.event.changed",
        label: "confirmed calendar event: Planning review",
        data: {
          eventId: "calendar-event-1",
          calendarId: "primary",
          status: "confirmed",
          summary: "Planning review",
          organizer: {
            email: "organizer@example.com",
            displayName: "Organizer",
            self: null,
          },
        },
      },
    });
  });

  it("normalizes an untrusted Calendar organizer and preserves source metadata", () => {
    const payload = unwrap(
      calendarEventChangeToInboundSignal(
        calendarEvent("external-organizer@example.net", {
          status: "cancelled",
          summary: "Vendor sync",
        }),
        context,
      ),
    );

    expect(payload.actor).toMatchObject({
      id: "google:calendar:external-organizer@example.net",
      trust: "untrusted",
      trustReason:
        "organizer 'external-organizer@example.net' did not match google-workspace inbound.trustedOrganizers",
    });
    expect(payload.body).toMatchObject({
      kind: "action",
      action: "google.calendar.event.cancelled",
      label: "cancelled calendar event: Vendor sync",
      data: {
        iCalUID: "calendar-event-1@example.com",
        attendees: [
          {
            email: "owner@example.com",
            responseStatus: "accepted",
          },
        ],
      },
    });
  });

  it("emits the shared typed signal only after adapter validation succeeds", () => {
    const events = {
      emit: vi.fn(),
    } as unknown as Pick<ModuleContext["events"], "emit">;
    const signal = gmailMessageToInboundSignal(
      gmailMessage("Alice Example <alice@example.com>"),
      context,
    );

    const result = emitGoogleWorkspaceInboundSignal(events, signal);

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

const googleWorkspaceSignalProbeWorkflow: WorkflowDefinitionInput = {
  name: "google-workspace-signal-probe",
  description: "Test-only bounded workflow for Google Workspace inbound signals.",
  triggers: [
    {
      event: inboundSignalReceived.name,
      filter: { provider: "google-workspace", channel: "gmail.message" },
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

describe("Google Workspace inbound signal workflow dispatch", () => {
  it("routes a Google-origin signal to a bounded workflow decision", async () => {
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(
          "src/modules/google-workspace/inbound-signal.test.ts",
          googleWorkspaceSignalProbeWorkflow,
        ),
      ],
      "/tmp/kota-google-workspace-probe",
    );
    const queued: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const payload = unwrap(
      gmailMessageToInboundSignal(
        gmailMessage("Alice Example <alice@example.com>"),
        context,
      ),
    );

    enqueueMatchingWorkflows(
      {
        type: "inbound.signal.received",
        payload: {
          ...payload,
          provider: "github",
          channel: "github.issue_comment",
        },
      },
      [definition],
      (_definition, _trigger, run) => queued.push(run),
    );
    expect(queued).toHaveLength(0);

    enqueueMatchingWorkflows(
      { type: inboundSignalReceived.name, payload },
      [definition],
      (_definition, _trigger, run) => queued.push(run),
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      event: inboundSignalReceived.name,
      payload: {
        projectId: "project-google",
        provider: "google-workspace",
        channel: "gmail.message",
        actor: { trust: "trusted" },
      },
    });

    const harness = new WorkflowTestHarness(googleWorkspaceSignalProbeWorkflow, {
      trigger: queued[0],
      projectDir: "/tmp/kota-google-workspace-probe",
    });
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.decide.output).toEqual({
      decision: "accept",
      projectId: "project-google",
      provider: "google-workspace",
      channel: "gmail.message",
      actorTrust: "trusted",
    });
  });
});
