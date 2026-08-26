import { describe, expect, it } from "vitest";
import { workflowDispatchIdempotency } from "./workflow-idempotency.js";

describe("workflowDispatchIdempotency", () => {
  it("gives equivalent batches the same durable identity", () => {
    const first = workflowDispatchIdempotency("scope-a", "batch-workflow", {
      event: "workflow.batch.flushed",
      schemaRef: null,
      payload: {
        scopeId: "scope-a",
        inputEvents: [{ eventId: "evt-1" }, { eventId: "evt-2" }],
        window: {
          firstEventAt: "2026-06-05T12:00:00.000Z",
          lastEventAt: "2026-06-05T12:00:01.000Z",
          flushedAt: "2026-06-05T12:00:02.000Z",
        },
      },
    })!;
    const duplicate = workflowDispatchIdempotency("scope-a", "batch-workflow", {
      event: "workflow.batch.flushed",
      schemaRef: null,
      payload: {
        scopeId: "scope-a",
        inputEvents: [{ eventId: "evt-1" }, { eventId: "evt-2" }],
        window: {
          firstEventAt: "2026-06-05T12:00:00.000Z",
          lastEventAt: "2026-06-05T12:00:01.000Z",
          flushedAt: "2026-06-05T12:00:05.000Z",
        },
      },
    })!;

    expect(duplicate).toEqual(first);
  });

  it("uses a durable event id but rejects changed parameters", () => {
    const first = workflowDispatchIdempotency("scope-a", "event-workflow", {
      event: "custom.event",
      schemaRef: { name: "custom.event", version: 1 },
      eventId: "evtj-000000000123",
      payload: {
        scopeId: "scope-a",
        status: "ready",
      },
    })!;
    const changed = workflowDispatchIdempotency("scope-a", "event-workflow", {
      event: "custom.event",
      schemaRef: { name: "custom.event", version: 1 },
      eventId: "evtj-000000000123",
      payload: {
        scopeId: "scope-a",
        status: "blocked",
      },
    })!;
    expect(changed.key).toBe(first.key);
    expect(changed.parameterFingerprint).not.toBe(first.parameterFingerprint);
  });

  it("uses a durable publication id when an outbox delivery is replayed", () => {
    const trigger = {
      event: "workflow.completed",
      schemaRef: null,
      payload: {
        scopeId: "scope-a",
        runId: "run-a",
        publicationId: "workflow:run-a:completed",
      },
    } as const;

    expect(workflowDispatchIdempotency("scope-a", "reviewer", trigger)).toEqual(
      workflowDispatchIdempotency("scope-a", "reviewer", trigger),
    );
  });
});
