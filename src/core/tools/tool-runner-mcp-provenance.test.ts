import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import { McpManager } from "#core/mcp/manager.js";
import { getToolMiddleware, resetToolMiddleware } from "./tool-middleware.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

function toolBlock(
  name: string,
  input: Record<string, unknown>,
  id = "t1",
): KotaToolUseBlock {
  return {
    type: "tool_use",
    id,
    name,
    input,
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

describe("executeToolCalls MCP provenance", () => {
  beforeEach(() => {
    resetToolMiddleware();
  });

  afterEach(() => {
    resetToolMiddleware();
  });

  it("passes real MCP manager result provenance into middleware", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: "remote-test" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{
              name: "lookup",
              description: "Looks up remote content",
              inputSchema: { type: "object" },
            }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "lookup") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "remote content" }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    const seen: unknown[] = [];
    getToolMiddleware().add("capture-provenance", async (call, next) => {
      seen.push(call.context?.resultContentProvenance);
      return next();
    });

    try {
      await manager.initialize({
        mcpServers: { remote: { command: "node", args: ["-e", server] } },
      });

      const results = await executeToolCalls(
        [toolBlock("mcp__remote__lookup", {}, "tool-99")],
        runOptions({ mcpManager: manager }),
      );

      expect(results[0].content).toBe("remote content");
      expect(seen).toEqual([{
        kind: "external-mcp",
        serverName: "remote",
        source: "tool",
        name: "lookup",
      }]);
    } finally {
      await manager.close();
    }
  }, 10_000);
});
