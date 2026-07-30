import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import { McpManager } from "#core/mcp/manager.js";
import { getToolMiddleware, resetToolMiddleware } from "./tool-middleware.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";
import { getToolTelemetry, resetToolTelemetry } from "./tool-telemetry.js";

const STALE_REASON = "mcp_declaration_changed_since_prompt";

function toolBlock(name: string, id = "tool-1"): KotaToolUseBlock {
  return {
    type: "tool_use",
    id,
    name,
    input: { secret: "do-not-print" },
  };
}

function runOptions(
  overrides: Partial<ToolCallExecutionOptions> = {},
): ToolCallExecutionOptions {
  return {
    resultLimit: 50000,
    verbose: false,
    autonomyMode: "autonomous",
    ...overrides,
  };
}

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  let lastError: Error | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError ?? new Error("Timed out waiting for assertion");
}

function declarationRefreshServerScript(): string {
  return `
    const rl = require("readline").createInterface({ input: process.stdin });
    let listCount = 0;
    let lookupCalls = 0;
    const lookupA = { name: "lookup", description: "Lookup version A", inputSchema: { type: "object" } };
    const lookupB = { name: "lookup", description: "Lookup version B", inputSchema: { type: "object" } };
    const refresh = { name: "refresh_registry", description: "Refresh registry", inputSchema: { type: "object" } };
    function write(message) {
      process.stdout.write(JSON.stringify(message) + "\\n");
    }
    function notifyToolListChanged() {
      write({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} });
    }
    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === "initialize") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "remote-test" },
        }});
      } else if (msg.method === "tools/list") {
        listCount += 1;
        write({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [listCount === 1 ? lookupA : lookupB, refresh] },
        });
      } else if (msg.method === "tools/call" && msg.params.name === "refresh_registry") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          content: [{ type: "text", text: "refresh requested" }],
        }});
        setTimeout(notifyToolListChanged, 0);
      } else if (msg.method === "tools/call" && msg.params.name === "lookup") {
        lookupCalls += 1;
        write({ jsonrpc: "2.0", id: msg.id, result: {
          content: [{ type: "text", text: "lookup-called:" + lookupCalls }],
        }});
      } else if (msg.method === "shutdown") {
        write({ jsonrpc: "2.0", id: msg.id, result: {} });
      }
    });
  `;
}

describe("executeToolCalls MCP declaration contract", () => {
  beforeEach(() => {
    resetToolMiddleware();
    resetToolTelemetry();
  });

  afterEach(() => {
    resetToolMiddleware();
  });

  it("denies a stale same-name MCP tool call and allows retry under the refreshed fingerprint", async () => {
    const manager = new McpManager();
    const toolName = "mcp__remote__lookup";
    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: ["-e", declarationRefreshServerScript()],
          },
        },
      });
      const promptFingerprint = manager.getToolDeclarationFingerprint(toolName);
      expect(promptFingerprint).toMatch(/^[a-f0-9]{64}$/);

      await manager.executeTool("mcp__remote__refresh_registry", {});
      await waitFor(() => {
        expect(manager.getToolDeclarationFingerprint(toolName)).not.toBe(promptFingerprint);
      });
      const refreshedFingerprint = manager.getToolDeclarationFingerprint(toolName);
      expect(refreshedFingerprint).toMatch(/^[a-f0-9]{64}$/);

      const stale = await executeToolCalls(
        [toolBlock(toolName, "stale-1")],
        runOptions({
          mcpManager: manager,
          mcpPromptToolDeclarationFingerprints: new Map([
            [toolName, promptFingerprint!],
          ]),
        }),
      );

      expect(stale[0]).toMatchObject({
        tool_use_id: "stale-1",
        is_error: true,
        _meta: {
          mcp: {
            reason: STALE_REASON,
            tool: toolName,
            promptDeclarationFingerprintPrefix: promptFingerprint!.slice(0, 12),
            currentDeclarationFingerprintPrefix: refreshedFingerprint!.slice(0, 12),
          },
        },
      });
      expect(stale[0].content).toContain(STALE_REASON);
      expect(stale[0].content).not.toContain("do-not-print");
      expect(getToolTelemetry().getToolStats(toolName)).toMatchObject({
        calls: 1,
        failures: 1,
        lastError: expect.stringContaining(STALE_REASON),
      });

      const fresh = await executeToolCalls(
        [toolBlock(toolName, "fresh-1")],
        runOptions({
          mcpManager: manager,
          mcpPromptToolDeclarationFingerprints: new Map([
            [toolName, refreshedFingerprint!],
          ]),
        }),
      );

      expect(fresh[0]).toMatchObject({
        tool_use_id: "fresh-1",
        content: "lookup-called:1",
      });
      expect(fresh[0].is_error).toBeUndefined();
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("denies a prompt-visible MCP tool that was removed before approval or local fallback", async () => {
    const executeTool = vi.fn();
    const manager = {
      isMcpTool: vi.fn(() => false),
      getToolDeclarationFingerprint: vi.fn(() => undefined),
      executeTool,
    };

    const results = await executeToolCalls(
      [toolBlock("mcp__remote__removed", "removed-1")],
      runOptions({
        autonomyMode: "supervised",
        mcpManager: manager as never,
        mcpPromptToolDeclarationFingerprints: new Map([
          ["mcp__remote__removed", "c".repeat(64)],
        ]),
      }),
    );

    expect(results[0]).toMatchObject({
      tool_use_id: "removed-1",
      is_error: true,
      _meta: {
        mcp: {
          reason: STALE_REASON,
          currentDeclarationFingerprintPrefix: null,
        },
      },
    });
    expect(results[0].content).toContain("missing");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rechecks declaration drift after middleware before MCP dispatch", async () => {
    const promptFingerprint = "a".repeat(64);
    const changedFingerprint = "b".repeat(64);
    const toolName = "mcp__remote__lookup";
    let currentFingerprint = promptFingerprint;
    const executeTool = vi.fn().mockResolvedValue({ content: "remote called" });
    const manager = {
      isMcpTool: vi.fn(() => true),
		getTools: vi.fn(() => [{
			name: toolName,
			description: "Lookup",
			input_schema: { type: "object", properties: {} },
		}]),
      getToolDeclarationFingerprint: vi.fn(() => currentFingerprint),
      executeTool,
    };
    getToolMiddleware().add("mutate-mcp-declaration-before-dispatch", async (_call, next) => {
      currentFingerprint = changedFingerprint;
      return next();
    });

    const results = await executeToolCalls(
      [toolBlock(toolName, "late-stale-1")],
      runOptions({
        mcpManager: manager as never,
        mcpPromptToolDeclarationFingerprints: new Map([
          [toolName, promptFingerprint],
        ]),
      }),
    );

    expect(results[0]).toMatchObject({
      tool_use_id: "late-stale-1",
      is_error: true,
      _meta: {
        mcp: {
          reason: STALE_REASON,
          tool: toolName,
          promptDeclarationFingerprintPrefix: promptFingerprint.slice(0, 12),
          currentDeclarationFingerprintPrefix: changedFingerprint.slice(0, 12),
        },
      },
    });
    expect(results[0].content).toContain(STALE_REASON);
    expect(executeTool).not.toHaveBeenCalled();
    expect(manager.getToolDeclarationFingerprint).toHaveBeenCalledTimes(2);
  });
});
