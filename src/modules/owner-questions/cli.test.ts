import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerQuestionQueue, resetOwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { registerOwnerQuestionCommands } from "./cli.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
  getEventBus: () => null,
}));

let testQueue: OwnerQuestionQueue;
vi.mock("#core/daemon/owner-question-queue.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("#core/daemon/owner-question-queue.js")>();
  return {
    ...mod,
    getOwnerQuestionQueue: () => testQueue,
  };
});

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerOwnerQuestionCommands(program);
  return program;
}

async function run(program: Command, ...args: string[]): Promise<void> {
  await program.parseAsync(["node", "cli", ...args]);
}

function seed(queue: OwnerQuestionQueue) {
  return queue.enqueue({
    context: "Working on the escalation flow for autonomous runs.",
    question: "Should the timeout default to 10 minutes or 1 hour?",
    reason: "The default affects how long workflow steps block on owner input.",
    source: "session-42",
  });
}

describe("owner-question CLI", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "owner-question-cli-"));
    testQueue = new OwnerQuestionQueue(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetOwnerQuestionQueue();
    vi.clearAllMocks();
  });

  it("list prints empty message when no pending questions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "list");
    expect(logSpy.mock.calls.flat().join(" ")).toContain("No pending owner questions");
    logSpy.mockRestore();
  });

  it("list prints pending questions", async () => {
    seed(testQueue);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "list");
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("1 pending owner question(s)");
    expect(output).toContain("session-42");
    expect(output).toContain("Should the timeout default");
    logSpy.mockRestore();
  });

  it("count prints the pending count", async () => {
    seed(testQueue);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "count");
    expect(logSpy.mock.calls.flat().join("")).toBe("1");
    logSpy.mockRestore();
  });

  it("answer marks a pending question answered", async () => {
    const item = seed(testQueue);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "answer", item.id, "10 minutes");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("10 minutes");
    expect(testQueue.get(item.id)?.status).toBe("answered");
    expect(testQueue.get(item.id)?.answer).toBe("10 minutes");
    logSpy.mockRestore();
  });

  it("answer errors on nonexistent id", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    await expect(run(makeProgram(), "owner-question", "answer", "nonexistent", "yes")).rejects.toThrow("exit");
    expect(errSpy.mock.calls.flat().join("")).toContain("not found");
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("dismiss marks a pending question dismissed", async () => {
    const item = seed(testQueue);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "dismiss", item.id, "--reason", "scope change");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("scope change");
    expect(testQueue.get(item.id)?.status).toBe("dismissed");
    expect(testQueue.get(item.id)?.dismissalReason).toBe("scope change");
    logSpy.mockRestore();
  });

  it("history shows resolved questions", async () => {
    const item = seed(testQueue);
    testQueue.answer(item.id, "10 minutes");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "history");
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("status=answered");
    expect(output).toContain("10 minutes");
    logSpy.mockRestore();
  });

  it("history --status filters", async () => {
    const a = seed(testQueue);
    testQueue.answer(a.id, "yes");
    const b = testQueue.enqueue({
      context: "Another context for another decision at hand right now.",
      question: "Some completely different question for the owner?",
      reason: "Another reason that is distinct from the first for dedup.",
      source: "session",
    });
    testQueue.dismiss(b.id, "not needed");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(makeProgram(), "owner-question", "history", "--status", "answered");
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("status=answered");
    expect(output).not.toContain("status=dismissed");
    logSpy.mockRestore();
  });
});
