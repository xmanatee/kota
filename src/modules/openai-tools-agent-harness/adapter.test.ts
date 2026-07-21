import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import type { KotaContentBlock, KotaMessage, KotaModelResponse, KotaTool, KotaToolResultBlock } from "#core/agent-harness/message-protocol.js";

const messagesStreamMock = vi.fn();
const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();
const getToolEffectMock = vi.fn();
const getSecretStoreMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
  getToolEffect: (...args: unknown[]) => getToolEffectMock(...args),
}));

vi.mock("#core/config/secrets.js", () => ({
  getSecretStore: () => getSecretStoreMock(),
}));

import { runFileRead } from "#modules/filesystem/file-read.js";
import {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  openaiToolsAgentHarness,
} from "./adapter.js";

type StubFinalMessage = Pick<KotaModelResponse, "id" | "content" | "stop_reason"> & {
  usage?: { input_tokens: number; output_tokens: number };
};

function makeStubStream(opts: {
  textChunks?: string[];
  thinkingChunks?: string[];
  final: StubFinalMessage;
}) {
  return {
    on(event: "text" | "thinking", cb: (delta: string) => void) {
      if (event === "text" && opts.textChunks) {
        for (const chunk of opts.textChunks) cb(chunk);
      }
      if (event === "thinking" && opts.thinkingChunks) {
        for (const chunk of opts.thinkingChunks) cb(chunk);
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
        input_tokens: opts.final.usage?.input_tokens ?? 0,
        output_tokens: opts.final.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    }),
  };
}

const TEST_TOOL: KotaTool = {
  name: "echo_tool",
  description: "Echo the provided text",
  input_schema: {
    type: "object" as const,
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
};

const FILE_READ_TOOL: KotaTool = {
  name: "file_read",
  description: "Read a file from the working directory",
  input_schema: {
    type: "object" as const,
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

/**
 * Per-stream-call snapshot of `messages` taken at invocation time. Vitest's
 * `mock.calls` stores arg references, so the loop's mutation of the running
 * `messages` array would otherwise hide what each turn actually sent.
 */
type StreamCallSnapshot = {
  system: string | undefined;
  maxTokens: number;
  tools: readonly KotaTool[] | undefined;
  messages: KotaMessage[];
};

const streamCallSnapshots: StreamCallSnapshot[] = [];
const streamReturnQueue: ReturnType<typeof makeStubStream>[] = [];

function queueStream(stream: ReturnType<typeof makeStubStream>): void {
  streamReturnQueue.push(stream);
}

beforeEach(() => {
  messagesStreamMock.mockReset();
  messagesCreateMock.mockReset();
  createModelClientMock.mockReset();
  executeToolMock.mockReset();
  getAllToolsMock.mockReset();
  getToolEffectMock.mockReset();
  getSecretStoreMock.mockReset();
  streamCallSnapshots.length = 0;
  streamReturnQueue.length = 0;
  messagesStreamMock.mockImplementation(
    (params: {
      system?: string;
      max_tokens: number;
      tools?: readonly KotaTool[];
      messages: KotaMessage[];
    }) => {
      streamCallSnapshots.push({
        system: params.system,
        maxTokens: params.max_tokens,
        tools: params.tools ? [...params.tools] : undefined,
        messages: JSON.parse(JSON.stringify(params.messages)) as KotaMessage[],
      });
      const next = streamReturnQueue.shift();
      if (!next) throw new Error("messagesStreamMock: no scripted return value");
      return next;
    },
  );
  createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
    client: { messages: { create: messagesCreateMock, stream: messagesStreamMock } },
    model,
    providerName: "openai",
  }));
  getAllToolsMock.mockReturnValue([TEST_TOOL]);
  getToolEffectMock.mockReturnValue({
    kind: "read",
    scope: "local-fs",
    idempotent: true,
    openWorld: false,
  });
  getSecretStoreMock.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("openaiToolsAgentHarness — registration", () => {
  it("registers under the openai-tools name and supports multi-turn", () => {
    expect(openaiToolsAgentHarness.name).toBe(OPENAI_TOOLS_AGENT_HARNESS_NAME);
    expect(openaiToolsAgentHarness.name).toBe("openai-tools");
    expect(openaiToolsAgentHarness.supportsMultiTurn).toBe(true);
    expect(openaiToolsAgentHarness.supportedHookKinds).toEqual([
      "preRun",
      "postRun",
    ]);
    expect(openaiToolsAgentHarness.emitsAgentMessageStream).toBe(true);
    expect(openaiToolsAgentHarness.unsupportedRunOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          option: "thinkingEnabled/thinkingBudget",
          runOption: "thinking",
        }),
      ]),
    );
    expect(openaiToolsAgentHarness.unsupportedRunOptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          option: "onMessage",
          runOption: "onMessage",
        }),
      ]),
    );
  });
});

describe("openaiToolsAgentHarness — happy path tool loop", () => {
  it("dispatches a tool call and composes a follow-up turn into the final response", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "echo_tool",
              input: { text: "hello" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 7, output_tokens: 3 },
        },
      }),
    );
    queueStream(
      makeStubStream({
        textChunks: ["all done"],
        final: {
          id: "msg_2",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "all done", citations: null } as KotaContentBlock,
          ],
          usage: { input_tokens: 11, output_tokens: 4 },
        },
      }),
    );

    executeToolMock.mockResolvedValue({ content: "echo: hello" });

    const writer = { write: vi.fn().mockReturnValue(true) };
    const result = await openaiToolsAgentHarness.run(
      {
        prompt: "please echo",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        systemPrompt: "be brief",
      },
      writer,
    );

    expect(streamCallSnapshots).toHaveLength(2);
    expect(streamCallSnapshots[0].system).toBe("be brief");
    expect(streamCallSnapshots[0].maxTokens).toBe(128_000);
    expect(streamCallSnapshots[0].tools).toEqual([TEST_TOOL]);
    expect(streamCallSnapshots[0].messages).toEqual([
      { role: "user", content: "please echo" },
    ]);

    expect(streamCallSnapshots[1].messages).toHaveLength(3);
    const toolResultMsg = streamCallSnapshots[1].messages[2];
    expect(toolResultMsg.role).toBe("user");
    expect(toolResultMsg.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "call_1",
        content: "echo: hello",
        is_error: false,
      },
    ]);

    expect(executeToolMock).toHaveBeenCalledWith(
      "echo_tool",
      { text: "hello" },
      expect.objectContaining({ toolUseId: "call_1" }),
    );
    expect(writer.write).toHaveBeenCalledWith("all done");
    expect(result).toMatchObject({
      text: "all done",
      streamedText: "all done",
      sessionId: "msg_2",
      turns: 2,
      inputTokens: 18,
      outputTokens: 7,
      isError: false,
    });
  });

  it("masks registered secrets before feeding raw tool results into the next model turn", async () => {
    getSecretStoreMock.mockReturnValue({
      mask: (text: string) => text.replaceAll("agent-secret-token", "<secret:API_TOKEN>"),
    });

    queueStream(
      makeStubStream({
        final: {
          id: "msg_mask_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_mask",
              name: "echo_tool",
              input: { text: "show token" },
            } as KotaContentBlock,
          ],
        },
      }),
    );
    queueStream(
      makeStubStream({
        final: {
          id: "msg_mask_2",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "done", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );

    executeToolMock.mockResolvedValue({ content: "token=agent-secret-token" });

    await openaiToolsAgentHarness.run({
      prompt: "read token",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
    });

    const followUpTurn = JSON.stringify(streamCallSnapshots[1].messages[2]);
    expect(followUpTurn).toContain("<secret:API_TOKEN>");
    expect(followUpTurn).not.toContain("agent-secret-token");
  });

  it("emits structured message frames for text, reasoning, tools, status, and result", async () => {
    queueStream(
      makeStubStream({
        textChunks: ["I need a lookup."],
        thinkingChunks: ["[OpenAI-compatible reasoning omitted by evidence policy]"],
        final: {
          id: "msg_frames_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "text",
              text: "I need a lookup.",
            },
            {
              type: "tool_use",
              id: "call_frames",
              name: "echo_tool",
              input: { text: "hello" },
            },
          ] as KotaContentBlock[],
          usage: { input_tokens: 6, output_tokens: 2 },
        },
      }),
    );
    queueStream(
      makeStubStream({
        textChunks: ["done"],
        final: {
          id: "msg_frames_2",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "done", citations: null } as KotaContentBlock,
          ],
          usage: { input_tokens: 7, output_tokens: 3 },
        },
      }),
    );

    executeToolMock.mockResolvedValue({
      content: "summary",
      blocks: [
        { type: "text", text: "visible block", _meta: { trace: "block-secret" } },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "abc" },
        },
      ],
      structuredContent: { answer: 42 },
      _meta: { trace: "result-secret" },
    });

    const frames: KotaAgentMessage[] = [];
    const result = await openaiToolsAgentHarness.run({
      prompt: "please echo",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      onMessage: (message) => {
        frames.push(message);
      },
    });

    expect(result.isError).toBe(false);
    expect(frames.map((frame) => frame.type)).toEqual([
      "status",
      "text",
      "thinking",
      "tool_call",
      "tool_result",
      "status",
      "text",
      "result",
    ]);
    expect(frames).toContainEqual({
      type: "tool_call",
      toolUseId: "call_frames",
      toolName: "echo_tool",
      input: { text: "hello" },
      sessionId: "msg_frames_1",
    });
    const toolResultFrame = frames.find(
      (frame): frame is Extract<KotaAgentMessage, { type: "tool_result" }> =>
        frame.type === "tool_result",
    );
    expect(toolResultFrame).toBeDefined();
    expect(toolResultFrame?.toolUseId).toBe("call_frames");
    expect(toolResultFrame?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "call_frames",
        content: [
          { type: "text", text: "visible block", _meta: { trace: "block-secret" } },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "abc" },
          },
        ],
        structuredContent: { answer: 42 },
        _meta: { trace: "result-secret" },
        is_error: false,
      },
    ]);
    expect(frames.at(-1)).toMatchObject({
      type: "result",
      isError: false,
      text: "done",
      numTurns: 2,
      inputTokens: 13,
      outputTokens: 5,
      sessionId: "msg_frames_2",
    });
  });

  it("does not expose project secrets or env files through file_read tool results", async () => {
    getAllToolsMock.mockReturnValue([FILE_READ_TOOL]);

    queueStream(
      makeStubStream({
        final: {
          id: "msg_file_read_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "read_secret_store",
              name: "file_read",
              input: { path: ".kota/secrets.json" },
            },
            {
              type: "tool_use",
              id: "read_env_file",
              name: "file_read",
              input: { path: ".env" },
            },
          ] as KotaContentBlock[],
        },
      }),
    );
    queueStream(
      makeStubStream({
        final: {
          id: "msg_file_read_2",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "blocked", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );

    const originalCwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), "openai-tools-file-read-protected-"));
    try {
      mkdirSync(join(projectDir, ".kota"), { recursive: true });
      writeFileSync(
        join(projectDir, ".kota", "secrets.json"),
        '{"API_KEY":"file-backed-secret"}\n',
      );
      writeFileSync(join(projectDir, ".env"), "API_KEY=env-file-secret\n");
      process.chdir(projectDir);

      executeToolMock.mockImplementation(async (name: string, input: Record<string, unknown>) => {
        if (name !== "file_read") throw new Error(`unexpected tool call: ${name}`);
        return runFileRead(input);
      });

      await openaiToolsAgentHarness.run({
        prompt: "read credentials",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        cwd: projectDir,
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(projectDir, { recursive: true, force: true });
    }

    const followUpTurn = JSON.stringify(streamCallSnapshots[1].messages[2]);
    expect(followUpTurn).toContain("protected project runtime credential");
    expect(followUpTurn).not.toContain("file-backed-secret");
    expect(followUpTurn).not.toContain("env-file-secret");
  });
});

describe("openaiToolsAgentHarness — guardrails", () => {
  it("denies a tool through canUseTool, feeds the denial back to the model, and ends cleanly", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_deny_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_deny",
              name: "echo_tool",
              input: { text: "secret" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 4, output_tokens: 2 },
        },
      }),
    );
    queueStream(
      makeStubStream({
        final: {
          id: "msg_deny_2",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "I cannot proceed", citations: null } as KotaContentBlock,
          ],
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      }),
    );

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "echo_tool blocked by policy",
    });

    const result = await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      canUseTool,
    });

    expect(canUseTool).toHaveBeenCalledWith(
      "echo_tool",
      { text: "secret" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(executeToolMock).not.toHaveBeenCalled();

    expect(streamCallSnapshots[1].messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_deny",
          content: "echo_tool blocked by policy",
          is_error: true,
        },
      ],
    });

    expect(result).toMatchObject({
      text: "I cannot proceed",
      turns: 2,
      isError: false,
    });
  });

  it("ends the loop with isError when canUseTool deny carries interrupt: true (commit-guard / daemon-control style)", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_int_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_int",
              name: "echo_tool",
              input: { text: "x" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      }),
    );

    const canUseTool = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: "commit_guard blocked git commit",
      interrupt: true,
    });

    const result = await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      canUseTool,
    });

    expect(executeToolMock).not.toHaveBeenCalled();
    expect(streamCallSnapshots).toHaveLength(1);
    expect(result).toMatchObject({
      isError: true,
      subtype: "interrupted_by_can_use_tool",
      turns: 1,
    });
    expect(result.text).toContain("commit_guard blocked git commit");
  });

  it("denies a tool listed in disallowedTools without invoking canUseTool", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_dis_1",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_dis",
              name: "echo_tool",
              input: { text: "x" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        },
      }),
    );
    queueStream(
      makeStubStream({
        final: {
          id: "msg_dis_2",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        },
      }),
    );
    const canUseTool = vi.fn();

    await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      disallowedTools: ["echo_tool"],
      canUseTool,
    });

    expect(canUseTool).not.toHaveBeenCalled();
    expect(executeToolMock).not.toHaveBeenCalled();
    const toolResultBlock = (streamCallSnapshots[1].messages[2].content as KotaToolResultBlock[])[0];
    expect(toolResultBlock).toMatchObject({
      type: "tool_result",
      tool_use_id: "call_dis",
      is_error: true,
      content: 'Tool "echo_tool" is in disallowedTools and cannot run.',
    });
    expect(streamCallSnapshots[0].tools ?? []).toEqual([]);
  });

  it("only exposes allowedTools to the model and rejects tool calls outside that set", async () => {
    const otherTool: KotaTool = {
      name: "other_tool",
      description: "Other",
      input_schema: { type: "object" as const, properties: {} },
    };
    getAllToolsMock.mockReturnValue([TEST_TOOL, otherTool]);

    queueStream(
      makeStubStream({
        final: {
          id: "msg_allow_1",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
    );

    await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      allowedTools: ["echo_tool"],
    });

    const sentTools = streamCallSnapshots[0].tools as KotaTool[];
    expect(sentTools.map((t) => t.name)).toEqual(["echo_tool"]);
  });
});

describe("openaiToolsAgentHarness — protocol errors", () => {
  it("throws loudly when the model returns malformed JSON arguments (`_raw` fallback marker)", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_malformed",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_bad",
              name: "echo_tool",
              input: { _raw: "{not json" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        },
      }),
    );

    await expect(
      openaiToolsAgentHarness.run({
        prompt: "go",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/malformed JSON arguments/);
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("throws loudly when the model returns a tool_use with an empty name", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_noname",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "call_x",
              name: "",
              input: {},
            } as KotaContentBlock,
          ],
        },
      }),
    );

    await expect(
      openaiToolsAgentHarness.run({
        prompt: "go",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
      }),
    ).rejects.toThrow(/missing tool name/);
  });
});

describe("openaiToolsAgentHarness — unsupported options rejection", () => {
  it("accepts caller mcpServers and proceeds through the model surface", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_mcp_boundary",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );

    await openaiToolsAgentHarness.run({
      prompt: "x",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      mcpServers: {},
    });

    expect(messagesStreamMock).toHaveBeenCalledTimes(1);
  });

  it("accepts supervised autonomy mode", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_supervised_boundary",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );

    await openaiToolsAgentHarness.run({
      prompt: "x",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      autonomyMode: "supervised",
    });

    expect(messagesStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects per-step harness overrides (no validateStepOptions)", async () => {
    await expect(
      openaiToolsAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        harnessOverrides: { foo: "bar" },
      }),
    ).rejects.toThrow(/harnessOptions/);
  });

  it("rejects extended thinking", async () => {
    await expect(
      openaiToolsAgentHarness.run({
        prompt: "x",
        model: "openai/gpt-5.6-luna",
        effort: "xhigh",
        thinkingEnabled: true,
      }),
    ).rejects.toThrow(/extended thinking/);
  });

  it("forwards the portable system-prompt string straight to the model client", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_system_string",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
    );
    await openaiToolsAgentHarness.run({
      prompt: "x",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      systemPrompt: "## Project context\n\nProject is named KOTA.",
    });
    expect(streamCallSnapshots[0].system).toBe(
      "## Project context\n\nProject is named KOTA.",
    );
  });

  it("refuses to run without an explicit model", async () => {
    await expect(
      openaiToolsAgentHarness.run({ prompt: "x", effort: "xhigh" }),
    ).rejects.toThrow(/explicit model/);
  });
});

describe("openaiToolsAgentHarness — reasoning-effort passthrough", () => {
  it("forwards effort verbatim to the resolved ModelClient stream call", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_effort",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );
    await openaiToolsAgentHarness.run({
      prompt: "x",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
    });
    expect(messagesStreamMock.mock.calls[0][0]).toMatchObject({ effort: "xhigh" });
  });

  it("propagates a preset's missing-reasoning rejection from the underlying ModelClient", async () => {
    messagesStreamMock.mockImplementationOnce(() => {
      throw new Error(
        'Model preset "ollama" has no reasoning-effort mapping; effort="xhigh" cannot be honored. ' +
          "claude-agent-sdk",
      );
    });
    await expect(
      openaiToolsAgentHarness.run({
        prompt: "x",
        model: "ollama/llama3",
        modelOutputTokenLimits: { llama3: 4096 },
        effort: "xhigh",
      }),
    ).rejects.toThrow(/"ollama".*claude-agent-sdk/s);
  });
});

describe("openaiToolsAgentHarness — limits", () => {
  it("uses the selected model's resolved output-token budget", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_budget",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );

    await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-5.6-sol",
      effort: "xhigh",
    });

    expect(streamCallSnapshots[0]).toMatchObject({
      maxTokens: 128_000,
    });
  });

  it("fails before dispatch for an unknown model without an explicit limit", async () => {
    await expect(
      openaiToolsAgentHarness.run({
        prompt: "go",
        model: "openai/operator-model",
        effort: "xhigh",
      }),
    ).rejects.toThrow(
      /No output-token limit configured for model "openai\/operator-model"/,
    );
    expect(messagesStreamMock).not.toHaveBeenCalled();
  });

  it("uses an explicit operator limit for a custom model id", async () => {
    queueStream(
      makeStubStream({
        final: {
          id: "msg_custom_budget",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "ok", citations: null } as KotaContentBlock,
          ],
        },
      }),
    );

    await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/operator-model",
      modelOutputTokenLimits: { "operator-model": 7777 },
      effort: "xhigh",
    });

    expect(streamCallSnapshots[0]).toMatchObject({
      maxTokens: 7777,
    });
  });

  it("returns isError when maxTurns is reached without the model ending the turn", async () => {
    const looping = (id: string) =>
      makeStubStream({
        final: {
          id,
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: `${id}_call`,
              name: "echo_tool",
              input: { text: "again" },
            } as KotaContentBlock,
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
    queueStream(looping("loop_1"));
    queueStream(looping("loop_2"));
    executeToolMock.mockResolvedValue({ content: "echoed" });

    const result = await openaiToolsAgentHarness.run({
      prompt: "go",
      model: "openai/gpt-5.6-luna",
      effort: "xhigh",
      maxTurns: 2,
    });

    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("max_turns_reached");
    expect(result.turns).toBe(2);
    expect(streamCallSnapshots).toHaveLength(2);
  });
});
