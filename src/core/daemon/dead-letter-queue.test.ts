import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventEnvelope } from "#core/events/event-journal.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import {
  createBatchDeadLetter,
  createConfirmedActionDeadLetter,
  createEventEnvelopeDeadLetter,
  createWorkflowDispatchDeadLetter,
  DeadLetterQueueStore,
  deadLetterDuplicateFingerprint,
} from "./dead-letter-queue.js";

const NOW = "2026-06-06T12:00:00.000Z";

function failedRun(id: string): WorkflowRunMetadata {
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    startedAt: NOW,
    completedAt: NOW,
    status: "failed",
    durationMs: 1,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
}

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

  it("keeps separate redrive records for separate failed runs in one incident", () => {
    const trigger = {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    };
    const first = createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "builder",
      trigger,
      reason: "repair loop exhausted",
      errorClass: "execution",
      failedRun: failedRun("run-builder-a"),
    });
    const second = createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "builder",
      trigger,
      reason: "repair loop exhausted",
      errorClass: "execution",
      failedRun: failedRun("run-builder-b"),
    });

    expect(second.id).not.toBe(first.id);
    expect(store.list({ workflowName: "builder", status: "open" })).toHaveLength(2);
    expect(deadLetterDuplicateFingerprint(second)).toBe(
      deadLetterDuplicateFingerprint(first),
    );
    expect(second.source).toMatchObject({ failedRunId: "run-builder-b" });
    expect(second.redrive).toMatchObject({
      source: { kind: "run-trigger", runId: "run-builder-b" },
    });
  });

  it("coalesces repeated records for the same failed run", () => {
    const input = {
      store,
      scopeId: "scope-a",
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      reason: "repair loop exhausted",
      errorClass: "execution" as const,
      failedRun: failedRun("run-builder-a"),
    };
    const first = createWorkflowDispatchDeadLetter(input);
    const repeated = createWorkflowDispatchDeadLetter(input);

    expect(repeated.id).toBe(first.id);
    expect(repeated.failure.retryCount).toBe(2);
    expect(repeated.failure.observationTimes).toEqual([NOW, NOW]);
    expect(store.list({ workflowName: "builder", status: "open" })).toHaveLength(1);
  });

  it("keeps one representative output-contract incident across failed runs", () => {
    const input = {
      store,
      scopeId: "scope-a",
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      reason:
        'Agent step "build" produced 2 successful terminal results without usable output or repair progress',
      errorClass: "output_contract" as const,
    };
    const first = createWorkflowDispatchDeadLetter({
      ...input,
      failedRun: failedRun("run-builder-empty-a"),
    });
    const repeated = createWorkflowDispatchDeadLetter({
      ...input,
      failedRun: failedRun("run-builder-empty-b"),
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.failure.retryCount).toBe(2);
    expect(repeated.failure.observationTimes).toEqual([NOW, NOW]);
    expect(repeated.source).toMatchObject({ failedRunId: "run-builder-empty-a" });
    expect(store.list({ workflowName: "builder", status: "open" })).toHaveLength(1);
  });

  it("retains and coalesces provider backoff horizons across failed runs", () => {
    const input = {
      store,
      scopeId: "scope-a",
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      reason: 'Agent step "build" failed: quota exhausted',
      errorClass: "rate_limit" as const,
    };
    const first = createWorkflowDispatchDeadLetter({
      ...input,
      failedRun: failedRun("run-builder-quota-a"),
      backoffUntil: "2026-06-06T13:00:00.000Z",
    });
    const repeated = createWorkflowDispatchDeadLetter({
      ...input,
      failedRun: failedRun("run-builder-quota-b"),
      backoffUntil: "2026-06-06T14:00:00.000Z",
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.failure).toMatchObject({
      retryCount: 2,
      backoffUntil: "2026-06-06T14:00:00.000Z",
    });
    expect(store.list({ workflowName: "builder", status: "open" })).toHaveLength(1);
  });

  it("uses evidence policy retention for open and closed DLQ items", () => {
    const item = createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "telegram-ingest",
      trigger: { event: "telegram.message", schemaRef: null, payload: {} },
      reason: "failed",
      errorClass: "execution",
    });
    expect(item.retention).toEqual({
      kind: "expire-after-ms",
      durationMs: 2592000000,
      expiresAt: "2026-07-06T12:00:00.000Z",
    });

    const dismissed = store.dismiss(item.id, "handled");
    expect(dismissed?.retention).toEqual({
      kind: "expire-after-ms",
      durationMs: 1209600000,
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    const redriveItem = createWorkflowDispatchDeadLetter({
      store,
      scopeId: "scope-a",
      workflowName: "email-ingest",
      trigger: { event: "email.message", schemaRef: null, payload: {} },
      reason: "failed",
      errorClass: "execution",
    });
    const redriven = store.recordRedriveAttempt(redriveItem.id, {
      target: "simulation",
      reason: "verified",
      result: { status: "simulated" },
    });
    expect(redriven?.retention).toEqual({
      kind: "expire-after-ms",
      durationMs: 1209600000,
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
  });

  it("preserves batch source metadata and source event ids", () => {
    const payload: WorkflowBatchFlushPayload = {
      scopeId: "scope-a",
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
      data: {
        classification: "public",
        sensitivity: "public",
        dataClasses: ["operational-metadata", "audit-provenance", "source-content"],
        redactionProfile: "plain",
        storageProfile: "internal-storage",
      },
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
      trigger: {
        event: "telegram.message",
        schemaRef: null,
        payload: { text: "token=raw-token from owner@example.test" },
      },
      reason: "failed because token=raw-token reached owner@example.test",
      errorClass: "execution",
    });
    expect(item.failure.reason).not.toContain("raw-token");
    expect(item.failure.reason).not.toContain("owner@example.test");

    const failed = store.recordRedriveAttempt(item.id, {
      target: "original",
      reason: "retry after token=raw-token from owner@example.test",
      result: {
        status: "failed",
        message: "provider returned Authorization: Bearer raw-token for owner@example.test",
      },
    });
    expect(failed?.status).toBe("open");
    expect(JSON.stringify(failed?.redriveAttempts[0])).not.toContain("raw-token");
    expect(JSON.stringify(failed?.redriveAttempts[0])).not.toContain("owner@example.test");

    const redriven = store.recordRedriveAttempt(item.id, {
      target: "simulation",
      reason: "operator verified fixed schema with token=raw-token",
      result: { status: "simulated" },
    });
    expect(redriven?.status).toBe("redriven");
    expect(redriven?.redriveAttempts).toHaveLength(2);
    expect(JSON.stringify(redriven?.redriveAttempts[1])).not.toContain("raw-token");
    const dismissed = store.dismiss(item.id, "no longer needed; secret=raw-token for owner@example.test");
    expect(dismissed?.status).toBe("dismissed");
    expect(dismissed?.dismissalReason).toBe("no longer needed; secret=[redacted] for [redacted]");
    const diagnostics = store.diagnostics(item.id);
    expect(diagnostics).toMatchObject({
      item: { id: item.id, status: "dismissed" },
      storePath: store.getPath(),
    });
    expect(JSON.stringify(diagnostics)).not.toContain("raw-token");
    expect(JSON.stringify(diagnostics)).not.toContain("owner@example.test");

    const persisted = readFileSync(store.getPath(), "utf-8");
    expect(persisted).not.toContain("raw-token");
    expect(persisted).not.toContain("owner@example.test");
  });
});
