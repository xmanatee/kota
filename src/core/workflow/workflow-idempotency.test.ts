import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { workflowDispatchIdempotency } from "./workflow-idempotency.js";

describe("workflowDispatchIdempotency", () => {
  let root: string;
  let store: IdempotencyStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-workflow-idempotency-"));
    store = new IdempotencyStore(join(root, "idempotency"), "scope-a");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("replays duplicate batch dispatches with the same input event ids", () => {
    const first = workflowDispatchIdempotency(store, "batch-workflow", {
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
    expect(
      store.record({
        ...first,
        operation: "workflow-dispatch",
        result: { runId: "run-1" },
      }).status,
    ).toBe("accepted");

    const duplicate = workflowDispatchIdempotency(store, "batch-workflow", {
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

    const result = store.record({
      ...duplicate,
      operation: "workflow-dispatch",
      result: { runId: "run-2" },
    });
    expect(result.status).toBe("replayed");
    if (result.status === "replayed") {
      expect(result.result).toEqual({ runId: "run-1" });
    }
  });

  it("replays duplicate event dispatches with the same durable event id", () => {
    const first = workflowDispatchIdempotency(store, "event-workflow", {
      event: "custom.event",
      schemaRef: { name: "custom.event", version: 1 },
      eventId: "evtj-000000000123",
      payload: {
        scopeId: "scope-a",
        status: "ready",
      },
    })!;
    expect(
      store.record({
        ...first,
        operation: "workflow-dispatch",
        result: { runId: "run-1" },
      }).status,
    ).toBe("accepted");

    const duplicate = workflowDispatchIdempotency(store, "event-workflow", {
      event: "custom.event",
      schemaRef: { name: "custom.event", version: 1 },
      eventId: "evtj-000000000123",
      payload: {
        scopeId: "scope-a",
        status: "ready",
      },
    })!;

    const result = store.record({
      ...duplicate,
      operation: "workflow-dispatch",
      result: { runId: "run-2" },
    });
    expect(result.status).toBe("replayed");
    if (result.status === "replayed") {
      expect(result.result).toEqual({ runId: "run-1" });
    }
  });
});
