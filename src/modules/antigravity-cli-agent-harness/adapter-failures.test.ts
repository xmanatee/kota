import "./adapter-test-support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAgentHarness } from "#core/agent-harness/runner.js";
import { resetAgentConversation } from "#core/agent-harness/session-continuity.js";
import { antigravityCliAgentHarness } from "./adapter.js";
import {
  adapterTestMocks,
  agyOutputAfterToolFailure,
  mockAgyProcess,
  mockManualAgyProcess,
  successfulAgyOutput,
  successfulEmptyAgyOutput,
} from "./adapter-test-support.js";

describe("antigravityCliAgentHarness failures", () => {
  it("returns a structured error when AGY exits non-zero", async () => {
    mockAgyProcess({ code: 1, stderr: "not logged in" });

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: expect.stringContaining("not logged in"),
      isError: true,
      subtype: "antigravity_cli_unconfirmed_remote_stop",
    });
  });

  it.each([
    { name: "caller cancellation", code: null, signal: "SIGTERM", cancel: true, controller: true },
    { name: "exit zero", code: 0, signal: null, cancel: false, controller: true },
    { name: "exit nonzero", code: 1, signal: null, cancel: false, controller: true },
    { name: "exit without cancellation support", code: 0, signal: null, cancel: false, controller: false },
    { name: "unexpected signal", code: null, signal: "SIGKILL", cancel: false, controller: true },
    { name: "invalid output", code: 0, signal: null, cancel: false, controller: true, malformed: true },
  ])("blocks conversation reuse after $name without remote stop confirmation", async ({ code, signal, cancel, controller, malformed }) => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-unresolved-stop-"));
    try {
      const child = mockManualAgyProcess();
      const abortController = new AbortController();
      const onSessionId = vi.fn();
      const options = {
        prompt: "x", model: "gemini-3.6-flash", effort: "xhigh" as const,
        cwd: root, scopeRoot: root, continuityKey: "agy-owner", onSessionId,
      };
      const run = runAgentHarness(antigravityCliAgentHarness, { ...options, ...(controller ? { abortController } : {}) });
      child.stdout.write(`${JSON.stringify({ event: "init", conversation_id: "remote-attempt-1" })}\n`);
      await vi.waitFor(() => expect(onSessionId).toHaveBeenCalledWith("remote-attempt-1"));
      if (cancel) abortController.abort();
      if (malformed) child.stdout.write("invalid JSON\n");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", code, signal);
      await expect(run).rejects.toThrow(/stopped locally before .* reported a terminal result/);
      await expect(run.settled).rejects.toThrow("failed to quarantine");
      await expect(runAgentHarness(antigravityCliAgentHarness, options)).rejects.toThrow("unresolved native stop");
      await expect(runAgentHarness(antigravityCliAgentHarness, {
        ...options, continuityKey: undefined, resumeSessionId: "remote-attempt-1",
      })).rejects.toThrow("unresolved native stop");
      expect(() => resetAgentConversation(root, "agy-owner", "operator reset")).toThrow("unresolved native stop");
      expect(adapterTestMocks().spawnMock).toHaveBeenCalledTimes(1);
      if (cancel) expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each(["sandbox preparation", "synchronous spawn", "asynchronous spawn"])("recovers the exact preserved conversation after a proven prelaunch %s failure", async (failure) => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-prelaunch-"));
    try {
      const options = {
        prompt: "work", model: "gemini-3.6-flash", effort: "high" as const,
        cwd: root, scopeRoot: root, continuityKey: "agy-owner",
      };
      mockAgyProcess({ stdout: successfulAgyOutput("preserved") });
      await expect(runAgentHarness(antigravityCliAgentHarness, options)).resolves.toMatchObject({ sessionId: "conversation-1" });
      const { sandboxLaunchMock, spawnMock } = adapterTestMocks();
      if (failure === "sandbox preparation") sandboxLaunchMock.mockRejectedValueOnce(new Error("prelaunch unavailable"));
      else if (failure === "synchronous spawn") spawnMock.mockImplementationOnce(() => { throw new Error("prelaunch unavailable"); });
      else {
        const child = mockManualAgyProcess();
        queueMicrotask(() => {
          child.emit("error", new Error("prelaunch unavailable"));
          child.stdout.end();
          child.stderr.end();
          child.emit("close", -2, null);
        });
      }
      const failed = runAgentHarness(antigravityCliAgentHarness, options);
      if (failure === "asynchronous spawn") await expect(failed).resolves.toMatchObject({ isError: true, text: "prelaunch unavailable" });
      else await expect(failed).rejects.toThrow("prelaunch unavailable");
      await expect(failed.settled).resolves.toBeUndefined();
      mockAgyProcess({ stdout: successfulAgyOutput("recovered") });
      await expect(runAgentHarness(antigravityCliAgentHarness, options)).resolves.toMatchObject({ sessionId: "conversation-1", text: "recovered" });
      expect(spawnMock.mock.lastCall?.[1]).toEqual(expect.arrayContaining(["--conversation", "conversation-1"]));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each(["SUCCESS", "CANCELLED"])("permits reuse after a confirmed %s result", async (status) => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-confirmed-stop-"));
    try {
      const options = {
        prompt: "x", model: "gemini-3.6-flash", effort: "xhigh" as const,
        cwd: root, scopeRoot: root, continuityKey: "agy-owner",
      };
      const stdout = `${JSON.stringify({
        event: "result",
        result: { conversation_id: "remote-attempt-1", status, response: "finished" },
      })}\n`;
      for (let attempt = 0; attempt < 2; attempt++) {
        mockAgyProcess({ stdout, code: status === "SUCCESS" ? 0 : 1 });
        const run = runAgentHarness(antigravityCliAgentHarness, options);
        await expect(run).resolves.toMatchObject({ sessionId: "remote-attempt-1", isError: status !== "SUCCESS" });
        await expect(run.settled).resolves.toBeUndefined();
      }
      expect(adapterTestMocks().spawnMock).toHaveBeenCalledTimes(2);
      expect(adapterTestMocks().spawnMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(["--conversation", "remote-attempt-1"]));
      expect(() => resetAgentConversation(root, "agy-owner", "operator reset")).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("releases abort quarantine only after AGY reports the remote attempt terminal", async () => {
    const child = mockManualAgyProcess();
    const abortController = new AbortController();
    let quarantine: ((reason: Error) => void | Promise<void>) | undefined;
    const run = antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
      abortController,
      abortQuarantine: {
        register: (handler) => {
          quarantine = handler;
        },
      },
    });

    abortController.abort();
    child.stdout.write(`${JSON.stringify({
      event: "result",
      result: {
        conversation_id: "remote-attempt-1",
        status: "CANCELLED",
        error: "cancelled",
        num_turns: 2,
        usage: { input_tokens: 31, output_tokens: 4 },
      },
    })}\n`);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toMatchObject({
      text: "Antigravity CLI run aborted.",
      sessionId: "remote-attempt-1",
      turns: 2,
      usage: {
        tokens: { state: "complete", inputTokens: 31, outputTokens: 4 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
      isError: true,
      subtype: "aborted",
    });
    await expect(quarantine?.(new Error("cancelled"))).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("preserves terminal AGY success without text for workflow-level validation", async () => {
    mockAgyProcess({ stdout: successfulEmptyAgyOutput() });

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "",
      streamedText: "",
      sessionId: "conversation-empty",
      turns: 1,
      usage: {
        tokens: { state: "complete", inputTokens: 8, outputTokens: 0 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
      isError: false,
      subtype: "antigravity_cli_empty_output",
    });
  });

  it("reports a denied tool when AGY follows it with an empty terminal success", async () => {
    mockAgyProcess({
      stdout: agyOutputAfterToolFailure({
        detail: "User denied permission for command(pwd)",
      }),
    });

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: expect.stringContaining(
        'completed without a response after tool "run_command" failed',
      ),
      streamedText: "",
      turns: 1,
      usage: {
        tokens: { state: "complete", inputTokens: 20, outputTokens: 2 },
        cost: { state: "unavailable", reason: "provider-does-not-report" },
      },
      isError: true,
      subtype: "antigravity_cli_permission_error",
    });
  });

  it("accepts a final response when AGY recovers from an earlier tool failure", async () => {
    mockAgyProcess({
      stdout: agyOutputAfterToolFailure({
        detail: "command failed once",
        response: "recovered",
      }),
    });

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "recovered",
      streamedText: "recovered",
      isError: false,
    });
  });

  it("rejects a process exit without AGY's terminal result event", async () => {
    mockAgyProcess();

    const result = await antigravityCliAgentHarness.run({
      prompt: "x",
      model: "gemini-3.6-flash",
      effort: "xhigh",
    });

    expect(result).toMatchObject({
      text: "Antigravity CLI stopped locally before the remote attempt reported a terminal result.",
      isError: true,
      subtype: "antigravity_cli_unconfirmed_remote_stop",
    });
  });

  it("requires an explicit model before invoking AGY", async () => {
    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/requires an explicit model/);
  });

  it("rejects unsupported KOTA-owned tool-control surfaces loudly", async () => {
    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        canUseTool: async () => ({ behavior: "allow" }),
      }),
    ).rejects.toThrow(/canUseTool/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        mcpServers: { foo: { type: "stdio", command: "bar" } },
      }),
    ).rejects.toThrow(/does not host KOTA MCP servers/);

    await expect(
      antigravityCliAgentHarness.run({
        prompt: "x",
        model: "gemini-3.6-flash",
        effort: "xhigh",
        askOwner: { source: "test" },
      }),
    ).rejects.toThrow(/ask_owner/);
  });
});
