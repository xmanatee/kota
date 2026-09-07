import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { setStderrTransport, setTerminalTransport, TerminalTransport } from "#modules/rendering/transport.js";
import { registerOwnerQuestionCommands } from "./cli.js";
import type { OwnerQuestionsClient } from "./client.js";

const question: PendingOwnerQuestion = {
  id: "question-1", seq: 0, context: "The decision depends on the full migration history and exact timeout semantics.",
  question: "Should the timeout be 10 minutes?", reason: "Workflow waiting time", source: "session-42",
  answerBehavior: "record-only", origin: { kind: "session", sessionId: "session-42" },
  createdAt: "2026-09-07T10:00:00.000Z", status: "pending",
};

function cli(items: PendingOwnerQuestion[] = []) {
  const client = {
    list: vi.fn<OwnerQuestionsClient["list"]>().mockResolvedValue({ questions: items }),
    answer: vi.fn<OwnerQuestionsClient["answer"]>(),
    dismiss: vi.fn<OwnerQuestionsClient["dismiss"]>(),
  } satisfies OwnerQuestionsClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transport = (chunks: string[]) => new TerminalTransport({ theme: NO_COLOR_THEME,
    stream: { isTTY: false, write: (chunk) => { chunks.push(chunk); return true; } },
  });
  setTerminalTransport(transport(stdout));
  setStderrTransport(transport(stderr));
  vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
  return { client, stderr, async run(...args: string[]) {
    const program = new Command().exitOverride();
    registerOwnerQuestionCommands(program, { client: { ownerQuestions: client } } as unknown as ModuleContext);
    await program.parseAsync(["node", "kota", "owner-question", ...args]);
    return stdout.join("");
  } };
}

afterEach(() => { setTerminalTransport(null); setStderrTransport(null); vi.restoreAllMocks(); });

describe("owner-question CLI", () => {
  it("prints empty wording and a machine-readable pending count", async () => {
    expect(await cli().run("list")).toContain("No pending owner questions");
    expect(await cli([question]).run("count")).toBe("1\n");
  });

  it("lists the answer behavior and the detail command", async () => {
    const output = await cli([question]).run("list");
    expect(output).toContain("session-42");
    expect(output).toContain("Should the timeout");
    expect(output).toContain("kota owner-question show");
    expect(output).toContain("Answer is recorded only");
  });

  it("shows full context and workflow-resume instructions", async () => {
    const output = await cli([{ ...question, answerBehavior: "workflow-resume",
      origin: { kind: "workflow", workflowName: "blocked-promoter", runId: "run-123", stepId: "ask", taskId: "task-one" },
      proposedAnswers: ["unblock"], timeoutMs: 600_000, defaultResolution: "dismiss",
    }]).run("show", question.id);
    expect(output).toContain(question.context);
    expect(output).toContain("Run:      run-123");
    expect(output).toContain("Task:     task-one");
    expect(output).toContain("Answer resumes the waiting workflow");
    expect(output).toContain("Proposed 1: unblock");
    expect(output).toContain("Timeout:  10m");
  });

  it("renders missing historical metadata explicitly", async () => {
    const output = await cli([{ ...question, origin: { kind: "manual", source: "not recorded" }, answerBehavior: "unknown", status: "answered", answer: "yes" }]).run("show", question.id);
    expect(output).toContain("Origin:   not recorded");
    expect(output).toContain("Answer behavior was not recorded");
  });

  it("forwards the answer as one argument and renders the response", async () => {
    const view = cli();
    view.client.answer.mockResolvedValue({ ok: true, question: { ...question, status: "answered", answer: "10 minutes" } });
    expect(await view.run("answer", question.id, "10 minutes")).toContain("10 minutes");
    expect(view.client.answer).toHaveBeenCalledWith(question.id, "10 minutes");
  });

  it("forwards --reason and renders a dismissal", async () => {
    const view = cli();
    view.client.dismiss.mockResolvedValue({ ok: true, question: { ...question, status: "dismissed", dismissalReason: "scope change" } });
    expect(await view.run("dismiss", question.id, "--reason", "scope change")).toContain("scope change");
    expect(view.client.dismiss).toHaveBeenCalledWith(question.id, "scope change");
  });

  it("reports a missing answer target with exit status 1", async () => {
    const view = cli();
    view.client.answer.mockResolvedValue({ ok: false, reason: "not_found" });
    await expect(view.run("answer", "missing", "yes")).rejects.toThrow("exit:1");
    expect(view.stderr.join("")).toContain("not found");
  });

  it("filters history by status and retains resolved context and answer attribution", async () => {
    const view = cli([
      { ...question, status: "answered", answer: "10 minutes", resolutionSource: "cli" },
      { ...question, id: "dismissed", status: "dismissed", dismissalReason: "not needed" },
    ]);
    const output = await view.run("history", "--status", "answered");
    expect(output).toContain("status=answered");
    expect(output).not.toContain("status=dismissed");
    expect(output).toContain("10 minutes");
    expect(output).toContain(question.context);
  });
});
