import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";

const generateContentStreamMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();
const getToolEffectMock = vi.fn();
const confirmActionMock = vi.fn();
const enqueueApprovalMock = vi.fn();
const approvalQueueMock = {
  enqueue: (...args: Parameters<ApprovalQueue["enqueue"]>) =>
    enqueueApprovalMock(...args),
} as ApprovalQueue;

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(this: unknown) {
    (this as { models: unknown }).models = {
      generateContentStream: (...args: unknown[]) =>
        generateContentStreamMock(...args),
    };
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
  getToolEffect: (...args: unknown[]) => getToolEffectMock(...args),
}));

vi.mock("#core/util/confirm.js", () => ({
  confirmAction: (...args: unknown[]) => confirmActionMock(...args),
}));

vi.mock("#core/daemon/approval-queue.js", () => ({
  getApprovalQueue: () => ({
    enqueue: (...args: unknown[]) => enqueueApprovalMock(...args),
  }),
}));

vi.mock("#core/config/secrets.js", () => ({
  maskKnownSecretValues: (text: string) => text,
}));

import { geminiAgentHarness } from "./adapter.js";

const TEST_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text",
  input_schema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

type GenerateContentArgs = {
  contents: Array<{
    parts: Array<{
      functionResponse?: { response: Record<string, unknown> };
    }>;
  }>;
};

function makeStream(
  chunks: ReadonlyArray<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

function queueToolCallThenStop(
  id: string,
  input: Record<string, unknown>,
): void {
  generateContentStreamMock
    .mockResolvedValueOnce(
      makeStream([
        {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      id,
                      name: "echo_tool",
                      args: input,
                    },
                  },
                ],
              },
            },
          ],
        },
      ]),
    )
    .mockResolvedValueOnce(
      makeStream([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "done" }] },
              finishReason: "STOP",
            },
          ],
        },
      ]),
    );
}

function lastToolResponse(): Record<string, unknown> {
  const call = generateContentStreamMock.mock.calls[1]?.[0] as
    | GenerateContentArgs
    | undefined;
  const response = call?.contents[2]?.parts[0]?.functionResponse?.response;
  if (!response) throw new Error("Gemini follow-up tool response was not found");
  return response;
}

beforeEach(() => {
  generateContentStreamMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getToolEffectMock.mockReset();
  confirmActionMock.mockReset();
  enqueueApprovalMock.mockReset();
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  getToolEffectMock.mockReturnValue({
    kind: "destructive",
    scope: "local-fs",
    idempotent: false,
    openWorld: false,
  });
  confirmActionMock.mockResolvedValue(true);
  enqueueApprovalMock.mockReturnValue({ id: "approval-gemini" });
});

describe("geminiAgentHarness — permission policy", () => {
  it("blocks a dangerous tool under a deny policy through the shared runner", async () => {
    queueToolCallThenStop("call_deny", { text: "delete" });

    await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      guardrailsConfig: {
        policies: { safe: "allow", moderate: "allow", dangerous: "deny" },
      },
    });

    expect(executeToolMock).not.toHaveBeenCalled();
    expect(lastToolResponse().error).toContain("Blocked by guardrails");
  });

  it("requires confirmation for a dangerous tool before execution", async () => {
    confirmActionMock.mockResolvedValue(false);
    queueToolCallThenStop("call_confirm", { text: "delete" });

    await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      guardrailsConfig: {
        policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
      },
    });

    expect(confirmActionMock).toHaveBeenCalledWith(
      expect.stringContaining("Allow echo_tool?"),
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(lastToolResponse().error).toContain("requires confirmation");
  });

  it("queues a dangerous supervised call with its session identity", async () => {
    queueToolCallThenStop("call_queue", { text: "delete" });

    await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      autonomyMode: "supervised",
      approvalQueue: approvalQueueMock,
      sessionContext: {
        sessionId: "gemini-session",
        scopeId: "scope-a",
        projectId: "scope-a",
      },
    });

    expect(enqueueApprovalMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "delete" },
      "dangerous",
      expect.any(String),
      "gemini-session",
      undefined,
      undefined,
      undefined,
      "gemini-session",
    );
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(lastToolResponse().error).toContain("approval-gemini");
  });

  it("uses client approval for a queued dangerous call before execution", async () => {
    queueToolCallThenStop("call_client", { text: "ship" });
    executeToolMock.mockResolvedValue({ content: "executed" });
    const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });

    await geminiAgentHarness.run({
      prompt: "go",
      model: "gemini-2.5-flash",
      effort: "xhigh",
      guardrailsConfig: {
        policies: { safe: "allow", moderate: "allow", dangerous: "queue" },
      },
      clientApprovalResolver,
      sessionContext: {
        sessionId: "gemini-client-session",
        scopeId: "scope-a",
        projectId: "scope-a",
      },
    });

    expect(clientApprovalResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call_client",
        toolName: "echo_tool",
        sessionId: "gemini-client-session",
      }),
    );
    expect(enqueueApprovalMock).not.toHaveBeenCalled();
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(lastToolResponse()).toEqual({ output: "executed" });
  });
});
