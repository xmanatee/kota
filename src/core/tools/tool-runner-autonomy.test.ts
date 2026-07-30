import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmConfig, dangerousAssessment, mockAssess, mockConfirmAction, mockExecuteTool, mockGetApprovalQueue, mockTruncate, runOptions, safeAssessment, toolBlock } from "./runner-test-support.js";
import { executeToolCalls } from "./tool-runner.js";

describe("autonomy-mode gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTruncate.mockImplementation((text: string) => text);
    mockGetApprovalQueue.mockReturnValue({ enqueue: vi.fn(() => ({ id: "abc123" })) } as any);
  });

  it("passive mode denies a non-safe tool before policy resolution", async () => {
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "touch x" })],
      runOptions({ autonomyMode: "passive" }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("passive");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("passive mode still allows safe tools to run", async () => {
    mockAssess.mockReturnValue(safeAssessment);
    mockExecuteTool.mockResolvedValue({ content: "ok" });

    const results = await executeToolCalls(
      [toolBlock("file_read", { path: "/a.txt" })],
      runOptions({ autonomyMode: "passive" }),
    );

    expect(results[0].is_error).toBeUndefined();
    expect(mockExecuteTool).toHaveBeenCalled();
  });

  it("supervised mode queues a non-safe tool through the approval queue", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "touch x" })],
      runOptions({ autonomyMode: "supervised", sessionId: "s-1" }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(results[0].content).toContain("approval CLI");
    expect(results[0].content).not.toContain("Use the approval tool");
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("treats client allow as the supervised approval boundary when policy allows", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised-client" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "allow" as const });
    mockConfirmAction.mockResolvedValue(false);
    mockExecuteTool.mockResolvedValue({ content: "executed after ACP allow" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy" })],
      runOptions({
        autonomyMode: "supervised",
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "allow" } },
        sessionId: "s-acp",
        clientApprovalResolver,
      }),
    );

    expect(results[0]).toMatchObject({ content: "executed after ACP allow" });
    expect(clientApprovalResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "shell",
        reason: expect.stringContaining('autonomy mode "supervised"'),
        sessionId: "s-acp",
      }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockConfirmAction).not.toHaveBeenCalled();
    expect(mockExecuteTool).toHaveBeenCalled();
  });

  it("does not let supervised client approval bypass a deny policy", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised-deny" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue({ ...dangerousAssessment, policy: "deny" as const });
    mockExecuteTool.mockResolvedValue({ content: "should not run" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy" })],
      runOptions({
        autonomyMode: "supervised",
        guardrailsConfig: { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } },
        sessionId: "s-acp-deny",
        clientApprovalResolver,
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Blocked by guardrails");
    expect(clientApprovalResolver).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockConfirmAction).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("still enforces confirm policy after supervised client approval", async () => {
    const mockEnqueue = vi.fn(() => ({ id: "q-supervised-confirm" }));
    mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as any);
    mockAssess.mockReturnValue(dangerousAssessment);
    mockConfirmAction.mockResolvedValue(false);
    mockExecuteTool.mockResolvedValue({ content: "should not run" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "deploy" })],
      runOptions({
        autonomyMode: "supervised",
        guardrailsConfig: confirmConfig,
        sessionId: "s-acp-confirm",
        clientApprovalResolver,
      }),
    );

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("requires confirmation");
    expect(clientApprovalResolver).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockConfirmAction).toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("autonomous mode falls through to policy resolution", async () => {
    mockAssess.mockReturnValue({
      tool: "shell",
      risk: "moderate",
      policy: "allow",
      reason: "writes a file",
    });
    mockExecuteTool.mockResolvedValue({ content: "ok" });

    const results = await executeToolCalls(
      [toolBlock("shell", { command: "touch x" })],
      runOptions({ autonomyMode: "autonomous" }),
    );

    expect(results[0].is_error).toBeUndefined();
    expect(mockExecuteTool).toHaveBeenCalled();
  });
});
