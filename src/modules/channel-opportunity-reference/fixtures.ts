import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import type {
  InboundSignalInputObject,
  InboundSignalReceivedPayload,
  InboundSignalSourceStatus,
} from "#modules/inbound-signals/events.js";
import {
  type CalendarBusyWindow,
  CHANNEL_OPPORTUNITY_REFERENCE_ROUTE_ID,
  CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
  type RoutedOpportunitySignal,
} from "./matching.js";

const SCOPE_ID = "scope-redacted";
const SOURCE_ID = "telegram:redacted-sports-community";
const ACCOUNT_ID = "telegram:redacted-account";
const SOURCE_URL = "https://t.me/redacted-community";
const RECEIVED_AT = "2026-06-19T12:00:00.000Z";

function telegramSignal(args: {
  externalId: string;
  actorId: string;
  label: string;
  text: string;
  data?: InboundSignalInputObject;
}): InboundSignalReceivedPayload {
  return {
    scopeId: SCOPE_ID,
    provider: "telegram",
    channel: "telegram.group",
    accountId: ACCOUNT_ID,
    sourceId: SOURCE_ID,
    sourceUrl: SOURCE_URL,
    externalId: args.externalId,
    occurredAt: "2026-06-19T10:00:00.000Z",
    receivedAt: RECEIVED_AT,
    actor: {
      id: `telegram:redacted-user-${args.actorId}`,
      displayName: "Redacted community member",
      trust: "trusted",
      trustReason: "fixture allowlist",
    },
    body: {
      kind: "action",
      action: "telegram.message.received",
      label: args.label,
      data: {
        messageText: args.text,
        ...(args.data ?? {}),
      },
    },
  };
}

function routedSignal(
  signal: InboundSignalReceivedPayload,
  sourceStatus: InboundSignalSourceStatus = "active",
): RoutedOpportunitySignal {
  return {
    routeId: CHANNEL_OPPORTUNITY_REFERENCE_ROUTE_ID,
    sourceStatus,
    provider: signal.provider,
    channel: signal.channel,
    accountId: signal.accountId,
    sourceId: signal.sourceId,
    actorTrust: signal.actor.trust,
    signal,
  };
}

export const REFERENCE_CALENDAR_BUSY_WINDOWS: CalendarBusyWindow[] = [
  {
    start: "2026-06-19T18:00:00.000Z",
    end: "2026-06-19T19:30:00.000Z",
    summary: "Redacted existing commitment",
  },
];

export const REFERENCE_TELEGRAM_SIGNALS: RoutedOpportunitySignal[] = [
  routedSignal(
    telegramSignal({
      externalId: "tg-redacted-001",
      actorId: "001",
      label: "General chat message",
      text: "Anyone watching the finals tonight?",
    }),
  ),
  routedSignal(
    telegramSignal({
      externalId: "tg-redacted-002",
      actorId: "002",
      label: "Padel slot available",
      text: "Padel spot available. One player needed.",
      data: {
        opportunityId: "padel-redacted-fit",
        sport: "padel",
        title: "Redacted padel doubles slot",
        startsAt: "2026-06-19T20:00:00.000Z",
        endsAt: "2026-06-19T21:30:00.000Z",
        confidence: 0.93,
        providerAdapter: "telegram-reaction",
        providerActionId: "telegram-react-padel-redacted-fit",
        providerActionLabel: "React with the configured join emoji",
        providerPayload: {
          chatId: "redacted-chat",
          messageId: "redacted-message-002",
          reaction: "join",
        },
      },
    }),
  ),
  routedSignal(
    telegramSignal({
      externalId: "tg-redacted-003",
      actorId: "003",
      label: "Badminton court available",
      text: "Badminton slot open this evening.",
      data: {
        opportunityId: "badminton-redacted-conflict",
        sport: "badminton",
        title: "Redacted badminton court share",
        startsAt: "2026-06-19T18:30:00.000Z",
        endsAt: "2026-06-19T19:30:00.000Z",
        confidence: 0.89,
        providerAdapter: "website-booking",
        providerActionId: "website-book-badminton-redacted-conflict",
        providerActionLabel: "Dry-run website booking",
      },
    }),
  ),
  routedSignal(
    telegramSignal({
      externalId: "tg-redacted-004",
      actorId: "004",
      label: "Tennis sold out",
      text: "Tennis court is full now, no spaces left.",
    }),
  ),
  routedSignal(
    telegramSignal({
      externalId: "tg-redacted-005",
      actorId: "005",
      label: "Archived source still emits audit",
      text: "Padel spot available from an archived group.",
      data: {
        opportunityId: "padel-redacted-archived",
        sport: "padel",
        startsAt: "2026-06-19T22:00:00.000Z",
        endsAt: "2026-06-19T23:00:00.000Z",
      },
    }),
    "archived",
  ),
  routedSignal(
    telegramSignal({
      externalId: "tg-redacted-006",
      actorId: "006",
      label: "Padel missing structured details",
      text: "Padel spot available but the source omitted time details.",
    }),
  ),
];

export const REFERENCE_TELEGRAM_BATCH: WorkflowBatchFlushPayload = {
  scopeId: SCOPE_ID,
  sourceEventName: "inbound.signal.received",
  groupingKey: "telegram.group:telegram:redacted-sports-community",
  reason: "count",
  count: REFERENCE_TELEGRAM_SIGNALS.length,
  window: {
    firstEventAt: "2026-06-19T10:00:00.000Z",
    lastEventAt: "2026-06-19T10:01:00.000Z",
    flushedAt: "2026-06-19T10:01:00.000Z",
  },
  inputEvents: REFERENCE_TELEGRAM_SIGNALS.map((signal, index) => ({
    event: "inbound.signal.received",
    schemaRef: { name: "inbound.signal.received", version: 1 },
    eventId: `fixture-event-${index + 1}`,
    receivedAt: RECEIVED_AT,
    payload: {
      scopeId: SCOPE_ID,
      routeId: signal.routeId,
      decision: "dispatched",
      sourceStatus: signal.sourceStatus,
      provider: signal.provider,
      channel: signal.channel,
      accountId: signal.accountId,
      sourceId: signal.sourceId,
      actorTrust: signal.actorTrust,
      policy: {
        routeId: signal.routeId,
        sourceStatus: signal.sourceStatus,
        blockedHandling: "audit-only",
        batch: {
          mode: "workflow-trigger",
          maxItems: 6,
          maxBufferSize: 30,
          overflow: "flush-oldest",
          groupBy: ["channel", "sourceId"],
        },
        processing: {
          classifier: "cheap",
          modelTier: "capable",
          allowNonReadActions: true,
        },
      },
      signal: signal.signal,
      target: {
        kind: "workflow",
        name: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
      },
    },
  })),
  batch: {
    workflow: CHANNEL_OPPORTUNITY_REFERENCE_WORKFLOW_NAME,
    triggerIndex: -1,
    maxBufferSize: 30,
    overflow: "flush-oldest",
    droppedInputCount: 0,
  },
};

export const REFERENCE_EXPECTED_OUTPUT = {
  inputCount: 6,
  cheapCandidateCount: 3,
  screenedCandidateCount: 2,
  calendarAvailableOpportunityIds: ["padel-redacted-fit"],
  rejectedReasons: [
    "cheap-reject",
    "source-not-active",
    "missing-structured-opportunity",
    "calendar-conflict",
  ],
  providerActionId: "telegram-react-padel-redacted-fit",
};
