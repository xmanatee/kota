import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OwnerQuestionEnqueueInput,
  OwnerQuestionQueue,
  type OwnerQuestionStatus,
  resetOwnerQuestionQueue,
} from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerOwnerQuestionCommands } from "./cli.js";

vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: vi.fn(),
  getEventBus: () => null,
}));

let testQueue: OwnerQuestionQueue;

function stubCtx(): ModuleContext {
  return {
    client: {
      ownerQuestions: {
        async list(filter?: { status?: OwnerQuestionStatus | "all" }) {
          const status = filter?.status;
          if (status === undefined) return { questions: testQueue.list("pending") };
          if (status === "all") return { questions: testQueue.list() };
          return { questions: testQueue.list(status) };
        },
        async answer(id: string, answer: string) {
          const item = testQueue.answer(id, answer, "cli");
          return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
        },
        async dismiss(id: string, reason?: string) {
          const item = testQueue.dismiss(id, reason, "cli");
          return item ? { ok: true, question: item } : { ok: false, reason: "not_found" };
        },
      },
    },
  } as unknown as ModuleContext;
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerOwnerQuestionCommands(program, stubCtx());
  return program;
}

async function run(program: Command, ...args: string[]): Promise<void> {
  await program.parseAsync(["node", "cli", ...args]);
}

async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(`${args.join(" ")}\n`);
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    lines.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  }
  return lines.join("");
}

function seed(
  queue: OwnerQuestionQueue,
  overrides: Partial<OwnerQuestionEnqueueInput> = {},
) {
  return queue.enqueue({
    context: "Working on the escalation flow for autonomous runs.",
    question: "Should the timeout default to 10 minutes or 1 hour?",
    reason: "The default affects how long workflow steps block on owner input.",
    source: "session-42",
    answerBehavior: "record-only",
    origin: { kind: "session", sessionId: "session-42" },
    ...overrides,
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
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "list");
    });
    expect(output).toContain("No pending owner questions");
  });

  it("list prints pending questions", async () => {
    seed(testQueue);
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "list");
    });
    expect(output).toContain("1 pending owner question(s)");
    expect(output).toContain("session-42");
    expect(output).toContain("Should the timeout default");
    expect(output).toContain("kota owner-question show");
    expect(output).toContain("Answer is recorded only");
  });

  it("show prints full pending details without truncating context", async () => {
    const longContext =
      "The owner needs the entire detail body because the decision depends on " +
      "the migration history, the failed recovery path, the current run metadata, " +
      "and the exact operator-facing timeout semantics that would be hidden by a list preview.";
    const item = seed(testQueue, {
      context: longContext,
      source: "blocked-promoter",
      answerBehavior: "workflow-resume",
      origin: {
        kind: "workflow",
        workflowName: "blocked-promoter",
        runId: "run-123",
        stepId: "blocked-promoter-ask-ask",
        taskId: "task-owner-decision",
      },
      proposedAnswers: ["unblock", "refresh marker"],
      timeoutMs: 10 * 60 * 1000,
      defaultResolution: "dismiss",
    });
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "show", item.id);
    });
    expect(output).toContain("The owner needs the entire detail body");
    expect(output).toContain("exact operator-facing timeout semantics");
    expect(output).not.toContain("...");
    expect(output).toContain("Workflow: blocked-promoter");
    expect(output).toContain("Run:      run-123");
    expect(output).toContain("Task:     task-owner-decision");
    expect(output).toContain("Answer resumes the waiting workflow");
    expect(output).toContain("Proposed 1: unblock");
    expect(output).toContain("Timeout:  10m");
    expect(output).toContain(`kota owner-question answer ${item.id}`);
  });

  it("show and history render not-recorded metadata for legacy persisted questions", async () => {
    writeFileSync(join(dir, "legacy1.json"), JSON.stringify({
      id: "legacy1",
      seq: 0,
      context: "Legacy context should remain readable even though the stored record predates new metadata.",
      question: "Should this old owner question still be auditable?",
      reason: "The queue directory is the source of truth for existing owner questions.",
      source: "blocked-promoter",
      createdAt: "2026-05-08T03:46:22.179Z",
      status: "answered",
      resolvedAt: "2026-05-08T03:56:51.427Z",
      answer: "yes",
      resolutionSource: "http",
    }, null, 2));

    const detail = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "show", "legacy1");
    });
    expect(detail).toContain("Origin:   not recorded");
    expect(detail).toContain("Answer behavior was not recorded");
    expect(detail).toContain("Legacy context should remain readable");

    const history = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "history");
    });
    expect(history).toContain("Origin:   not recorded");
    expect(history).toContain("Answer behavior was not recorded");
    expect(history).toContain("Should this old owner question still be auditable?");
  });

  it("count prints the pending count", async () => {
    seed(testQueue);
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "count");
    });
    expect(output.trim()).toBe("1");
  });

  it("answer marks a pending question answered", async () => {
    const item = seed(testQueue);
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "answer", item.id, "10 minutes");
    });
    expect(output).toContain("10 minutes");
    expect(testQueue.get(item.id)?.status).toBe("answered");
    expect(testQueue.get(item.id)?.answer).toBe("10 minutes");
  });

  it("show prints resolved details and resolution source after answer", async () => {
    const item = seed(testQueue, {
      context: "Resolved detail context should remain visible after the answer.",
    });
    await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "answer", item.id, "10 minutes");
    });
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "show", item.id);
    });
    expect(output).toContain("status=answered");
    expect(output).toContain("Resolved detail context should remain visible");
    expect(output).toContain("Resolved by: cli");
    expect(output).toContain("Final answer: 10 minutes");
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
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "dismiss", item.id, "--reason", "scope change");
    });
    expect(output).toContain("scope change");
    expect(testQueue.get(item.id)?.status).toBe("dismissed");
    expect(testQueue.get(item.id)?.dismissalReason).toBe("scope change");
  });

  it("history shows resolved questions", async () => {
    const item = seed(testQueue);
    testQueue.answer(item.id, "10 minutes");
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "history");
    });
    expect(output).toContain("status=answered");
    expect(output).toContain("10 minutes");
    expect(output).toContain("Working on the escalation flow");
    expect(output).toContain("The default affects how long workflow steps block");
    expect(output).toContain("Answer is recorded only");
  });

  it("history --status filters", async () => {
    const a = seed(testQueue);
    testQueue.answer(a.id, "yes");
    const b = testQueue.enqueue({
      context: "Another context for another decision at hand right now.",
      question: "Some completely different question for the owner?",
      reason: "Another reason that is distinct from the first for dedup.",
      source: "session",
      answerBehavior: "record-only",
      origin: { kind: "session", sessionId: "session" },
    });
    testQueue.dismiss(b.id, "not needed");
    const output = await captureOutput(async () => {
      await run(makeProgram(), "owner-question", "history", "--status", "answered");
    });
    expect(output).toContain("status=answered");
    expect(output).not.toContain("status=dismissed");
  });
});
