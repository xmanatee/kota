import { describe, expect, it, vi } from "vitest";
import { McpManager, namespaceTool, parseToolName } from "./manager.js";

function captureTerminalStderr(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
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

describe("MCP tool namespacing", () => {
  it("creates and parses injective namespaced tool names", () => {
    expect(namespaceTool("sqlite", "query")).toBe("mcp__sqlite__query");
    expect(namespaceTool("my-server", "run_query")).toBe("mcp__my-server__run_query");
    expect(parseToolName("mcp__sqlite__query")).toEqual({
      server: "sqlite",
      tool: "query",
    });
    expect(parseToolName("shell")).toBeNull();
    expect(parseToolName("mcp__")).toBeNull();
    expect(parseToolName("mcp__server__tool__with__parts")).toEqual({
      server: "server",
      tool: "tool__with__parts",
    });
  });

  it("rejects server suffixes that would collide with tool prefixes", () => {
    expect(() => namespaceTool("a_", "b")).toThrow(
      'server config name "a_": namespaced MCP server config names cannot end with "_"',
    );
    expect(namespaceTool("a", "_b")).toBe("mcp__a___b");
    expect(parseToolName("mcp__a___b")).toEqual({
      server: "a",
      tool: "_b",
    });
  });

  it("rejects separator-bearing server names before connecting", async () => {
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    try {
      await manager.initialize({
        mcpServers: {
          "a__b": { command: "node", args: ["-e", ""] },
        },
      });
      expect(manager.getServerCount()).toBe(0);
      expect(manager.getToolCount()).toBe(0);
      expect(stderr.output()).toContain('MCP server "a__b" failed to connect');
      expect(stderr.output()).toContain('server config name "a__b"');
    } finally {
      stderr.restore();
      await manager.close();
    }
  });

  it("rejects separator-bearing remote tool names instead of publishing ambiguous routes", async () => {
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "ambiguous-tool-server" },
          }});
        } else if (msg.method === "tools/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "b__c", inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    try {
      await manager.initialize({
        mcpServers: {
          a: { command: "node", args: ["-e", server] },
        },
      });
      expect(manager.getServerCount()).toBe(0);
      expect(manager.getToolCount()).toBe(0);
      expect(stderr.output()).toContain('MCP server "a" failed to connect');
      expect(stderr.output()).toContain('tool name "b__c"');
    } finally {
      stderr.restore();
      await manager.close();
    }
  }, 10_000);

  it("fails duplicate generated tool names before publishing the registry", async () => {
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "duplicate-tool-server" },
          }});
        } else if (msg.method === "tools/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [
              { name: "query", inputSchema: { type: "object" } },
              { name: "query", inputSchema: { type: "object" } },
            ],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    try {
      await manager.initialize({
        mcpServers: {
          sqlite: { command: "node", args: ["-e", server] },
        },
      });
      expect(manager.getServerCount()).toBe(0);
      expect(manager.getToolCount()).toBe(0);
      expect(stderr.output()).toContain('MCP server "sqlite" failed to connect');
      expect(stderr.output()).toContain('duplicate generated MCP tool name "mcp__sqlite__query"');
    } finally {
      stderr.restore();
      await manager.close();
    }
  }, 10_000);

  it("rejects the colliding server half while preserving the unambiguous tool half", async () => {
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "boundary-prefix-tool-server" },
          }});
        } else if (msg.method === "tools/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "_b", inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "tools/call") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: msg.params.name + " route" }],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    try {
      await manager.initialize({
        mcpServers: {
          "a_": { command: "node", args: ["-e", ""] },
          a: { command: "node", args: ["-e", server] },
        },
      });
      expect(stderr.output()).toContain('MCP server "a_" failed to connect');
      expect(stderr.output()).toContain(
        'server config name "a_": namespaced MCP server config names cannot end with "_"',
      );
      expect(manager.getTools().map((tool) => tool.name)).toEqual(["mcp__a___b"]);

      const result = await manager.executeTool("mcp__a___b", {});
      expect(result.content).toBe("_b route");
    } finally {
      stderr.restore();
      await manager.close();
    }
  }, 10_000);

  it("keeps the previous registry when a refresh advertises an ambiguous tool name", async () => {
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      let listCount = 0;
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "refresh-ambiguous-tool-server" },
          }});
        } else if (msg.method === "tools/list") {
          listCount += 1;
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: listCount === 1 ? "stable" : "shadow__route", inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "tools/call") {
          setTimeout(() => write({
            jsonrpc: "2.0",
            method: "notifications/tools/list_changed",
            params: {},
          }), 0);
          write({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: msg.params.name + " route" }],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    try {
      await manager.initialize({
        mcpServers: {
          remote: { command: "node", args: ["-e", server] },
        },
      });
      expect(manager.getTools().map((tool) => tool.name)).toEqual(["mcp__remote__stable"]);

      const result = await manager.executeTool("mcp__remote__stable", {});
      expect(result.content).toBe("stable route");

      await waitFor(() => {
        expect(stderr.output()).toContain("tool refresh failed; keeping previous registry");
        expect(stderr.output()).toContain('tool name "shadow__route"');
      });
      expect(manager.getTools().map((tool) => tool.name)).toEqual(["mcp__remote__stable"]);
      expect(manager.isMcpTool("mcp__remote__shadow__route")).toBe(false);
    } finally {
      stderr.restore();
      await manager.close();
    }
  }, 10_000);
});
