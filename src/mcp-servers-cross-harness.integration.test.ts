import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarness,
  AgentHarnessRunOptions,
  AgentMcpServers,
} from "#core/agent-harness/index.js";

const messagesCreateMock = vi.fn();
const messagesStreamMock = vi.fn();
const createModelClientMock = vi.fn();
const executeWithAgentSDKMock = vi.fn();

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

// The openai-tools adapter calls `getAllTools()` to filter the tool catalog
// before streaming. The empty-mcpServers branch in this test reaches that path,
// so we stub the registry with an empty catalog rather than depend on real
// tool registry initialization order in this isolated test.
vi.mock("#core/tools/index.js", () => ({
  executeTool: vi.fn(),
  getAllTools: () => [],
}));

import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { KOTA_OWNER_QUESTIONS_MCP_SERVER } from "#modules/claude-agent-harness/kota-tools-mcp.js";
import { openaiToolsAgentHarness } from "#modules/openai-tools-agent-harness/adapter.js";
import { thinAgentHarness } from "#modules/thin-agent-harness/adapter.js";

beforeEach(() => {
  messagesCreateMock.mockReset();
  messagesStreamMock.mockReset();
  createModelClientMock.mockReset();
  executeWithAgentSDKMock.mockReset();

  createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
    client: { messages: { create: messagesCreateMock, stream: messagesStreamMock } },
    model,
    providerName: "stub",
  }));

  messagesCreateMock.mockResolvedValue({
    id: "msg_thin",
    role: "assistant",
    model: "stub-model",
    content: [{ type: "text", text: "thin-out" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  messagesStreamMock.mockReturnValue({
    on() {
      return this;
    },
    finalMessage: async () => ({
      id: "msg_openai",
      role: "assistant" as const,
      model: "stub-model",
      content: [{ type: "text" as const, text: "openai-out" }],
      stop_reason: "end_turn" as const,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  });

  executeWithAgentSDKMock.mockResolvedValue({
    text: "claude-out",
    streamedText: "claude-out",
    turns: 1,
    isError: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Cross-harness parity guard for the agent-harness `mcpServers` contract
 * declared in `src/core/agent-harness/AGENTS.md`. Every registered adapter
 * must honor `AgentHarnessRunOptions.mcpServers` per its declared contract:
 *
 * - **claude-agent-sdk** forwards a non-empty caller-supplied map through to
 *   `executeWithAgentSDK` unchanged when `askOwner` is unset, and merges the
 *   in-process owner-questions MCP server on top of the caller-supplied map
 *   when `askOwner` is set — *without* overwriting an existing entry under
 *   `KOTA_OWNER_QUESTIONS_MCP_SERVER`.
 * - **openai-tools** rejects non-empty `mcpServers` loudly at the boundary
 *   without entering the model client.
 * - **thin** rejects non-empty `mcpServers` loudly at the boundary without
 *   entering the model client.
 * - **Every adapter** treats the literal `{}` as "unset" — claude-agent-sdk
 *   forwards the empty map through, openai-tools and thin proceed past their
 *   rejection guard. This pins `Object.keys(...).length > 0` against a
 *   regression that would truthy-check the map itself.
 *
 * The owner-questions merge in particular is a real footgun: a regression
 * that overwrote caller-supplied servers would silently drop module-supplied
 * tool surfaces in the autonomy loop on every run with `askOwner` set.
 */

const SAMPLE_NON_EMPTY: AgentMcpServers = {
  foo: { type: "stdio", command: "bar" },
};

type AdapterCase = {
  name: string;
  harness: AgentHarness;
  baseOptions: () => AgentHarnessRunOptions;
  /** Adapter-specific contract for non-empty mcpServers (forward, reject, …). */
  assertNonEmptyContract(): Promise<void>;
  /** Verifies the literal `{}` is treated as "unset". */
  assertEmptyContract(): Promise<void>;
  /** Owner-questions merge contract — null where the adapter does not host MCP servers. */
  assertOwnerQuestionsMerge: (() => Promise<void>) | null;
};

const ADAPTERS: AdapterCase[] = [
  {
    name: "claude-agent-sdk",
    harness: claudeAgentHarness,
    baseOptions: () => ({
      prompt: "go",
      model: "claude-sonnet-4-6",
      cwd: "/tmp/project",
      effort: "xhigh",
    }),
    assertNonEmptyContract: async () => {
      await claudeAgentHarness.run({
        prompt: "go",
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        effort: "xhigh",
        mcpServers: SAMPLE_NON_EMPTY,
      });

      expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(1);
      const passed = executeWithAgentSDKMock.mock.calls[0][1] as {
        mcpServers: Record<string, unknown> | undefined;
      };
      expect(passed.mcpServers).toEqual(SAMPLE_NON_EMPTY);
      expect(Object.keys(passed.mcpServers ?? {})).toEqual(["foo"]);
    },
    assertEmptyContract: async () => {
      await claudeAgentHarness.run({
        prompt: "go",
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        effort: "xhigh",
        mcpServers: {},
      });

      expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(1);
      const passed = executeWithAgentSDKMock.mock.calls[0][1] as {
        mcpServers: Record<string, unknown> | undefined;
      };
      expect(passed.mcpServers).toEqual({});
    },
    assertOwnerQuestionsMerge: async () => {
      await claudeAgentHarness.run({
        prompt: "go",
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        effort: "xhigh",
        mcpServers: SAMPLE_NON_EMPTY,
        askOwner: { source: "test-source" },
      });
      const merged = (executeWithAgentSDKMock.mock.calls[0][1] as {
        mcpServers: Record<string, unknown>;
      }).mcpServers;
      expect(merged.foo).toEqual({ type: "stdio", command: "bar" });
      expect(merged[KOTA_OWNER_QUESTIONS_MCP_SERVER]).toBeDefined();

      // Caller already supplied an owner-questions entry: keep theirs. Use a
      // sentinel value the merge would replace if it overwrote rather than
      // preserved. The constant import (not a hardcoded string) means a rename
      // of the constant would break the test, not silently drift the contract.
      executeWithAgentSDKMock.mockClear();
      const sentinel = {
        type: "stdio" as const,
        command: "caller-owner-questions",
      };
      await claudeAgentHarness.run({
        prompt: "go",
        model: "claude-sonnet-4-6",
        cwd: "/tmp/project",
        effort: "xhigh",
        mcpServers: { [KOTA_OWNER_QUESTIONS_MCP_SERVER]: sentinel },
        askOwner: { source: "test-source" },
      });
      const preserved = (executeWithAgentSDKMock.mock.calls[0][1] as {
        mcpServers: Record<string, unknown>;
      }).mcpServers;
      expect(preserved[KOTA_OWNER_QUESTIONS_MCP_SERVER]).toEqual(sentinel);
    },
  },
  {
    name: "openai-tools",
    harness: openaiToolsAgentHarness,
    baseOptions: () => ({
      prompt: "go",
      model: "openai/gpt-5.4-mini",
      effort: "xhigh",
    }),
    assertNonEmptyContract: async () => {
      await expect(
        openaiToolsAgentHarness.run({
          prompt: "go",
          model: "openai/gpt-5.4-mini",
          effort: "xhigh",
          mcpServers: SAMPLE_NON_EMPTY,
        }),
      ).rejects.toThrow(/does not host MCP servers/);
      expect(messagesStreamMock).not.toHaveBeenCalled();
      expect(messagesCreateMock).not.toHaveBeenCalled();
    },
    assertEmptyContract: async () => {
      await openaiToolsAgentHarness.run({
        prompt: "go",
        model: "openai/gpt-5.4-mini",
        effort: "xhigh",
        mcpServers: {},
      });
      expect(messagesStreamMock).toHaveBeenCalledTimes(1);
    },
    assertOwnerQuestionsMerge: null,
  },
  {
    name: "thin",
    harness: thinAgentHarness,
    baseOptions: () => ({
      prompt: "go",
      model: "claude-haiku-4-5-20251001",
      effort: "xhigh",
      systemPrompt: "be terse",
    }),
    assertNonEmptyContract: async () => {
      await expect(
        thinAgentHarness.run({
          prompt: "go",
          model: "claude-haiku-4-5-20251001",
          effort: "xhigh",
          systemPrompt: "be terse",
          mcpServers: SAMPLE_NON_EMPTY,
        }),
      ).rejects.toThrow(/text-only.*drop mcpServers/);
      expect(messagesCreateMock).not.toHaveBeenCalled();
      expect(messagesStreamMock).not.toHaveBeenCalled();
    },
    assertEmptyContract: async () => {
      await thinAgentHarness.run({
        prompt: "go",
        model: "claude-haiku-4-5-20251001",
        effort: "xhigh",
        systemPrompt: "be terse",
        mcpServers: {},
      });
      expect(messagesCreateMock).toHaveBeenCalledTimes(1);
    },
    assertOwnerQuestionsMerge: null,
  },
];

describe.each(ADAPTERS)(
  "mcpServers parity: $name honors AgentHarnessRunOptions.mcpServers",
  (adapter) => {
    it("non-empty map — applies the adapter's declared contract (forward, reject, or surface to native MCP host)", async () => {
      await adapter.assertNonEmptyContract();
    });

    it("empty {} map — treated as unset; the adapter does not reject and proceeds to its model surface", async () => {
      await adapter.assertEmptyContract();
    });

    if (adapter.assertOwnerQuestionsMerge) {
      it("askOwner merge — adds the owner-questions server without overwriting caller-supplied entries under KOTA_OWNER_QUESTIONS_MCP_SERVER", async () => {
        await adapter.assertOwnerQuestionsMerge!();
      });
    }
  },
);
