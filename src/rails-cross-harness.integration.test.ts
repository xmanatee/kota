import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCanUseTool,
  KotaContentBlock,
  KotaMessage,
  KotaModelResponse,
  KotaTool,
  KotaToolResultBlock,
} from "#core/agent-harness/index.js";

const messagesCreateMock = vi.fn();
const messagesStreamMock = vi.fn();
const createModelClientMock = vi.fn();
const executeWithAgentSDKMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#modules/claude-agent-harness/executor.js", async (importActual) => {
  const actual = await importActual<
    typeof import("#modules/claude-agent-harness/executor.js")
  >();
  return {
    ...actual,
    executeWithAgentSDK: (...args: unknown[]) => executeWithAgentSDKMock(...args),
  };
});

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/adapter.js";
import { thinAgentHarness } from "#modules/thin-agent-harness/adapter.js";

const ECHO_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text.",
  input_schema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

const OTHER_TOOL: KotaTool = {
  name: "other_tool",
  description: "Second tool used by allowedTools tests.",
  input_schema: { type: "object", properties: {} },
};

type StreamSnapshot = {
  tools: readonly KotaTool[] | undefined;
  messages: KotaMessage[];
};

const streamSnapshots: StreamSnapshot[] = [];
const streamQueue: ReturnType<typeof makeStubStream>[] = [];

function makeStubStream(opts: {
  textChunks?: string[];
  final: {
    id: string;
    content: KotaContentBlock[];
    stop_reason?: KotaModelResponse["stop_reason"];
  };
}) {
  return {
    on(event: "text" | "thinking", cb: (delta: string) => void) {
      if (event === "text" && opts.textChunks) {
        for (const chunk of opts.textChunks) cb(chunk);
      }
      return this;
    },
    finalMessage: async (): Promise<KotaModelResponse> => ({
      id: opts.final.id,
      role: "assistant",
      model: "stub-model",
      content: opts.final.content,
      stop_reason: opts.final.stop_reason ?? "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    }),
  };
}

function queueToolUseTurn(
  callId: string,
  name: string,
  input: Record<string, unknown>,
): void {
  streamQueue.push(
    makeStubStream({
      final: {
        id: `msg_${callId}`,
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: callId, name, input } as KotaContentBlock,
        ],
      },
    }),
  );
}

function queueEndTurn(text = "ok"): void {
  streamQueue.push(
    makeStubStream({
      final: {
        id: "msg_end",
        stop_reason: "end_turn",
        content: [
          { type: "text", text, citations: null } as unknown as KotaContentBlock,
        ],
      },
    }),
  );
}

beforeEach(() => {
  messagesCreateMock.mockReset();
  messagesStreamMock.mockReset();
  createModelClientMock.mockReset();
  executeWithAgentSDKMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  streamSnapshots.length = 0;
  streamQueue.length = 0;

  createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
    client: { messages: { create: messagesCreateMock, stream: messagesStreamMock } },
    model,
    providerName: "stub",
  }));

  messagesStreamMock.mockImplementation(
    (params: { tools?: readonly KotaTool[]; messages: KotaMessage[] }) => {
      streamSnapshots.push({
        tools: params.tools ? [...params.tools] : undefined,
        messages: JSON.parse(JSON.stringify(params.messages)) as KotaMessage[],
      });
      const next = streamQueue.shift();
      if (!next) throw new Error("messagesStreamMock: no scripted return value");
      return next;
    },
  );

  messagesCreateMock.mockResolvedValue({
    id: "msg_thin",
    content: [{ type: "text", text: "thin-out" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  executeWithAgentSDKMock.mockResolvedValue({
    text: "claude-out",
    streamedText: "claude-out",
    turns: 1,
    isError: false,
  });

  getAllToolsMock.mockReturnValue([ECHO_TOOL, OTHER_TOOL]);
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Cross-harness parity guard for the agent-harness rails contract declared in
 * `src/core/agent-harness/AGENTS.md`: every registered adapter must honor
 * `canUseTool`, `allowedTools`, and `disallowedTools`. The autonomy module's
 * prompt-hierarchy contract and the `createAgentCommitGuard` /
 * `createDaemonHostControlGuard` cascade rely on this — a regression in any
 * adapter would silently strip a load-bearing safety rail.
 *
 * `thin` has no tool loop, so its rail-honoring contract is to *fail loudly*
 * at the boundary instead of silently coercing. The other two adapters route
 * the denial back to the agent through their native mechanism: openai-tools
 * pushes an `is_error: true` `tool_result` and continues the loop; claude-
 * agent-sdk forwards the rail option unchanged to the SDK, which fires the
 * callback and routes the deny back through its own permission machinery.
 */
describe("rails parity: canUseTool denial routes back to the agent without aborting the session", () => {
  it("openai-tools — feeds the deny tool_result back into the loop and continues", async () => {
    queueToolUseTurn("c1", "echo_tool", { text: "secret" });
    queueEndTurn("recovered");
    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "blocked by policy",
    });

    const result = await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      canUseTool,
    });

    expect(canUseTool).toHaveBeenCalledTimes(1);
    expect(executeToolMock).not.toHaveBeenCalled();

    const followupBlocks = streamSnapshots[1].messages[2].content as KotaToolResultBlock[];
    expect(followupBlocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "c1",
      is_error: true,
      content: "blocked by policy",
    });
    expect(result.isError).toBe(false);
    expect(result.subtype).toBeUndefined();
  });

  it("claude-agent-sdk — forwards canUseTool through to the SDK executor unchanged", async () => {
    const canUseTool: AgentCanUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "blocked by policy",
    });

    await claudeAgentHarness.run({
      prompt: "go",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
      canUseTool,
    });

    expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(1);
    const passedOptions = executeWithAgentSDKMock.mock.calls[0][1] as {
      canUseTool: AgentCanUseTool;
    };
    expect(passedOptions.canUseTool).toBe(canUseTool);
  });

  it("thin — rejects loudly because there is no tool loop to gate", async () => {
    await expect(
      thinAgentHarness.run({
        prompt: "go",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        systemPrompt: "be terse",
        canUseTool: async () => ({ behavior: "deny", message: "blocked" }),
      }),
    ).rejects.toThrow(/canUseTool/);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });
});

describe("rails parity: allowedTools restricts the catalog and surfaces a denial signal for off-list calls", () => {
  it("openai-tools — exposes only allowedTools and routes off-list calls back as is_error tool_result", async () => {
    queueToolUseTurn("a1", "other_tool", {});
    queueEndTurn("after-allow-deny");

    const result = await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      allowedTools: ["echo_tool"],
    });

    const sentTools = streamSnapshots[0].tools as KotaTool[];
    expect(sentTools.map((t) => t.name)).toEqual(["echo_tool"]);

    const followupBlocks = streamSnapshots[1].messages[2].content as KotaToolResultBlock[];
    expect(followupBlocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "a1",
      is_error: true,
      content: 'Tool "other_tool" is not in allowedTools and cannot run.',
    });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
  });

  it("claude-agent-sdk — forwards allowedTools through to the SDK executor unchanged", async () => {
    await claudeAgentHarness.run({
      prompt: "go",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
      allowedTools: ["Read", "Edit"],
    });

    const passedOptions = executeWithAgentSDKMock.mock.calls[0][1] as {
      allowedTools: string[];
    };
    expect(passedOptions.allowedTools).toEqual(["Read", "Edit"]);
  });

  it("thin — rejects loudly because allowedTools has no tool loop to restrict", async () => {
    await expect(
      thinAgentHarness.run({
        prompt: "go",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        systemPrompt: "be terse",
        allowedTools: ["Read"],
      }),
    ).rejects.toThrow(/text-only/);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });
});

describe("rails parity: disallowedTools blocks the named tools regardless of catalog overlap", () => {
  it("openai-tools — denies a disallowed tool call and pushes the denial back into the loop", async () => {
    queueToolUseTurn("d1", "echo_tool", { text: "x" });
    queueEndTurn("after-deny");

    const result = await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      disallowedTools: ["echo_tool"],
    });

    expect(executeToolMock).not.toHaveBeenCalled();
    const followupBlocks = streamSnapshots[1].messages[2].content as KotaToolResultBlock[];
    expect(followupBlocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "d1",
      is_error: true,
      content: 'Tool "echo_tool" is in disallowedTools and cannot run.',
    });
    expect(result.isError).toBe(false);
    // The catalog must not contain a tool that is disallowed: even allow-list-
    // overlap with a deny-list entry does not let it through.
    expect((streamSnapshots[0].tools ?? []).map((t) => t.name)).not.toContain(
      "echo_tool",
    );
  });

  it("claude-agent-sdk — forwards disallowedTools through to the SDK executor unchanged", async () => {
    await claudeAgentHarness.run({
      prompt: "go",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
      disallowedTools: ["Bash"],
    });

    const passedOptions = executeWithAgentSDKMock.mock.calls[0][1] as {
      disallowedTools: string[];
    };
    expect(passedOptions.disallowedTools).toEqual(["Bash"]);
  });

  it("thin — rejects loudly because disallowedTools has no tool loop to filter", async () => {
    await expect(
      thinAgentHarness.run({
        prompt: "go",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        systemPrompt: "be terse",
        disallowedTools: ["Bash"],
      }),
    ).rejects.toThrow(/text-only/);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });
});
