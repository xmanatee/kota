import { describe, expect, it, vi } from "vitest";
import { MCP_DRAFT_PROTOCOL_VERSION } from "./client.js";
import { McpManager, namespaceTool, parseToolName } from "./manager.js";

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

  it("advertises remote elicitation modes only when an input resolver bridge is available", async () => {
    for (const inputResolverAvailable of [false, true] as const) {
      const manager = new McpManager();
      const server = `
        const rl = require("readline").createInterface({ input: process.stdin });
        const expectElicitation = process.env.EXPECT_ELICITATION === "1";
        function expectedCapabilities() {
          return expectElicitation ? { elicitation: { form: {}, url: {} } } : {};
        }
        function sameJson(left, right) {
          return JSON.stringify(left) === JSON.stringify(right);
        }
        function write(message) {
          process.stdout.write(JSON.stringify(message) + "\\n");
        }
        function protocolError(msg, message) {
          write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message } });
        }
        rl.on("line", (line) => {
          let msg;
          try { msg = JSON.parse(line); } catch { return; }
          if (msg.method === "initialize") {
            if (!sameJson(msg.params.capabilities, expectedCapabilities())) {
              protocolError(msg, "unexpected initialize capabilities");
              return;
            }
            write({ jsonrpc: "2.0", id: msg.id, result: {
              protocolVersion: "DRAFT-2026-v1",
              capabilities: {},
              serverInfo: { name: "capability-check" },
            }});
          } else if (msg.method === "tools/list") {
            const caps = msg.params?._meta?.["io.modelcontextprotocol/clientCapabilities"];
            if (!sameJson(caps, expectedCapabilities())) {
              protocolError(msg, "unexpected per-request capabilities");
              return;
            }
            write({ jsonrpc: "2.0", id: msg.id, result: {
              tools: [{
                name: "capability_snapshot",
                description: JSON.stringify(caps),
                inputSchema: { type: "object" },
              }],
            }});
          } else if (msg.method === "shutdown") {
            write({ jsonrpc: "2.0", id: msg.id, result: {} });
          }
        });
      `;
      await manager.initialize(
        {
          mcpServers: {
            remote: {
              command: "node",
              args: ["-e", server],
              env: { EXPECT_ELICITATION: inputResolverAvailable ? "1" : "0" },
            },
          },
        },
        { inputResolverAvailable },
      );

      const expectedCapabilities = inputResolverAvailable
        ? { elicitation: { form: {}, url: {} } }
        : {};
      expect(manager.getTools()[0]?.description).toContain(
        JSON.stringify(expectedCapabilities),
      );
      await manager.close();
    }
  }, 10_000);

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

  it("initialize skips invalid x-mcp-header tools while registering valid tools", async () => {
    const manager = new McpManager();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: "header-srv" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [
              {
                name: "kept",
                description: "Valid header mapping",
                inputSchema: {
                  type: "object",
                  properties: { token: { type: "string", "x-mcp-header": "X-Token" } },
                },
              },
              {
                name: "bad_header",
                description: "Invalid header mapping",
                inputSchema: {
                  type: "object",
                  properties: { token: { type: "string", "x-mcp-header": "" } },
                },
              },
            ],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "kept") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "kept ok" }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;

    await manager.initialize({
      mcpServers: { configured: { command: "node", args: ["-e", server] } },
    });

    const warning = errorSpy.mock.calls
      .map((call) => call.join(" "))
      .find((line) => line.includes("rejected MCP tool"));
    expect(manager.getServerCount()).toBe(1);
    expect(manager.getToolCount()).toBe(1);
    expect(manager.isMcpTool("mcp__configured__kept")).toBe(true);
    expect(manager.isMcpTool("mcp__configured__bad_header")).toBe(false);
    expect(manager.getTools().map((tool) => tool.name)).toEqual([
      "mcp__configured__kept",
    ]);
    expect(warning).toContain('server "header-srv"');
    expect(warning).toContain('tool "bad_header"');
    expect(warning).toContain("empty value");

    const result = await manager.executeTool("mcp__configured__kept", {
      token: "secret",
    });
    expect(result.content).toBe("kept ok");
    expect(result.is_error).toBeUndefined();

    await manager.close();
    errorSpy.mockRestore();
  }, 10_000);

  it("initialize registers tools from every tools/list page", async () => {
    const manager = new McpManager();
    const secondOutputSchema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    };
    const server = `
      const secondOutputSchema = ${JSON.stringify(secondOutputSchema)};
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: "paged-srv" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          if (!msg.params?.cursor) {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              tools: [{ name: "first", description: "First page", inputSchema: { type: "object" } }],
              nextCursor: "page-2",
            }}) + "\\n");
            return;
          }
          if (msg.params.cursor === "page-2") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              tools: [{
                name: "second",
                description: "Second page",
                inputSchema: { type: "object" },
                outputSchema: secondOutputSchema,
              }],
            }}) + "\\n");
            return;
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: {
            code: -32602,
            message: "Unexpected cursor",
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "second") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "second ok" }],
            structuredContent: { ok: true },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { paged: { command: "node", args: ["-e", server] } },
    });

    expect(manager.getServerCount()).toBe(1);
    expect(manager.getToolCount()).toBe(2);
    expect(manager.isMcpTool("mcp__paged__first")).toBe(true);
    expect(manager.isMcpTool("mcp__paged__second")).toBe(true);

    const tools = manager.getTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "mcp__paged__first",
      "mcp__paged__second",
    ]);
    expect(tools[1].output_schema).toEqual(secondOutputSchema);

    const result = await manager.executeTool("mcp__paged__second", {});
    expect(result.content).toBe("second ok");
    expect(result.structuredContent).toEqual({ ok: true });
    expect(result.is_error).toBeUndefined();

    await manager.close();
  }, 10_000);

  it("refreshes one server registry on tools/list_changed and updates routing without stale entries", async () => {
    const manager = new McpManager();
    const dynamicServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      let subscriptionId = null;
      let listCount = 0;
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "dynamic-srv" },
          }});
        } else if (msg.method === "notifications/initialized") {
          // notification - no response
        } else if (msg.method === "subscriptions/listen") {
          subscriptionId = String(msg.id);
          write({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            notifications: { toolsListChanged: true },
          }});
        } else if (msg.method === "tools/list") {
          listCount += 1;
          const toolName = listCount === 1 ? "old_tool" : "new_tool";
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: toolName, inputSchema: { type: "object" } }],
          }});
          if (listCount === 1) {
            setTimeout(() => {
              write({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {
                _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
              }});
            }, 20);
          }
        } else if (msg.method === "tools/call" && msg.params.name === "old_tool") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "old route" }],
          }});
        } else if (msg.method === "tools/call" && msg.params.name === "new_tool") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "new route" }],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    const staticServer = `
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
            serverInfo: { name: "static-srv" },
          }});
        } else if (msg.method === "tools/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "stay", inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "tools/call" && msg.params.name === "stay") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "static route" }],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    await manager.initialize({
      mcpServers: {
        dynamic: { command: "node", args: ["-e", dynamicServer] },
        static: { command: "node", args: ["-e", staticServer] },
      },
    });

    expect(manager.isMcpTool("mcp__static__stay")).toBe(true);

    await waitFor(() => {
      expect(manager.getTools().map((tool) => tool.name)).toEqual([
        "mcp__dynamic__new_tool",
        "mcp__static__stay",
      ]);
    });

    expect(manager.getToolCount()).toBe(2);
    expect(manager.isMcpTool("mcp__dynamic__old_tool")).toBe(false);
    expect(manager.isMcpTool("mcp__dynamic__new_tool")).toBe(true);
    expect(manager.isMcpTool("mcp__static__stay")).toBe(true);

    const removed = await manager.executeTool("mcp__dynamic__old_tool", {});
    expect(removed.is_error).toBe(true);
    expect(removed.content).toContain("Unknown MCP tool");

    const refreshed = await manager.executeTool("mcp__dynamic__new_tool", {});
    expect(refreshed.content).toBe("new route");
    expect(refreshed.is_error).toBeUndefined();

    const staticResult = await manager.executeTool("mcp__static__stay", {});
    expect(staticResult.content).toBe("static route");
    expect(staticResult.is_error).toBeUndefined();

    await manager.close();
  }, 10_000);

  it("keeps the previous server registry and warns when a refreshed tools/list is malformed", async () => {
    const manager = new McpManager();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      let subscriptionId = null;
      let listCount = 0;
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "bad-refresh-srv" },
          }});
        } else if (msg.method === "notifications/initialized") {
          // notification - no response
        } else if (msg.method === "subscriptions/listen") {
          subscriptionId = String(msg.id);
          write({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            notifications: { toolsListChanged: true },
          }});
        } else if (msg.method === "tools/list") {
          listCount += 1;
          if (listCount === 1) {
            write({ jsonrpc: "2.0", id: msg.id, result: {
              tools: [{ name: "stable", inputSchema: { type: "object" } }],
            }});
            setTimeout(() => {
              write({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {
                _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
              }});
            }, 20);
            return;
          }
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: 123, inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "tools/call" && msg.params.name === "stable") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            content: [{ type: "text", text: "stable route" }],
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    await manager.initialize({
      mcpServers: { badRefresh: { command: "node", args: ["-e", server] } },
    });

    expect(manager.getTools().map((tool) => tool.name)).toEqual([
      "mcp__badRefresh__stable",
    ]);

    await waitFor(() => {
      const warnings = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(warnings).toContain(
        'MCP server "badRefresh" tool refresh failed; keeping previous registry',
      );
      expect(warnings).toContain("tools[0].name must be a string");
    });

    expect(manager.getTools().map((tool) => tool.name)).toEqual([
      "mcp__badRefresh__stable",
    ]);
    expect(manager.getToolCount()).toBe(1);
    expect(manager.isMcpTool("mcp__badRefresh__stable")).toBe(true);

    const result = await manager.executeTool("mcp__badRefresh__stable", {});
    expect(result.content).toBe("stable route");
    expect(result.is_error).toBeUndefined();

    await manager.close();
    errorSpy.mockRestore();
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

  it("executeTool returns explicit diagnostics for remote draft input_required results", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
            serverInfo: { name: "needs-input" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: "Approve remote action?",
                  requestedSchema: {
                    type: "object",
                    properties: { approve: { type: "boolean" } },
                    required: ["approve"],
                  },
                },
              },
            },
            requestState: "remote-state-1",
            _meta: { traceId: "remote-input-1" },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__remote__confirmable", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("remote MCP tool");
    expect(result.content).toContain("input_required");
    expect(result.content).not.toContain("content must be an array");
    expect(result._meta).toEqual({
      mcp: {
        resultType: "input_required",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        server: "needs-input",
        tool: "confirmable",
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: "Approve remote action?",
              requestedSchema: {
                type: "object",
                properties: { approve: { type: "boolean" } },
                required: ["approve"],
              },
            },
          },
        },
        requestState: "remote-state-1",
        resultMeta: { traceId: "remote-input-1" },
      },
    });

    await manager.close();
  }, 10_000);

  it("executeTool returns diagnostics for remote input_required results without requestState", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: { mode: "form", message: "Approve remote action?" },
              },
            },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__remote__confirmable", {});
    expect(result.is_error).toBe(true);
    expect(result._meta).toEqual({
      mcp: {
        resultType: "input_required",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        server: "remote",
        tool: "confirmable",
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: { mode: "form", message: "Approve remote action?" },
          },
        },
      },
    });

    await manager.close();
  }, 10_000);

  it("executeTool retries remote draft input_required results through an input resolver", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
            serverInfo: { name: "needs-input" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          if (msg.params.requestState || msg.params.inputResponses) {
            const response = msg.params.inputResponses.approval;
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              resultType: "complete",
              content: [{ type: "text", text: "remote retry " + msg.params.requestState + " " + response.action + " " + response.content.approve }],
              structuredContent: {
                action: response.action,
                approve: response.content.approve,
              },
            }}) + "\\n");
            return;
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: "Approve remote action?",
                  requestedSchema: {
                    type: "object",
                    properties: { approve: { type: "boolean" } },
                    required: ["approve"],
                  },
                },
              },
            },
            requestState: "remote-state-1",
            _meta: { traceId: "remote-input-1" },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const seenRequests: unknown[] = [];
    const result = await manager.executeTool("mcp__remote__confirmable", {}, {
      inputResolver: async (request) => {
        seenRequests.push(request);
        return {
          kind: "respond",
          inputResponses: {
            approval: {
              action: "accept",
              content: { approve: true },
            },
          },
        };
      },
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("remote retry remote-state-1 accept true");
    expect(result.structuredContent).toEqual({
      action: "accept",
      approve: true,
    });
    expect(seenRequests).toEqual([
      {
        server: "needs-input",
        tool: "confirmable",
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: "Approve remote action?",
              requestedSchema: {
                type: "object",
                properties: { approve: { type: "boolean" } },
                required: ["approve"],
              },
            },
          },
        },
        requestState: "remote-state-1",
        resultMeta: { traceId: "remote-input-1" },
      },
    ]);

    await manager.close();
  }, 10_000);

  it("executeTool retries remote URL-mode input_required results without content", async () => {
    for (const action of ["accept", "decline", "cancel"] as const) {
      const manager = new McpManager();
      const server = `
        const rl = require("readline").createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          let msg;
          try { msg = JSON.parse(line); } catch { return; }
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              protocolVersion: "DRAFT-2026-v1",
              capabilities: {},
              serverInfo: { name: "needs-url-input" },
            }}) + "\\n");
          } else if (msg.method === "tools/list") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              tools: [{ name: "oauth_start", inputSchema: { type: "object" } }],
            }}) + "\\n");
          } else if (msg.method === "tools/call" && msg.params.name === "oauth_start") {
            if (msg.params.requestState || msg.params.inputResponses) {
              const response = msg.params.inputResponses.oauth;
              process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
                resultType: "complete",
                content: [{ type: "text", text: "url retry " + response.action }],
                structuredContent: {
                  action: response.action,
                  hasContent: Object.prototype.hasOwnProperty.call(response, "content"),
                  requestState: msg.params.requestState,
                },
              }}) + "\\n");
              return;
            }
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              resultType: "input_required",
              inputRequests: {
                oauth: {
                  method: "elicitation/create",
                  params: {
                    mode: "url",
                    message: "Please authorize Example Auth.",
                    url: "https://auth.example.test/consent?state=abc",
                    elicitationId: "oauth-abc",
                  },
                },
              },
              requestState: "remote-url-state",
            }}) + "\\n");
          } else if (msg.method === "shutdown") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
          }
        });
      `;
      await manager.initialize({
        mcpServers: { remote: { command: "node", args: ["-e", server] } },
      });

      const seenRequests: unknown[] = [];
      const result = await manager.executeTool("mcp__remote__oauth_start", {}, {
        inputResolver: async (request) => {
          seenRequests.push(request);
          return {
            kind: "respond",
            inputResponses: {
              oauth: { action },
            },
          };
        },
      });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toBe(`url retry ${action}`);
      expect(result.structuredContent).toEqual({
        action,
        hasContent: false,
        requestState: "remote-url-state",
      });
      expect(seenRequests).toEqual([
        {
          server: "needs-url-input",
          tool: "oauth_start",
          inputRequests: {
            oauth: {
              method: "elicitation/create",
              params: {
                mode: "url",
                message: "Please authorize Example Auth.",
                url: "https://auth.example.test/consent?state=abc",
                elicitationId: "oauth-abc",
              },
            },
          },
          requestState: "remote-url-state",
        },
      ]);

      await manager.close();
    }
  }, 10_000);

  it("executeTool retries remote input_required results with inputRequests only", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          if (msg.params.inputResponses) {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              resultType: "complete",
              content: [{ type: "text", text: "remote retry without state" }],
              structuredContent: {
                hasRequestState: Object.prototype.hasOwnProperty.call(msg.params, "requestState"),
                action: msg.params.inputResponses.approval.action,
              },
            }}) + "\\n");
            return;
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: { mode: "form", message: "Approve remote action?" },
              },
            },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const seenRequests: unknown[] = [];
    const result = await manager.executeTool("mcp__remote__confirmable", {}, {
      inputResolver: async (request) => {
        seenRequests.push(request);
        return {
          kind: "respond",
          inputResponses: {
            approval: { action: "decline" },
          },
        };
      },
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("remote retry without state");
    expect(result.structuredContent).toEqual({
      hasRequestState: false,
      action: "decline",
    });
    expect(seenRequests).toEqual([
      {
        server: "remote",
        tool: "confirmable",
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: { mode: "form", message: "Approve remote action?" },
          },
        },
      },
    ]);

    await manager.close();
  }, 10_000);

  it("executeTool retries remote input_required results with requestState only", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          if (msg.params.requestState) {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              resultType: "complete",
              content: [{ type: "text", text: "remote retry " + msg.params.requestState }],
              structuredContent: {
                hasInputResponses: Object.prototype.hasOwnProperty.call(msg.params, "inputResponses"),
              },
            }}) + "\\n");
            return;
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            requestState: "remote-state-only",
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__remote__confirmable", {});

    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("remote retry remote-state-only");
    expect(result.structuredContent).toEqual({ hasInputResponses: false });

    await manager.close();
  }, 10_000);

  it("executeTool can retry remote draft input_required results with explicit decline", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          if (msg.params.requestState || msg.params.inputResponses) {
            const response = msg.params.inputResponses.approval;
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
              resultType: "complete",
              content: [{ type: "text", text: "remote retry " + response.action }],
              isError: response.action !== "accept",
            }}) + "\\n");
            return;
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: { mode: "form", message: "Approve remote action?" },
              },
            },
            requestState: "remote-state-2",
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__remote__confirmable", {}, {
      inputResolver: async () => ({
        kind: "respond",
        inputResponses: {
          approval: { action: "decline" },
        },
      }),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toBe("remote retry decline");

    await manager.close();
  }, 10_000);

  it("executeTool keeps unsupported diagnostics when the operator resolver is unavailable", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "confirmable", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "confirmable") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: { mode: "form", message: "Approve remote action?" },
              },
            },
            requestState: "remote-state-3",
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    const result = await manager.executeTool("mcp__remote__confirmable", {}, {
      inputResolver: async () => ({
        kind: "unavailable",
        reason: "operator input surface unavailable.",
      }),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("operator input surface unavailable");
    expect(result._meta).toEqual({
      mcp: {
        resultType: "input_required",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        server: "remote",
        tool: "confirmable",
        inputRequests: {
          approval: {
            method: "elicitation/create",
            params: { mode: "form", message: "Approve remote action?" },
          },
        },
        requestState: "remote-state-3",
      },
    });

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
