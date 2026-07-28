import { describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  captureStreamTextArgs,
  confirmActionMock,
  createStreamTextStub,
  enqueueApprovalMock,
  executeToolMock,
  getAllToolsMock,
  getToolEffectMock,
  maskKnownSecretValuesMock,
  streamTextMock,
  TEST_TOOL,
  vercelAgentHarness,
} from "./adapter-test-support.js";
import { runAndCaptureToolExecute } from "./adapter-tool-test-support.js";

describe("vercelAgentHarness — guardrails", () => {
  const useDangerousToolEffect = (): void => {
    getToolEffectMock.mockReturnValue({
      kind: "destructive",
      scope: "local-fs",
      idempotent: false,
      openWorld: false,
    });
  };

  it("blocks a dangerous tool under a deny policy through the shared runner", async () => {
    useDangerousToolEffect();
    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      guardrailsConfig: {
        policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
      },
    });

    const result = await toolExecute({ text: "delete" }, { toolCallId: "deny_1" });

    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Blocked by guardrails");
  });

  it("requires confirmation for a dangerous tool before execution", async () => {
    useDangerousToolEffect();
    confirmActionMock.mockResolvedValue(false);
    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      guardrailsConfig: {
        policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      },
    });

    const result = await toolExecute(
      { text: "delete" },
      { toolCallId: "confirm_1" },
    );

    expect(confirmActionMock).toHaveBeenCalledWith(
      expect.stringContaining("Allow echo_tool?"),
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result.content).toContain("requires confirmation");
  });

  it("queues a dangerous supervised call with its session identity", async () => {
    useDangerousToolEffect();
    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      autonomyMode: "supervised",
      sessionContext: {
        sessionId: "vercel-session",
        scopeId: "scope-a",
        projectId: "scope-a",
      },
    });

    const result = await toolExecute(
      { text: "delete" },
      { toolCallId: "queue_1" },
    );

    expect(enqueueApprovalMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "delete" },
      "dangerous",
      expect.any(String),
      "vercel-session",
      undefined,
      undefined,
      undefined,
      "vercel-session",
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result.content).toContain("approval-vercel");
  });

  it("uses client approval for a queued dangerous call before execution", async () => {
    useDangerousToolEffect();
    executeToolMock.mockResolvedValue({ content: "executed" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });
    const { toolExecute } = await runAndCaptureToolExecute({
      harness: vercelAgentHarness,
      guardrailsConfig: {
        policies: { safe: "allow", moderate: "allow", dangerous: "queue" },
      },
      clientApprovalResolver,
      sessionContext: {
        sessionId: "vercel-client-session",
        scopeId: "scope-a",
        projectId: "scope-a",
      },
    });

    const result = await toolExecute(
      { text: "ship" },
      { toolCallId: "client_1" },
    );

    expect(clientApprovalResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "client_1",
        toolName: "echo_tool",
        sessionId: "vercel-client-session",
      }),
    );
    expect(enqueueApprovalMock).not.toHaveBeenCalled();
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ isError: false, content: "executed" });
  });

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
    maskKnownSecretValuesMock.mockImplementation((text) =>
      text.replaceAll("agent-secret-token", "<secret:API_TOKEN>"),
    );
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
    streamTextMock.mockImplementation((args) => {
      const toolExecute = args.tools?.echo_tool?.execute;
      if (!toolExecute) throw new Error("echo_tool execute was not registered");
      const interrupted = toolExecute(
        { text: "x" },
        { toolCallId: "call_int" },
      ).then(() => {
        throw new Error("aborted");
      });
      return {
        text: interrupted,
        totalUsage: interrupted,
        steps: interrupted,
        finishReason: interrupted,
      };
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

    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("interrupted_by_can_use_tool");
    expect(result.text).toContain("commit_guard blocked git commit");
  });
});
