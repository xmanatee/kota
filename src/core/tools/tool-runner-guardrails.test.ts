import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmConfig, dangerousAssessment, mockAssess, mockConfirmAction, mockExecuteTool, mockGetApprovalQueue, mockTruncate, runOptions, toolBlock, tryEmitMock } from "./runner-test-support.js";
import { executeToolCalls, ToolApprovalCancelledError } from "./tool-runner.js";

describe("guardrails confirm gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTruncate.mockImplementation((text: string) => text);
    mockGetApprovalQueue.mockReturnValue({ enqueue: vi.fn(() => ({ id: "abc123" })) } as any);
  });

  it("blocks a destructive tool call when user rejects confirmation", async () => {
    mockAssess.mockReturnValue(dangerousAssessment);
    mockConfirmAction.mockResolvedValue(false);

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "git reset --hard HEAD~1" })],
      runOptions({ guardrailsConfig: confirmConfig }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("requires confirmation");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("executes a destructive tool when user approves confirmation", async () => {
    mockAssess.mockReturnValue(dangerousAssessment);
    mockConfirmAction.mockResolvedValue(true);
    mockExecuteTool.mockResolvedValue({ content: "reset done" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "git reset --hard HEAD~1" })],
      runOptions({ guardrailsConfig: confirmConfig }),
    );

    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).toBe("reset done");
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "shell",
      { command: "git reset --hard HEAD~1" },
      expect.objectContaining({
        approvalQueue: expect.any(Object),
        toolUseId: "t1",
      }),
    );
  });

  it("blocks a tool call when policy is deny", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Blocked by guardrails");
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockConfirmAction).not.toHaveBeenCalled();
  });

  it("queues a tool call when policy is queue", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q1" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /tmp/old" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        sessionId: "session-1",
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(results[0].content).toContain("q1");
    expect(results[0].content).toContain("approval CLI");
    expect(results[0].content).not.toContain("Use the approval tool");
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(
      "shell",
      { command: "rm -rf /tmp/old" },
      "dangerous",
      "destructive command pattern detected",
      "session-1",
      undefined,
      undefined,
      undefined,
      "session-1",
    );
  });

  it("uses client approval instead of enqueueing when queue policy is allowed", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-client" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });
    mockExecuteTool.mockResolvedValue({ content: "executed" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy", API_KEY: "secret-token" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        sessionId: "session-client",
        clientApprovalResolver,
      }),
    );

    expect(results[0]).toMatchObject({ content: "executed" });
    expect(clientApprovalResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "t1",
        toolUseId: "t1",
        toolName: "shell",
        input: { command: "deploy", API_KEY: "secret-token" },
        risk: "dangerous",
        reason: "destructive command pattern detected",
        sessionId: "session-client",
      }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockExecuteTool).toHaveBeenCalled();
  });

  it("blocks a queue-policy tool when client approval denies it", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-client-deny" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });
    const clientApprovalResolver = vi.fn().mockResolvedValue({
      outcome: "deny",
      message: "operator rejected",
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /tmp/old" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        clientApprovalResolver,
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("operator rejected");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("throws when client approval reports cancellation", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });
    const clientApprovalResolver = vi.fn().mockResolvedValue({
      outcome: "cancelled",
      message: "prompt cancelled",
    });

    await expect(
      executeToolCalls(
        [toolBlock("shell", { command: "rm -rf /tmp/old" })],
        runOptions({
          guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
          clientApprovalResolver,
        }),
      ),
    ).rejects.toThrow(ToolApprovalCancelledError);
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("emits guardrail event to transport", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });
    const transport = { emit: vi.fn() };

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      runOptions({
        transport: transport as never,
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
      }),
    );

    expect(transport.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "guardrail",
        tool: "shell",
        risk: "dangerous",
        policy: "deny",
      }),
    );
  });

  it("passes conversation context to enqueue when messages provided", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q2" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "queue" as const });

    const messages = [
      { role: "user" as const, content: "Please delete old temp files" },
      { role: "assistant" as const, content: "I will delete files in /tmp/old to free space" },
    ];

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /tmp/old" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "queue" } },
        sessionId: "session-2",
        messages,
      }),
    );

    const enqueueArgs: unknown[] = mockEnqueue.mock.calls[0] as unknown[];
    const contextArg = enqueueArgs[7];
    expect(typeof contextArg).toBe("string");
    expect(contextArg as string).toContain("Please delete old temp files");
    expect(contextArg as string).toContain("delete files in /tmp/old");
  });

  it("emits guardrail.assessed event with assessment and sessionId", async () => {
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });

    await executeToolCalls(
      [toolBlock("shell", { command: "rm -rf /" })],
      runOptions({
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
        sessionId: "session-42",
      }),
    );

    expect(tryEmitMock).toHaveBeenCalledWith(
      "guardrail.assessed",
      expect.objectContaining({ tool: "shell", risk: "dangerous", policy: "deny", session: "session-42" }),
    );
  });
});
