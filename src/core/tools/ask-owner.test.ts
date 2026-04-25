import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { resetAskOwnerDeps, runAskOwner, setAskOwnerDeps } from "./ask-owner.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
  getEventBus: () => null,
}));

describe("runAskOwner", () => {
  let dir: string;
  let queue: OwnerQuestionQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ask-owner-test-"));
    queue = new OwnerQuestionQueue(dir);
    setAskOwnerDeps({
      queue: () => queue,
      source: () => "test-source",
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetAskOwnerDeps();
  });

  function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      context: "Working on the escalation flow for autonomous runs.",
      question: "Should the timeout default to 10 minutes or 1 hour?",
      reason: "The default affects how long a workflow step can block on owner input.",
      ...overrides,
    };
  }

  it("rejects a question that fails the review gate", async () => {
    const result = await runAskOwner(validInput({ question: "why?" }));
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("review gate");
    expect(queue.list()).toHaveLength(0);
  });

  it("enqueues the question and returns immediately with the question id", async () => {
    const result = await runAskOwner(validInput());
    expect(result.is_error).toBeUndefined();
    const items = queue.list();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("pending");
    // The tool result must surface the queued question id so the workflow
    // runtime (or an operator UI) can match it against an await-event step.
    expect(result.content).toContain(`[${items[0].id}]`);
    expect(result.content).toMatch(/runtime owns the wait/);
  });

  it("does not poll, sleep, or wait for the queue to resolve", async () => {
    const start = Date.now();
    const result = await runAskOwner(validInput({ timeout_seconds: 1 }));
    const elapsed = Date.now() - start;
    // Enqueue-only: the tool must not wait for the timeout. A 1-second
    // timeout that returns synchronously proves the held-await polling loop
    // is gone.
    expect(elapsed).toBeLessThan(500);
    expect(result.is_error).toBeUndefined();
    const item = queue.list()[0];
    // The question carries the configured timeoutMs so the operator-question
    // expirer (not the tool) handles eventual resolution.
    expect(item.timeoutMs).toBe(1000);
    expect(item.status).toBe("pending");
  });

  it("records the configured source on the enqueued question", async () => {
    await runAskOwner(validInput());
    const pending = queue.list("pending");
    expect(pending[0].source).toBe("test-source");
  });

  it("carries proposed answers through to the queued item", async () => {
    await runAskOwner(validInput({ proposed_answers: ["10 min", "1 hour"] }));
    const pending = queue.list("pending");
    expect(pending[0].proposedAnswers).toEqual(["10 min", "1 hour"]);
  });
});
