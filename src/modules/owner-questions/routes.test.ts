import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  handleAnswerOwnerQuestion,
  handleDismissOwnerQuestion,
  handleListOwnerQuestions,
} from "./routes.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
  getEventBus: () => null,
}));

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function mockRequest(body: Record<string, unknown> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body));
  let dataHandler: ((chunk: Buffer) => void) | null = null;
  let endHandler: (() => void) | null = null;
  const req = {
    headers: { "content-type": "application/json" },
    on: (event: string, cb: (data?: Buffer) => void) => {
      if (event === "data") dataHandler = cb as (chunk: Buffer) => void;
      if (event === "end") endHandler = cb as () => void;
      if (event === "error") {
        /* noop */
      }
      if (dataHandler && endHandler) {
        dataHandler(buf);
        endHandler();
        dataHandler = null;
        endHandler = null;
      }
    },
  };
  return req as unknown as IncomingMessage;
}

function makeQueue(): OwnerQuestionQueue {
  const dir = mkdtempSync(join(tmpdir(), "owner-question-routes-"));
  const queue = new OwnerQuestionQueue(dir);
  (queue as OwnerQuestionQueue & { _testDir: string })._testDir = dir;
  return queue;
}

describe("owner-questions routes", () => {
  let queue: OwnerQuestionQueue;

  beforeEach(() => {
    queue = makeQueue();
  });

  afterEach(() => {
    const dir = (queue as OwnerQuestionQueue & { _testDir?: string })._testDir;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function seed() {
    return queue.enqueue({
      context: "Working on the escalation flow for autonomous runs.",
      question: "Should the timeout default to 10 minutes or 1 hour?",
      reason: "The default affects how long workflow steps block on owner input.",
      source: "session",
      answerBehavior: "record-only",
      origin: { kind: "session", sessionId: "session" },
    });
  }

  it("GET list returns pending questions", async () => {
    seed();
    const { res, result } = mockResponse();
    await handleListOwnerQuestions(res, queue);
    expect(result.status).toBe(200);
    expect((result.body as { questions: unknown[] }).questions).toHaveLength(1);
  });

  it("POST answer 400s on empty answer", async () => {
    const item = seed();
    const { res, result } = mockResponse();
    await handleAnswerOwnerQuestion(mockRequest({ answer: "" }), res, item.id, queue);
    expect(result.status).toBe(400);
    expect(queue.get(item.id)!.status).toBe("pending");
  });

  it("POST answer resolves the question", async () => {
    const item = seed();
    const { res, result } = mockResponse();
    await handleAnswerOwnerQuestion(mockRequest({ answer: "10 minutes" }), res, item.id, queue);
    expect(result.status).toBe(200);
    const body = result.body as { question: { status: string; answer: string } };
    expect(body.question.status).toBe("answered");
    expect(body.question.answer).toBe("10 minutes");
  });

  it("POST answer 404s on unknown id", async () => {
    const { res, result } = mockResponse();
    await handleAnswerOwnerQuestion(mockRequest({ answer: "yes" }), res, "nope", queue);
    expect(result.status).toBe(404);
  });

  it("POST dismiss resolves the question", async () => {
    const item = seed();
    const { res, result } = mockResponse();
    await handleDismissOwnerQuestion(mockRequest({ reason: "scope change" }), res, item.id, queue);
    expect(result.status).toBe(200);
    expect(queue.get(item.id)!.status).toBe("dismissed");
    expect(queue.get(item.id)!.dismissalReason).toBe("scope change");
  });
});
