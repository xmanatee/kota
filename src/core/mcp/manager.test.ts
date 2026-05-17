import { describe, expect, it } from "vitest";
import { McpManager, namespaceTool, parseToolName } from "./manager.js";

describe("namespaceTool", () => {
  it("creates namespaced tool name", () => {
    expect(namespaceTool("sqlite", "query")).toBe("mcp__sqlite__query");
  });

  it("handles multi-word names", () => {
    expect(namespaceTool("my-server", "run_query")).toBe("mcp__my-server__run_query");
  });
});

describe("parseToolName", () => {
  it("parses valid MCP tool name", () => {
    expect(parseToolName("mcp__sqlite__query")).toEqual({
      server: "sqlite",
      tool: "query",
    });
  });

  it("returns null for non-MCP tool", () => {
    expect(parseToolName("shell")).toBeNull();
    expect(parseToolName("file_read")).toBeNull();
  });

  it("returns null for malformed MCP name", () => {
    expect(parseToolName("mcp__")).toBeNull();
    expect(parseToolName("mcp")).toBeNull();
  });

  it("preserves tool names with separators", () => {
    expect(parseToolName("mcp__server__tool__with__parts")).toEqual({
      server: "server",
      tool: "tool__with__parts",
    });
  });
});

describe("McpManager", () => {
  it("starts empty", () => {
    const manager = new McpManager();
    expect(manager.getTools()).toEqual([]);
    expect(manager.getServerCount()).toBe(0);
    expect(manager.getToolCount()).toBe(0);
  });

  it("isMcpTool returns false for built-in tools", () => {
    const manager = new McpManager();
    expect(manager.isMcpTool("shell")).toBe(false);
    expect(manager.isMcpTool("file_read")).toBe(false);
  });

  it("isMcpTool returns false when no servers configured", () => {
    const manager = new McpManager();
    expect(manager.isMcpTool("mcp__sqlite__query")).toBe(false);
  });

  it("executeTool returns error for unknown MCP tool", async () => {
    const manager = new McpManager();
    const result = await manager.executeTool("mcp__unknown__tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unknown MCP tool");
  });

  it("close succeeds when empty", async () => {
    const manager = new McpManager();
    await manager.close();
    expect(manager.getServerCount()).toBe(0);
  });

  it("loadConfig returns null when no config file", () => {
    const config = McpManager.loadConfig("/tmp/__nonexistent_dir__");
    expect(config).toBeNull();
  });

  it("handles failed server connections gracefully", async () => {
    const manager = new McpManager();
    await manager.initialize({
      mcpServers: {
        "bad-server": {
          command: "__nonexistent_command__",
          args: [],
        },
      },
    });
    // Should not throw, just log warning
    expect(manager.getServerCount()).toBe(0);
    expect(manager.getToolCount()).toBe(0);
  }, 15_000);

  it("initialize with empty mcpServers is a no-op", async () => {
    const manager = new McpManager();
    await manager.initialize({ mcpServers: {} });
    expect(manager.getServerCount()).toBe(0);
    expect(manager.getToolCount()).toBe(0);
  });

  it("initialize connects to working server and lists tools", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: "test-srv" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "ping", description: "Pings", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "ping") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "pong" }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { "test-srv": { command: "node", args: ["-e", server] } },
    });

    expect(manager.getServerCount()).toBe(1);
    expect(manager.getToolCount()).toBe(1);
    expect(manager.isMcpTool("mcp__test-srv__ping")).toBe(true);

    const tools = manager.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp__test-srv__ping");

    const result = await manager.executeTool("mcp__test-srv__ping", {});
    expect(result.content).toBe("pong");
    expect(result.is_error).toBeUndefined();

    await manager.close();
    expect(manager.getServerCount()).toBe(0);
    expect(manager.getToolCount()).toBe(0);
  }, 10_000);

  it("exposes remote output schemas and accepts matching structuredContent", async () => {
    const manager = new McpManager();
    const outputSchema = {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        count: { type: "number" },
      },
      required: ["ok", "count"],
      additionalProperties: false,
    };
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{
              name: "structured",
              description: "Structured response",
              inputSchema: { type: "object" },
              outputSchema: ${JSON.stringify(outputSchema)},
            }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "structured") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [
              {
                type: "text",
                text: "visible",
                annotations: { audience: ["assistant"], priority: 0.8 },
                _meta: { blockCache: "b1" },
              },
              { type: "image", data: "abc", mimeType: "image/png" },
            ],
            structuredContent: { ok: true, count: 2 },
            _meta: { resultCache: "r1" },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { structured: { command: "node", args: ["-e", server] } },
    });

    const tools = manager.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].output_schema).toEqual(outputSchema);

    const result = await manager.executeTool("mcp__structured__structured", {});
    expect(result.content).toBe("visible");
    expect(result.blocks).toEqual([
      {
        type: "text",
        text: "visible",
        annotations: { audience: ["assistant"], priority: 0.8 },
        _meta: { blockCache: "b1" },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
    ]);
    expect(result.structuredContent).toEqual({ ok: true, count: 2 });
    expect(result._meta).toEqual({ resultCache: "r1" });
    expect(result.is_error).toBeUndefined();

    await manager.close();
  }, 10_000);

  it("returns an MCP tool error when outputSchema is advertised without structuredContent", async () => {
    const manager = new McpManager();
    const outputSchema = {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
    };
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{
              name: "missing",
              inputSchema: { type: "object" },
              outputSchema: ${JSON.stringify(outputSchema)},
            }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "missing") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "missing structured output" }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { missing: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__missing__missing", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("MCP tool error");
    expect(result.content).toContain("declared output_schema but returned no structuredContent");
    expect(result.structuredContent).toBeUndefined();

    await manager.close();
  }, 10_000);

  it("returns an MCP tool error when structuredContent violates outputSchema", async () => {
    const manager = new McpManager();
    const outputSchema = {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
    };
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{
              name: "invalid",
              inputSchema: { type: "object" },
              outputSchema: ${JSON.stringify(outputSchema)},
            }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "invalid") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "invalid structured output" }],
            structuredContent: { count: "two" },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { invalid: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__invalid__invalid", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("MCP tool error");
    expect(result.content).toContain("structuredContent does not match output_schema");
    expect(result.content).toContain("structuredContent.count: expected number, got string");
    expect(result.structuredContent).toBeUndefined();

    await manager.close();
  }, 10_000);

  it("executeTool returns error when server has disconnected", async () => {
    const manager = new McpManager();
    const dieServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "test", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "notifications/initialized") {
          setTimeout(() => process.exit(1), 50);
        }
      });
    `;
    await manager.initialize({
      mcpServers: { dying: { command: "node", args: ["-e", dieServer] } },
    });
    expect(manager.getServerCount()).toBe(1);

    // Wait for server to die
    await new Promise((r) => setTimeout(r, 300));

    const result = await manager.executeTool("mcp__dying__test", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("disconnected");

    await manager.close();
  }, 10_000);

  it("executeTool preserves structured metadata, rich content, and tool errors", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "rich", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "rich") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [
              { type: "text", text: "visible", _meta: { blockCache: "b1" } },
              { type: "image", data: "abc", mimeType: "image/png" },
              { type: "audio", data: "def", mimeType: "audio/wav" },
            ],
            structuredContent: { count: 3 },
            _meta: { resultCache: "r1" },
            isError: true,
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { rich: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__rich__rich", {});
    expect(result.content).toBe("visible");
    expect(result.blocks).toEqual([
      { type: "text", text: "visible", _meta: { blockCache: "b1" } },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
      { type: "mcp_content", content: { type: "audio", data: "def", mimeType: "audio/wav" } },
    ]);
    expect(result.structuredContent).toEqual({ count: 3 });
    expect(result._meta).toEqual({ resultCache: "r1" });
    expect(result.is_error).toBe(true);

    await manager.close();
  }, 10_000);

  it("mixed success/failure in multi-server init", async () => {
    const manager = new McpManager();
    const goodServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "ok", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: {
        good: { command: "node", args: ["-e", goodServer] },
        bad: { command: "__nonexistent__" },
      },
    });

    // Good server connected, bad one didn't
    expect(manager.getServerCount()).toBe(1);
    expect(manager.getToolCount()).toBe(1);
    expect(manager.isMcpTool("mcp__good__ok")).toBe(true);
    expect(manager.isMcpTool("mcp__bad__anything")).toBe(false);

    await manager.close();
  }, 15_000);

  it("loadConfig handles invalid JSON gracefully", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
    const configDir = path.join(tmpDir, ".kota");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "mcp.json"), "not valid json {{{");

    const config = McpManager.loadConfig(tmpDir);
    expect(config).toBeNull();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("double close is safe", async () => {
    const manager = new McpManager();
    await manager.close();
    await manager.close();
    expect(manager.getServerCount()).toBe(0);
  });
});
