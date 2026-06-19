import type { EventEnvelope } from "#core/events/event-journal.js";
import { WORKFLOW_BATCH_FLUSH_EVENT } from "#core/workflow/trigger-types.js";
import type { WorkflowSimulationRequest } from "./types.js";

export type WorkflowSimulationFixture = {
  name: string;
  description: string;
  request: WorkflowSimulationRequest;
};

const FIXTURE_TIME = "2026-06-03T15:51:10.814Z";
const SCOPE_ID = "simulation-scope";

function inboundMessage(args: {
  provider: string;
  channel: string;
  sourceId: string;
  externalId: string;
  actorTrust?: "trusted" | "untrusted" | "blocked";
  sourceStatus?: "active" | "blocked" | "archived" | "ignored";
  text: string;
}): WorkflowSimulationRequest {
  return {
    event: "inbound.signal.received",
    eventId: args.externalId,
    payload: {
      scopeId: SCOPE_ID,
      projectId: SCOPE_ID,
      provider: args.provider,
      channel: args.channel,
      accountId: `${args.provider}-fixture-account`,
      sourceId: args.sourceId,
      sourceUrl: `https://example.test/${args.provider}/${args.sourceId}`,
      externalId: args.externalId,
      occurredAt: FIXTURE_TIME,
      receivedAt: FIXTURE_TIME,
      ...(args.sourceStatus ? { sourceStatus: args.sourceStatus } : {}),
      actor: {
        id: `${args.provider}-user-1`,
        displayName: "Fixture User",
        trust: args.actorTrust ?? "trusted",
        trustReason: "fixture source",
      },
      body: {
        kind: "message",
        format: "plain",
        text: args.text,
      },
    },
  };
}

function progressBatchInput(provider: string): WorkflowSimulationRequest {
  return {
    event: "workflow.completed",
    eventId: `fixture-${provider}-workflow-completed`,
    payload: {
      scopeId: SCOPE_ID,
      projectId: SCOPE_ID,
      workflow: `${provider}-opportunity-intake`,
      status: "success",
      tags: ["monitored"],
      provider,
      channel: `${provider}.sports`,
      sourceId: `${provider}-sports-community`,
      completedAt: FIXTURE_TIME,
    },
  };
}

const weeklyProgressReviewReplayEnvelope: EventEnvelope = {
  id: "evtj-000000000042",
  sequence: 42,
  event: {
    name: WORKFLOW_BATCH_FLUSH_EVENT,
    schema: { name: WORKFLOW_BATCH_FLUSH_EVENT, version: 1 },
  },
  source: { kind: "workflow", id: "progress-reviewer-batch" },
  scope: {
    kind: "scope",
    scopeId: SCOPE_ID,
    projectId: SCOPE_ID,
    lineage: [SCOPE_ID],
  },
  timestamps: {
    occurredAt: FIXTURE_TIME,
    receivedAt: FIXTURE_TIME,
    emittedAt: FIXTURE_TIME,
    journaledAt: FIXTURE_TIME,
  },
  producer: {
    kind: "workflow",
    workflow: "progress-reviewer",
    runId: "fixture-progress-reviewer",
  },
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
    payload: {
      scopeId: SCOPE_ID,
      projectId: SCOPE_ID,
      batch: {
        workflow: "progress-reviewer",
        triggerIndex: 2,
        sourceEventName: "workflow.completed",
        groupingKey: SCOPE_ID,
        maxBufferSize: 20,
        overflow: "flush-oldest",
        droppedInputCount: 0,
      },
      reason: "count",
      count: 5,
      window: {
        firstEventAt: FIXTURE_TIME,
        lastEventAt: FIXTURE_TIME,
        flushedAt: FIXTURE_TIME,
      },
      inputEvents: [
        {
          event: "workflow.completed",
          schemaRef: null,
          eventId: "fixture-telegram-workflow-completed",
          receivedAt: FIXTURE_TIME,
          payload: {
            scopeId: SCOPE_ID,
            projectId: SCOPE_ID,
            workflow: "telegram-opportunity-intake",
            status: "success",
            tags: ["monitored"],
            provider: "telegram",
            channel: "telegram.sports",
            sourceId: "telegram-sports-community",
          },
        },
      ],
    },
  },
  retention: { kind: "retain" },
};

export const SIMULATION_FIXTURES: readonly WorkflowSimulationFixture[] = [
  {
    name: "telegram-sports-ignored",
    description: "Telegram sports-community message from a blocked actor.",
    request: inboundMessage({
      provider: "telegram",
      channel: "telegram.sports",
      sourceId: "telegram-sports-community",
      externalId: "telegram-blocked-1",
      actorTrust: "blocked",
      text: "Can anyone play five-a-side tomorrow at 7?",
    }),
  },
  {
    name: "telegram-sports-batched",
    description: "Accepted Telegram sports-community automation evidence entering progress-review batching.",
    request: progressBatchInput("telegram"),
  },
  {
    name: "telegram-sports-accepted",
    description: "Journaled progress-review batch flush sourced from accepted Telegram sports evidence.",
    request: {
      envelope: weeklyProgressReviewReplayEnvelope,
    },
  },
  {
    name: "slack-high-volume-batched",
    description: "Accepted Slack community automation evidence entering the same batching preview.",
    request: progressBatchInput("slack"),
  },
  {
    name: "gmail-owner-confirmation-message",
    description: "Gmail message fixture shaped like a provider action candidate without live provider calls.",
    request: inboundMessage({
      provider: "gmail",
      channel: "gmail.message",
      sourceId: "gmail-sports-thread",
      externalId: "gmail-message-1",
      text: "Please confirm booking the court if I am free.",
    }),
  },
  {
    name: "file-watch-change",
    description: "File-watch event fixture for workflows that listen to files.changed.",
    request: {
      event: "files.changed",
      eventId: "file-watch-1",
      payload: {
        scopeId: SCOPE_ID,
        projectId: SCOPE_ID,
        paths: ["docs/automation.md"],
        changedAt: FIXTURE_TIME,
      },
    },
  },
  {
    name: "task-progress-batched",
    description: "Task progress event fixture for task.changed batching previews.",
    request: {
      event: "task.changed",
      eventId: "task-progress-1",
      payload: {
        scopeId: SCOPE_ID,
        projectId: SCOPE_ID,
        counts: {
          ready: 2,
          doing: 1,
          done: 12,
        },
      },
    },
  },
  {
    name: "weekly-progress-review-journal-replay",
    description: "Committed journal envelope replayed into simulation without live provider calls.",
    request: {
      envelope: weeklyProgressReviewReplayEnvelope,
    },
  },
];

export function getSimulationFixture(name: string): WorkflowSimulationFixture | null {
  return SIMULATION_FIXTURES.find((fixture) => fixture.name === name) ?? null;
}
