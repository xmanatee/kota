import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventEnvelope } from "#core/events/event-journal.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import {
  createBatchDeadLetter,
  createConfirmedActionDeadLetter,
  createEventEnvelopeDeadLetter,
  createWorkflowDispatchDeadLetter,
  DeadLetterQueueStore,
} from "./dead-letter-queue.js";

const NOW = "2026-06-06T12:00:00.000Z";

describe("DeadLetterQueueStore", () => {
  let dir: string;
  let store: DeadLetterQueueStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-dlq-"));
    store = new DeadLetterQueueStore(dir, () => new Date(NOW));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("records workflow dispatch failures with redacted payload projections", () => {
    const item = createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "telegram-ingest",
      trigger: {
        event: "telegram.message",
        schemaRef: { name: "telegram.message", version: 1 },
        eventId: "evtj-000000000001",
        payload: {
          chatId: "chat-1",
          text: "hello",
          authorization: "Bearer token",
          nested: { apiKey: "secret", safe: "value" },
        },
      },
      reason: "step failed after retry",
      retryCount: 2,
      errorClass: "execution",
    });

    expect(item.type).toBe("workflow-dispatch");
    expect(item.status).toBe("open");
    expect(item.sourceEventIds).toEqual(["evtj-000000000001"]);
    expect(item.failure.retryCount).toBe(2);
    expect(item.redactedProjection.triggerPayload).toMatchObject({
      chatId: "chat-1",
      text: "hello",
      authorization: "[redacted]",
      nested: { apiKey: "[redacted]", safe: "value" },
    });
    expect(item.redrive).toEqual({
      kind: "workflow",
      workflowName: "telegram-ingest",
      source: { kind: "event-journal", eventId: "evtj-000000000001" },
    });
    expect(JSON.stringify(item.redrive)).not.toContain("Bearer token");
    expect(store.counts("scope-a")).toEqual({ open: 1, dismissed: 0, redriven: 0 });
  });

  it("filters by scope, workflow, type, and status", () => {
    createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "telegram-ingest",
      trigger: { event: "telegram.message", schemaRef: null, payload: {} },
      reason: "failed",
      errorClass: "execution",
    });
    createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-b",
      workflowName: "email-ingest",
      trigger: { event: "email.message", schemaRef: null, payload: {} },
      reason: "failed",
      errorClass: "execution",
    });

    expect(store.list({ scopeId: "scope-a" })).toHaveLength(1);
    expect(store.list({ workflowName: "email-ingest" })).toHaveLength(1);
    expect(store.list({ type: "workflow-dispatch", status: "open" })).toHaveLength(2);
  });

  it("preserves batch source metadata and source event ids", () => {
    const payload: WorkflowBatchFlushPayload = {
      scopeId: "scope-a",
      projectId: "scope-a",
      sourceEventName: "telegram.message",
      groupingKey: "chatId=chat-1",
      reason: "count",
      count: 2,
      window: {
        firstEventAt: "2026-06-06T11:59:00.000Z",
        lastEventAt: "2026-06-06T12:00:00.000Z",
        flushedAt: "2026-06-06T12:00:01.000Z",
      },
      inputEvents: [
        {
          event: "telegram.message",
          schemaRef: null,
          eventId: "evtj-000000000010",
          receivedAt: "2026-06-06T11:59:00.000Z",
          payload: { chatId: "chat-1", text: "one" },
        },
        {
          event: "telegram.message",
          schemaRef: null,
          eventId: "evtj-000000000011",
          receivedAt: "2026-06-06T12:00:00.000Z",
          payload: { chatId: "chat-1", text: "two", botToken: "secret" },
        },
      ],
      batch: {
        workflow: "telegram-batch",
        triggerIndex: 0,
        maxBufferSize: 10,
        overflow: "flush-oldest",
        droppedInputCount: 1,
      },
    };

    const item = createBatchDeadLetter({
      store,
      scopeId: "scope-a",
      payload,
      reason: "schema mismatch",
      errorClass: "validation",
      trigger: {
        event: "workflow.batch.flush",
        schemaRef: null,
        payload,
      },
    });

    expect(item.type).toBe("batch-envelope");
    expect(item.source).toMatchObject({
      kind: "batch-envelope",
      workflowName: "telegram-batch",
      inputEventCount: 2,
      droppedInputCount: 1,
    });
    expect(item.sourceEventIds).toEqual([
      "evtj-000000000010",
      "evtj-000000000011",
    ]);
    expect(item.redactedProjection.inputEvents).toEqual([
      {
        event: "telegram.message",
        schemaRef: null,
        eventId: "evtj-000000000010",
        receivedAt: "2026-06-06T11:59:00.000Z",
        payload: { chatId: "chat-1", text: "one" },
      },
      {
        event: "telegram.message",
        schemaRef: null,
        eventId: "evtj-000000000011",
        receivedAt: "2026-06-06T12:00:00.000Z",
        payload: { chatId: "chat-1", text: "two", botToken: "[redacted]" },
      },
    ]);
    expect(item.redrive).toMatchObject({
      kind: "workflow",
      workflowName: "telegram-batch",
      source: {
        kind: "batch-event-journal",
        payload: {
          inputEvents: [
            { eventId: "evtj-000000000010" },
            { eventId: "evtj-000000000011" },
          ],
        },
      },
    });
    expect(JSON.stringify(item.redrive)).not.toContain("secret");
  });

  it("records event-envelope and confirmed-action item types", () => {
    const envelope: EventEnvelope = {
      id: "evtj-000000000100",
      sequence: 100,
      event: { name: "telegram.message", schema: { name: "telegram.message", version: 1 } },
      source: { kind: "channel", id: "telegram" },
      scope: {
        kind: "scope",
        scopeId: "scope-a",
        projectId: "scope-a",
        lineage: ["global", "scope-a"],
      },
      timestamps: {
        occurredAt: NOW,
        receivedAt: NOW,
        emittedAt: NOW,
        journaledAt: NOW,
      },
      producer: {
        kind: "channel",
        provider: "telegram",
        channel: "chat",
        sourceId: "chat-1",
      },
      causality: {},
      trace: {},
      idempotency: {},
      data: { classification: "public", redactionProfile: "plain" },
      payload: {
        kind: "inline",
        payload: { chatId: "chat-1", text: "hello", accessToken: "secret" },
      },
      retention: { kind: "retain" },
    };
    const eventItem = createEventEnvelopeDeadLetter({
      store,
      scopeId: "scope-a",
      envelope,
      reason: "provider schema rejected",
      errorClass: "schema",
      redriveEnvelope: {
        type: "telegram.message",
        schemaRef: null,
        eventId: "evtj-000000000100",
        payload: { chatId: "chat-1", text: "hello", accessToken: "secret" },
      },
    });
    const actionItem = createConfirmedActionDeadLetter({
      store,
      scopeId: "scope-a",
      decisionId: "od-1",
      actionId: "book-court",
      adapterName: "sports-booking",
      workflowName: "booking-workflow",
      runId: "run-1",
      stepId: "book",
      reason: "adapter rejected confirmed action",
      redactedInput: { slot: "7pm", token: "[redacted]" },
    });

    expect(eventItem).toMatchObject({
      type: "event-envelope",
      source: { kind: "event-envelope", eventJournalId: "evtj-000000000100" },
      redrive: {
        kind: "event",
        source: { kind: "event-journal", eventId: "evtj-000000000100" },
      },
    });
    expect(eventItem.redactedProjection.accessToken).toBe("[redacted]");
    expect(actionItem).toMatchObject({
      type: "confirmed-action-dispatch",
      source: {
        kind: "confirmed-action-dispatch",
        decisionId: "od-1",
        actionId: "book-court",
        adapterName: "sports-booking",
          workflowName: "booking-workflow",
      },
      redrive: {
        kind: "workflow",
        workflowName: "booking-workflow",
        source: { kind: "resume-step", runId: "run-1", stepId: "book" },
      },
    });
  });

  it("records redrive attempts, dismissals, and diagnostics", () => {
    const item = createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "telegram-ingest",
      trigger: { event: "telegram.message", schemaRef: null, payload: {} },
      reason: "failed",
      errorClass: "execution",
    });

    const redriven = store.recordRedriveAttempt(item.id, {
      target: "simulation",
      reason: "operator verified fixed schema",
      result: { status: "simulated" },
    });
    expect(redriven?.status).toBe("redriven");
    expect(redriven?.redriveAttempts).toHaveLength(1);
    const dismissed = store.dismiss(item.id, "no longer needed");
    expect(dismissed?.status).toBe("dismissed");
    expect(dismissed?.dismissalReason).toBe("no longer needed");
    const diagnostics = store.diagnostics(item.id);
    expect(diagnostics).toMatchObject({
      item: { id: item.id, status: "dismissed" },
      storePath: store.getPath(),
    });
  });
});
