import "./adapter-test-support.js";
import { describe, expect, it } from "vitest";
import { antigravityCliAgentHarness } from "./adapter.js";
import {
  agyOutputAfterToolFailure,
  mockAgyProcess,
  mockManualAgyProcess,
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
      text: "not logged in",
      isError: true,
      subtype: "antigravity_cli_error",
    });
  });

  it("rejects abort quarantine when AGY closes without a remote terminal result", async () => {
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
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGTERM");

    await expect(run).resolves.toMatchObject({
      text: expect.stringContaining(
        "stopped locally before the remote attempt reported a terminal result",
      ),
      isError: true,
      subtype: "antigravity_cli_unconfirmed_remote_stop",
    });
    await expect(quarantine?.(new Error("cancelled"))).rejects.toThrow(
      /stopped locally before the remote attempt reported a terminal result/,
    );
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
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
      inputTokens: 31,
      outputTokens: 4,
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
      inputTokens: 8,
      outputTokens: 0,
      isError: false,
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
      inputTokens: 20,
      outputTokens: 2,
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
      text: "Antigravity CLI exited without a terminal result event.",
      isError: true,
      subtype: "antigravity_cli_incomplete_output",
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
