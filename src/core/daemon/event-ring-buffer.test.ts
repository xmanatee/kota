import { describe, expect, it } from "vitest";
import type { BufferedEvent } from "./event-ring-buffer.js";
import { EventRingBuffer } from "./event-ring-buffer.js";
import { makeWorkflowCompletedEvent } from "./sse-event-fixtures.integration.js";

function workflowsOf(buffered: BufferedEvent[]): string[] {
  return buffered.map((e) => {
    if (e.event.type !== "workflow.completed") {
      throw new Error(`unexpected event type ${e.event.type}`);
    }
    return e.event.payload.workflow;
  });
}

describe("EventRingBuffer", () => {
  it("returns events in chronological order", () => {
    const buf = new EventRingBuffer(5);
    buf.push(makeWorkflowCompletedEvent({ workflow: "a" }), 1000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "b" }), 2000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "c" }), 3000);

    const results = buf.query();
    expect(workflowsOf(results)).toEqual(["a", "b", "c"]);
    expect(results.map((e) => e.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it("evicts oldest entry when buffer is full", () => {
    const buf = new EventRingBuffer(3);
    buf.push(makeWorkflowCompletedEvent({ workflow: "a" }), 1000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "b" }), 2000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "c" }), 3000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "d" }), 4000); // evicts "a"

    const results = buf.query();
    expect(workflowsOf(results)).toEqual(["b", "c", "d"]);
  });

  it("evicts multiple oldest entries over repeated pushes", () => {
    const buf = new EventRingBuffer(3);
    for (let i = 0; i < 7; i++) {
      buf.push(makeWorkflowCompletedEvent({ workflow: String(i) }), i * 100);
    }
    // Only last 3: 4, 5, 6
    const results = buf.query();
    expect(workflowsOf(results)).toEqual(["4", "5", "6"]);
  });

  it("filters by since timestamp (exclusive)", () => {
    const buf = new EventRingBuffer(10);
    buf.push(makeWorkflowCompletedEvent({ workflow: "a" }), 1000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "b" }), 2000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "c" }), 3000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "d" }), 4000);

    const results = buf.query(2000); // exclusive: timestamp > 2000
    expect(workflowsOf(results)).toEqual(["c", "d"]);
  });

  it("limits result count from the newest end", () => {
    const buf = new EventRingBuffer(10);
    for (let i = 0; i < 8; i++) {
      buf.push(makeWorkflowCompletedEvent({ workflow: String(i) }), i * 100);
    }

    const results = buf.query(undefined, 3);
    expect(workflowsOf(results)).toEqual(["5", "6", "7"]);
  });

  it("combines since and limit", () => {
    const buf = new EventRingBuffer(10);
    for (let i = 0; i < 10; i++) {
      buf.push(makeWorkflowCompletedEvent({ workflow: String(i) }), i * 100);
    }

    // since=300 (exclusive) → 4,5,6,7,8,9; limit=3 → 7,8,9
    const results = buf.query(300, 3);
    expect(workflowsOf(results)).toEqual(["7", "8", "9"]);
  });

  it("returns empty array when buffer is empty", () => {
    const buf = new EventRingBuffer(10);
    expect(buf.query()).toEqual([]);
    expect(buf.query(0, 5)).toEqual([]);
  });

  it("handles capacity of 1 correctly", () => {
    const buf = new EventRingBuffer(1);
    buf.push(makeWorkflowCompletedEvent({ workflow: "a" }), 1000);
    buf.push(makeWorkflowCompletedEvent({ workflow: "b" }), 2000);

    const results = buf.query();
    expect(results).toHaveLength(1);
    expect(workflowsOf(results)).toEqual(["b"]);
  });
});
