import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  getOwnerQuestionQueue,
  OwnerQuestionQueue,
  resetOwnerQuestionQueue,
} from "./owner-question-queue.js";

let received: Array<{ event: string; payload: Record<string, unknown> }> = [];
function makeQueue(dir: string): OwnerQuestionQueue {
  const bus = new EventBus();
  received = [];
  bus.on("*", (envelope) => {
    received.push({ event: envelope.type, payload: envelope.payload as Record<string, unknown> });
  });
  return new OwnerQuestionQueue(dir, new ProjectScopedEventBus(bus, "test-project"));
}

function validEnqueue(overrides: Partial<Parameters<OwnerQuestionQueue["enqueue"]>[0]> = {}) {
  return {
    context: "Implementing the new escalation flow for autonomous runs.",
    question: "Should the timeout default to 10 minutes or 1 hour?",
    reason: "The default affects how long a workflow step can block on owner input.",
    source: "session-42",
    ...overrides,
  };
}

describe("OwnerQuestionQueue", () => {
  let dir: string;
  let queue: OwnerQuestionQueue;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "owner-question-test-"));
    queue = makeQueue(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("enqueues and retrieves a question", () => {
    const item = queue.enqueue(validEnqueue());
    expect(item.id).toHaveLength(8);
    expect(item.status).toBe("pending");
    expect(queue.get(item.id)).toEqual(item);
  });

  it("stores proposedAnswers when non-empty", () => {
    const item = queue.enqueue(validEnqueue({ proposedAnswers: ["10 min", "1 hour"] }));
    expect(item.proposedAnswers).toEqual(["10 min", "1 hour"]);
  });

  it("omits proposedAnswers when empty", () => {
    const item = queue.enqueue(validEnqueue({ proposedAnswers: [] }));
    expect(item.proposedAnswers).toBeUndefined();
  });

  it("lists pending questions and filters by status", () => {
    const a = queue.enqueue(validEnqueue());
    queue.enqueue(validEnqueue({ question: "Different question to pick later?" }));
    queue.answer(a.id, "10 min");
    expect(queue.list("pending")).toHaveLength(1);
    expect(queue.list("answered")).toHaveLength(1);
    expect(queue.list()).toHaveLength(2);
  });

  it("answers a pending question", () => {
    const item = queue.enqueue(validEnqueue());
    const answered = queue.answer(item.id, "10 minutes", "cli");
    expect(answered).not.toBeNull();
    expect(answered!.status).toBe("answered");
    expect(answered!.answer).toBe("10 minutes");
    expect(answered!.resolutionSource).toBe("cli");
    expect(answered!.resolvedAt).toBeDefined();
  });

  it("dismisses a pending question with reason", () => {
    const item = queue.enqueue(validEnqueue());
    const dismissed = queue.dismiss(item.id, "already decided elsewhere", "cli");
    expect(dismissed!.status).toBe("dismissed");
    expect(dismissed!.dismissalReason).toBe("already decided elsewhere");
  });

  it("cannot answer or dismiss an already resolved question", () => {
    const item = queue.enqueue(validEnqueue());
    queue.answer(item.id, "ok");
    expect(queue.answer(item.id, "again")).toBeNull();
    expect(queue.dismiss(item.id, "late")).toBeNull();
  });

  it("counts by status", () => {
    queue.enqueue(validEnqueue());
    queue.enqueue(validEnqueue({ question: "Another different question please?" }));
    const third = queue.enqueue(validEnqueue({ question: "Third different question to ask?" }));
    queue.answer(third.id, "done");
    expect(queue.count("pending")).toBe(2);
    expect(queue.count("answered")).toBe(1);
    expect(queue.count()).toBe(3);
  });

  it("clears all questions", () => {
    queue.enqueue(validEnqueue());
    queue.clear();
    expect(queue.list()).toHaveLength(0);
  });

  describe("expire (single item)", () => {
    it("marks a pending item expired with default dismiss resolution", () => {
      const item = queue.enqueue(validEnqueue());
      const expired = queue.expire(item.id, "test-source");
      expect(expired!.status).toBe("expired");
      expect(expired!.dismissalReason).toBe("expired");
      expect(expired!.resolutionSource).toBe("test-source");
    });

    it("answers with defaultAnswer when defaultResolution is answer", () => {
      const item = queue.enqueue(validEnqueue({
        defaultResolution: "answer",
        defaultAnswer: "go with 10 minutes",
      }));
      const result = queue.expire(item.id);
      expect(result!.status).toBe("answered");
      expect(result!.answer).toBe("go with 10 minutes");
    });

    it("returns null for nonexistent id", () => {
      expect(queue.expire("nope")).toBeNull();
    });

    it("returns null when item is already resolved", () => {
      const item = queue.enqueue(validEnqueue());
      queue.answer(item.id, "done");
      expect(queue.expire(item.id)).toBeNull();
    });
  });

  describe("expireStale", () => {
    function backdate(id: string, ageMs: number): void {
      const stored = queue.get(id)!;
      stored.createdAt = new Date(Date.now() - ageMs).toISOString();
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(stored, null, 2));
    }

    it("expires pending items older than ttl with default dismiss resolution", () => {
      const item = queue.enqueue(validEnqueue());
      backdate(item.id, 2000);
      const expired = queue.expireStale(1000);
      expect(expired).toHaveLength(1);
      expect(expired[0].status).toBe("expired");
      expect(expired[0].dismissalReason).toBe("expired");
    });

    it("honors per-item timeoutMs over defaultTtlMs", () => {
      const item = queue.enqueue(validEnqueue({ timeoutMs: 500 }));
      backdate(item.id, 2000);
      const expired = queue.expireStale(600_000);
      expect(expired).toHaveLength(1);
    });

    it("auto-answers with defaultAnswer when defaultResolution is answer", () => {
      const item = queue.enqueue(validEnqueue({
        timeoutMs: 500,
        defaultResolution: "answer",
        defaultAnswer: "proceed cautiously",
      }));
      backdate(item.id, 2000);
      const expired = queue.expireStale();
      expect(expired[0].status).toBe("answered");
      expect(expired[0].answer).toBe("proceed cautiously");
      expect(expired[0].resolutionSource).toBe("timeout");
    });

    it("skips items within ttl", () => {
      queue.enqueue(validEnqueue());
      expect(queue.expireStale(60_000)).toHaveLength(0);
    });

    it("skips resolved items", () => {
      const item = queue.enqueue(validEnqueue());
      queue.answer(item.id, "done");
      backdate(item.id, 2000);
      expect(queue.expireStale(1000)).toHaveLength(0);
    });
  });

  describe("events", () => {
    it("emits owner.question.asked on enqueue", () => {
      const item = queue.enqueue(validEnqueue());
      const asked = received.filter(({ event }) => event === "owner.question.asked");
      expect(asked).toHaveLength(1);
      expect(asked[0]?.payload).toMatchObject({ projectId: "test-project", id: item.id, source: "session-42" });
    });

    it("emits owner.question.changed on enqueue and resolution", () => {
      const item = queue.enqueue(validEnqueue());
      received.length = 0;
      queue.answer(item.id, "yes");
      const changed = received.filter(({ event }) => event === "owner.question.changed");
      expect(changed).toHaveLength(1);
      expect(changed[0]?.payload).toEqual({ projectId: "test-project", id: item.id, pendingCount: 0 });
    });

    it("emits owner.question.resolved with answered=true on answer", () => {
      const item = queue.enqueue(validEnqueue());
      received.length = 0;
      queue.answer(item.id, "yes");
      const resolved = received.filter(({ event }) => event === "owner.question.resolved");
      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.payload).toMatchObject({ projectId: "test-project", id: item.id, answered: true, answer: "yes" });
    });

    it("emits owner.question.dismissed on dismiss", () => {
      const item = queue.enqueue(validEnqueue());
      received.length = 0;
      queue.dismiss(item.id, "no longer needed");
      const dismissed = received.filter(({ event }) => event === "owner.question.dismissed");
      expect(dismissed).toHaveLength(1);
      expect(dismissed[0]?.payload).toEqual({ projectId: "test-project", id: item.id, reason: "no longer needed" });
    });

    it("emits owner.question.expired on expireStale", () => {
      const item = queue.enqueue(validEnqueue({ timeoutMs: 500 }));
      const stored = queue.get(item.id)!;
      stored.createdAt = new Date(Date.now() - 2000).toISOString();
      writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));
      received.length = 0;
      queue.expireStale();
      const expired = received.filter(({ event }) => event === "owner.question.expired");
      expect(expired).toHaveLength(1);
      expect(expired[0]?.payload).toEqual({ projectId: "test-project", id: item.id, defaultResolution: "dismiss" });
    });
  });
});

describe("getOwnerQuestionQueue singleton", () => {
  afterEach(() => resetOwnerQuestionQueue());

  it("returns the same instance on repeated calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-question-singleton-"));
    const q1 = getOwnerQuestionQueue(dir);
    const q2 = getOwnerQuestionQueue();
    expect(q1).toBe(q2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resets to a new instance after resetOwnerQuestionQueue", () => {
    const dir1 = mkdtempSync(join(tmpdir(), "owner-question-reset1-"));
    const dir2 = mkdtempSync(join(tmpdir(), "owner-question-reset2-"));
    const q1 = getOwnerQuestionQueue(dir1);
    resetOwnerQuestionQueue();
    const q2 = getOwnerQuestionQueue(dir2);
    expect(q1).not.toBe(q2);
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });
});
