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

type MockClock = { now: () => number; sleep: (ms: number) => Promise<void> };

function makeMockClock(): MockClock {
  let currentTime = 0;
  return {
    now: () => currentTime,
    sleep: async (ms: number) => {
      currentTime += ms;
    },
  };
}

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
    const clock = makeMockClock();
    setAskOwnerDeps({ clock });
    const result = await runAskOwner(validInput({ question: "why?" }));
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("review gate");
    expect(queue.list()).toHaveLength(0);
  });

  it("enqueues and returns the answer when the owner responds", async () => {
    const clock = makeMockClock();
    setAskOwnerDeps({ clock });
    const promise = runAskOwner(validInput());
    // Let the first poll happen then inject an answer
    await Promise.resolve();
    const pending = queue.list("pending");
    expect(pending).toHaveLength(1);
    queue.answer(pending[0].id, "10 minutes");

    const result = await promise;
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("10 minutes");
  });

  it("returns dismissal info when the owner dismisses the question", async () => {
    const clock = makeMockClock();
    setAskOwnerDeps({ clock });
    const promise = runAskOwner(validInput());
    await Promise.resolve();
    const pending = queue.list("pending");
    queue.dismiss(pending[0].id, "scope change");
    const result = await promise;
    expect(result.content).toContain("dismissed");
    expect(result.content).toContain("scope change");
  });

  it("times out and reports gracefully when no owner response", async () => {
    const clock = makeMockClock();
    setAskOwnerDeps({ clock });
    const result = await runAskOwner(validInput({ timeout_seconds: 1 }));
    expect(result.content).toContain("timed out");
    const items = queue.list();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("expired");
  });

  it("records the configured source on the enqueued question", async () => {
    const clock = makeMockClock();
    setAskOwnerDeps({ clock });
    const promise = runAskOwner(validInput());
    await Promise.resolve();
    const pending = queue.list("pending");
    expect(pending[0].source).toBe("test-source");
    queue.answer(pending[0].id, "ok");
    await promise;
  });

  it("carries proposed answers through to the queued item", async () => {
    const clock = makeMockClock();
    setAskOwnerDeps({ clock });
    const promise = runAskOwner(validInput({ proposed_answers: ["10 min", "1 hour"] }));
    await Promise.resolve();
    const pending = queue.list("pending");
    expect(pending[0].proposedAnswers).toEqual(["10 min", "1 hour"]);
    queue.answer(pending[0].id, "10 min");
    await promise;
  });
});
