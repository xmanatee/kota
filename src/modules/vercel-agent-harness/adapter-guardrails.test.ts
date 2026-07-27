import { describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  captureStreamTextArgs,
  createRejectedStreamTextStub,
  createStreamTextStub,
  executeToolMock,
  getAllToolsMock,
  getSecretStoreMock,
  runAndCaptureToolExecute,
  silenceRejectedStreamTextStub,
  streamTextMock,
  TEST_TOOL,
  vercelAgentHarness,
} from "./adapter-test-support.js";

describe("vercelAgentHarness — guardrails", () => {
  it("denies through canUseTool by returning a tool result with isError", async () => {
    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "echo_tool blocked by policy",
    });
    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      canUseTool,
    });
    const result = await toolExecute(
      { text: "secret" },
      { toolCallId: "call_1" },
    );

    expect(canUseTool).toHaveBeenCalledWith(
      "echo_tool",
      { text: "secret" },
      expect.objectContaining({ signal: expect.any(AbortSignal), toolUseId: "call_1" }),
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: "echo_tool blocked by policy",
    });
  });

  it("masks registered secrets before returning raw tool results to the Vercel SDK", async () => {
    getSecretStoreMock.mockReturnValue({
      mask: (text: string) => text.replaceAll("agent-secret-token", "<secret:API_TOKEN>"),
    });
    executeToolMock.mockResolvedValue({ content: "token=agent-secret-token" });

    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
    });
    const result = await toolExecute(
      { text: "show token" },
      { toolCallId: "call_mask" },
    );

    expect(result).toEqual({
      isError: false,
      content: "token=<secret:API_TOKEN>",
    });
    expect(JSON.stringify(result)).not.toContain("agent-secret-token");
  });

  it("passes cwd and workflow metadata to KOTA tool execution", async () => {
    executeToolMock.mockResolvedValue({ content: "context ok" });
    const executionCwd = "/tmp/kota-vercel-metadata";
    const workflowContext = {
      workflowName: "builder",
      runId: "run-1",
      stepId: "build",
      spanId: "run-1:build",
      scopeId: "scope-1",
      projectId: "scope-1",
    };
    const sessionContext = {
      sessionId: "session-1",
      scopeId: "scope-1",
      projectId: "scope-1",
    };

    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      cwd: executionCwd,
      sessionContext,
      workflowContext,
    });
    const result = await toolExecute(
      { text: "context" },
      { toolCallId: "call_context" },
    );

    expect(result).toEqual({
      isError: false,
      content: "context ok",
    });
    expect(executeToolMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "context" },
      expect.objectContaining({
        toolUseId: "call_context",
        sessionId: "session-1",
        cwd: executionCwd,
        workflow: workflowContext,
        scopeId: "scope-1",
        projectId: "scope-1",
      }),
    );
  });

  it("filters disallowedTools out of the Vercel ToolSet so the model never sees them", async () => {
    streamTextMock.mockImplementation(() => createStreamTextStub());

    await vercelAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      disallowedTools: ["echo_tool"],
    });

    const args = captureStreamTextArgs();
    expect(args.tools).toBeUndefined();
  });

  it("only exposes allowedTools to the model (filtered at conversion time)", async () => {
    const otherTool: KotaTool = {
      name: "other_tool",
      description: "Other",
      input_schema: { type: "object", properties: {} },
    };
    getAllToolsMock.mockReturnValue([TEST_TOOL, otherTool]);

    const { streamArgs } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      allowedTools: ["echo_tool"],
    });
    expect(Object.keys(streamArgs.tools ?? {})).toEqual(["echo_tool"]);
  });

  it("ends the loop with isError when canUseTool deny carries interrupt: true", async () => {
    const stub = createRejectedStreamTextStub("aborted");
    silenceRejectedStreamTextStub(stub);
    streamTextMock.mockImplementation((args) => {
      const toolExecute = args.tools?.echo_tool?.execute;
      if (!toolExecute) throw new Error("echo_tool execute was not registered");
      void toolExecute({ text: "x" }, { toolCallId: "call_int" });
      return stub;
    });

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "commit_guard blocked git commit",
      interrupt: true,
    });

    const promise = vercelAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      canUseTool,
    });

    await new Promise((resolve) => setImmediate(resolve));

    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("interrupted_by_can_use_tool");
    expect(result.text).toContain("commit_guard blocked git commit");
  });
});
