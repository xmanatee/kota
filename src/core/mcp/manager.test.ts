import { describe, expect, it, vi } from "vitest";
import { MCP_DRAFT_PROTOCOL_VERSION } from "./client.js";
import { type McpInputResolver, McpManager, namespaceTool, parseToolName } from "./manager.js";

type RecordedHttpRequest = {
  url: string;
  headers: Headers;
  body: {
    id?: number;
    method?: string;
    params?: Record<string, any>;
  };
};

function mockMcpHttpFetch(
  handler: (request: RecordedHttpRequest) => Response,
): {
  requests: RecordedHttpRequest[];
  fetchSpy: { mockRestore: () => void };
} {
  const requests: RecordedHttpRequest[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const request = {
      url: String(input),
      headers: new Headers(init?.headers),
      body,
    };
    requests.push(request);
    return handler(request);
  });
  return { requests, fetchSpy };
}

function jsonRpcResponse(id: number | undefined, result: Record<string, any>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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
              capabilities: { tools: {} },
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

  it("connects Streamable HTTP servers and routes tools through the normal MCP surface", async () => {
    const { requests, fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "http-fixture" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{
            name: "echo",
            description: "Echoes input",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
            outputSchema: {
              type: "object",
              properties: { echoed: { type: "string" } },
              required: ["echoed"],
            },
          }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          content: [{ type: "text", text: `Echo: ${request.body.params?.arguments?.text}` }],
          structuredContent: { echoed: request.body.params?.arguments?.text },
          isError: false,
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.body.id,
        error: { code: -32601, message: `unknown method ${request.body.method}` },
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            headers: { Authorization: "Bearer test-token" },
          },
        },
      });

      expect(manager.getServerCount()).toBe(1);
      expect(manager.getToolCount()).toBe(1);
      expect(manager.getTools()[0]).toMatchObject({
        name: "mcp__remote__echo",
        output_schema: {
          type: "object",
          properties: { echoed: { type: "string" } },
          required: ["echoed"],
        },
      });

      const result = await manager.executeTool("mcp__remote__echo", { text: "hello" });
      expect(result.is_error).toBe(false);
      expect(result.content).toBe("Echo: hello");
      expect(result.structuredContent).toEqual({ echoed: "hello" });

      expect(requests.map((request) => request.body.method)).toEqual([
        "server/discover",
        "tools/list",
        "tools/call",
      ]);
      for (const request of requests) {
        expect(request.url).toBe("https://mcp.example.test/mcp");
        expect(request.headers.get("accept")).toBe("application/json, text/event-stream");
        expect(request.headers.get("content-type")).toBe("application/json");
        expect(request.headers.get("mcp-protocol-version")).toBe(MCP_DRAFT_PROTOCOL_VERSION);
        expect(request.headers.get("mcp-method")).toBe(request.body.method);
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        expect(request.body.params?._meta).toMatchObject({
          "io.modelcontextprotocol/protocolVersion": MCP_DRAFT_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": { name: "kota", version: "0.1.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        });
      }
      expect(requests[2].headers.get("mcp-name")).toBe("echo");
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("reports Streamable HTTP authorization challenges without leaking configured bearer headers", async () => {
    const { fetchSpy } = mockMcpHttpFetch(() => new Response("configured-token should not surface", {
      status: 401,
      headers: {
        "content-type": "text/plain",
        "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"',
      },
    }));
    const manager = new McpManager();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            headers: { Authorization: "Bearer configured-token" },
          },
        },
      });

      expect(manager.getServerCount()).toBe(0);
      const output = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain('MCP server "remote" failed to connect');
      expect(output).toContain("authorization required");
      expect(output).toContain("mcp:tools");
      expect(output).not.toContain("configured-token");
    } finally {
      errorSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("exposes remote resources and prompts as explicit namespaced operations without colliding with tool names", async () => {
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "catalog-server" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "resources_list", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "resources/list") {
        return jsonRpcResponse(request.body.id, {
          resources: [{ uri: "file:///tmp/a.md", name: "a" }],
        });
      }
      if (request.body.method === "resources/templates/list") {
        return jsonRpcResponse(request.body.id, {
          resourceTemplates: [{ uriTemplate: "file:///{name}.md", name: "file-template" }],
        });
      }
      if (request.body.method === "resources/read") {
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          contents: [{ uri: request.body.params?.uri, text: "resource text" }],
        });
      }
      if (request.body.method === "prompts/list") {
        return jsonRpcResponse(request.body.id, {
          prompts: [{ name: "triage", arguments: [{ name: "topic", required: true }] }],
        });
      }
      if (request.body.method === "prompts/get") {
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          description: "Remote prompt",
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Review ${request.body.params?.arguments?.topic}`,
            },
          }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          content: [{ type: "text", text: "tool still routed" }],
        });
      }
      return jsonRpcResponse(request.body.id, {});
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      });

      expect(manager.getToolCount()).toBe(1);
      expect(manager.getTools().map((tool) => tool.name)).toEqual([
        "mcp__remote__resources_list",
        "mcp_resources__remote__list",
        "mcp_resource_templates__remote__list",
        "mcp_resources__remote__read",
        "mcp_prompts__remote__list",
        "mcp_prompts__remote__get",
      ]);

      const tool = await manager.executeTool("mcp__remote__resources_list", {});
      expect(tool.content).toBe("tool still routed");

      const resources = await manager.executeTool("mcp_resources__remote__list", {});
      expect(resources.is_error).toBeUndefined();
      expect(resources.structuredContent).toEqual({
        resources: [{ uri: "file:///tmp/a.md", name: "a" }],
      });

      const templates = await manager.executeTool("mcp_resource_templates__remote__list", {});
      expect(templates.structuredContent).toEqual({
        resourceTemplates: [{ uriTemplate: "file:///{name}.md", name: "file-template" }],
      });

      const resource = await manager.executeTool("mcp_resources__remote__read", {
        uri: "file:///tmp/a.md",
      });
      expect(resource.structuredContent).toEqual({
        resultType: "complete",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        contents: [{ uri: "file:///tmp/a.md", text: "resource text" }],
      });

      const prompts = await manager.executeTool("mcp_prompts__remote__list", {});
      expect(prompts.structuredContent).toEqual({
        prompts: [{
          name: "triage",
          arguments: [{ name: "topic", required: true }],
        }],
      });

      const prompt = await manager.executeTool("mcp_prompts__remote__get", {
        name: "triage",
        arguments: { topic: "build state" },
      });
      expect(prompt.blocks).toBeUndefined();
      expect(prompt.structuredContent).toEqual({
        resultType: "complete",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        description: "Remote prompt",
        messages: [{
          role: "user",
          content: { type: "text", text: "Review build state" },
        }],
      });
      expect(prompt.content).toContain('"messages"');
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("routes resource and prompt input_required results through the existing input resolver", async () => {
    const attempts: string[] = [];
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {}, prompts: {} },
          serverInfo: { name: "input-server" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, { tools: [] });
      }
      if (request.body.method === "resources/read") {
        attempts.push(`resource:${request.body.params?.requestState ?? "first"}`);
        if (!request.body.params?.requestState) {
          return jsonRpcResponse(request.body.id, {
            resultType: "input_required",
            inputRequests: {
              approve: {
                method: "elicitation/create",
                params: { message: "Approve resource read" },
              },
            },
            requestState: "resource-state",
          });
        }
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          contents: [{ uri: request.body.params?.uri, text: "approved resource" }],
        });
      }
      if (request.body.method === "prompts/get") {
        attempts.push(
          `prompt:${request.body.params?.requestState ?? (request.body.params?.inputResponses ? "responses" : "first")}`,
        );
        if (!request.body.params?.requestState && !request.body.params?.inputResponses) {
          return jsonRpcResponse(request.body.id, {
            resultType: "input_required",
            inputRequests: {
              approve: {
                method: "elicitation/create",
                params: { message: "Approve prompt" },
              },
            },
          });
        }
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          messages: [{ role: "user", content: { type: "text", text: "approved prompt" } }],
        });
      }
      return jsonRpcResponse(request.body.id, {});
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      }, { inputResolverAvailable: true });

      const resolverCalls: Array<{ server: string; tool: string; requestState?: string }> = [];
      const inputResolver: McpInputResolver = async (request) => {
        resolverCalls.push({
          server: request.server,
          tool: request.tool,
          ...(request.requestState !== undefined ? { requestState: request.requestState } : {}),
        });
        return {
          kind: "respond" as const,
          inputResponses: { approve: { action: "accept", content: { ok: true } } },
        };
      };

      const resource = await manager.executeTool("mcp_resources__remote__read", {
        uri: "secret://resource",
      }, { inputResolver });
      const prompt = await manager.executeTool("mcp_prompts__remote__get", {
        name: "confirmable",
      }, { inputResolver });

      expect(resource.structuredContent).toMatchObject({
        contents: [{ uri: "secret://resource", text: "approved resource" }],
      });
      expect(prompt.structuredContent).toMatchObject({
        messages: [{ role: "user", content: { type: "text", text: "approved prompt" } }],
      });
      expect(resolverCalls).toEqual([
        { server: "input-server", tool: "resources/read", requestState: "resource-state" },
        { server: "input-server", tool: "prompts/get" },
      ]);
      expect(attempts).toEqual([
        "resource:first",
        "resource:resource-state",
        "prompt:first",
        "prompt:responses",
      ]);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("connects resource-only HTTP servers without requiring tools/list", async () => {
    const { requests, fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {} },
          serverInfo: { name: "resource-only" },
        });
      }
      if (request.body.method === "resources/list") {
        return jsonRpcResponse(request.body.id, {
          resources: [{ uri: "file:///tmp/only.md", name: "only" }],
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.body.id,
        error: { code: -32601, message: `unexpected ${request.body.method}` },
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      });

      expect(manager.getToolCount()).toBe(0);
      expect(manager.getTools().map((tool) => tool.name)).toEqual([
        "mcp_resources__remote__list",
        "mcp_resource_templates__remote__list",
        "mcp_resources__remote__read",
      ]);
      const resources = await manager.executeTool("mcp_resources__remote__list", {});
      expect(resources.structuredContent).toEqual({
        resources: [{ uri: "file:///tmp/only.md", name: "only" }],
      });
      expect(requests.map((request) => request.body.method)).toEqual([
        "server/discover",
        "resources/list",
      ]);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("connects stdio servers that advertise resources and prompts without tools", async () => {
    const catalogOnlyServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: { resources: {}, prompts: {} },
            serverInfo: { name: "catalog-only" },
          }});
          return;
        }
        if (msg.method === "notifications/initialized") return;
        if (msg.method === "resources/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resources: [{ uri: "file:///tmp/only.md", name: "only" }],
          }});
          return;
        }
        if (msg.method === "prompts/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            prompts: [{ name: "summarize", description: "Summarize context" }],
          }});
          return;
        }
        if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
          return;
        }
        write({ jsonrpc: "2.0", id: msg.id, error: {
          code: -32601,
          message: "unexpected " + msg.method,
        }});
      });
    `;
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: { command: "node", args: ["-e", catalogOnlyServer] },
        },
      });

      expect(manager.getServerCount()).toBe(1);
      expect(manager.getToolCount()).toBe(0);
      expect(manager.getTools().map((tool) => tool.name)).toEqual([
        "mcp_resources__remote__list",
        "mcp_resource_templates__remote__list",
        "mcp_resources__remote__read",
        "mcp_prompts__remote__list",
        "mcp_prompts__remote__get",
      ]);
      await expect(
        manager.executeTool("mcp_resources__remote__list", {}),
      ).resolves.toMatchObject({
        structuredContent: {
          resources: [{ uri: "file:///tmp/only.md", name: "only" }],
        },
      });
      await expect(
        manager.executeTool("mcp_prompts__remote__list", {}),
      ).resolves.toMatchObject({
        structuredContent: {
          prompts: [{ name: "summarize", description: "Summarize context" }],
        },
      });
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("reports ambiguous MCP server config without coercing it into stdio", async () => {
    const manager = new McpManager();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await manager.initialize({
        mcpServers: {
          ambiguous: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            command: "node",
          } as never,
        },
      });

      expect(manager.getServerCount()).toBe(0);
      expect(errorSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
        'MCP server "ambiguous" failed to connect',
      );
      expect(errorSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain(
        "http transport cannot also define stdio fields",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects malformed transport config instead of coercing boundary values", async () => {
    const cases = [
      {
        serverName: "stdioHeaders",
        config: {
          command: "node",
          headers: { Authorization: "Bearer token" },
        } as never,
        expected: "stdio transport cannot define http field headers",
      },
      {
        serverName: "envString",
        config: {
          command: "node",
          env: "TOKEN=value",
        } as never,
        expected: "env must be an object with string values",
      },
      {
        serverName: "envNumber",
        config: {
          command: "node",
          env: 123,
        } as never,
        expected: "env must be an object with string values",
      },
      {
        serverName: "headersString",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: "Authorization: token",
        } as never,
        expected: "headers must be an object with string values",
      },
      {
        serverName: "headersNumber",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: 123,
        } as never,
        expected: "headers must be an object with string values",
      },
    ];

    for (const { serverName, config, expected } of cases) {
      const manager = new McpManager();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await manager.initialize({
          mcpServers: { [serverName]: config },
        });

        expect(manager.getServerCount()).toBe(0);
        const errorOutput = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
        expect(errorOutput).toContain(`MCP server "${serverName}" failed to connect`);
        expect(errorOutput).toContain(expected);
      } finally {
        errorSpy.mockRestore();
      }
    }
  });

  it("routes MCP progress side-channel events without mutating the tool result", async () => {
    const manager = new McpManager();
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
            protocolVersion: "DRAFT-2026-v1",
            capabilities: { tools: {} },
            serverInfo: { name: "progress-srv" },
          }});
        } else if (msg.method === "tools/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "long", description: "Long task", inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "tools/call" && msg.params.name === "long") {
          const token = msg.params?._meta?.progressToken;
          write({ jsonrpc: "2.0", method: "notifications/progress", params: {
            progressToken: token,
            progress: 1,
            total: 2,
            message: "half",
          }});
          write({ jsonrpc: "2.0", method: "notifications/progress", params: {
            progressToken: token,
            progress: 2,
            total: 2,
            message: "done",
          }});
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "complete",
            content: [{ type: "text", text: "final result" }],
            isError: false,
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });
    const progressEvents: Array<{ server: string; tool: string; progress: number; message?: string }> = [];

    const result = await manager.executeTool("mcp__remote__long", {}, {
      progressResolver: (event) => {
        progressEvents.push({
          server: event.server,
          tool: event.tool,
          progress: event.progress,
          ...(event.message !== undefined ? { message: event.message } : {}),
        });
      },
    });

    expect(result.content).toBe("final result");
    expect(result._meta).toBeUndefined();
    expect(progressEvents).toEqual([
      { server: "progress-srv", tool: "long", progress: 1, message: "half" },
      { server: "progress-srv", tool: "long", progress: 2, message: "done" },
    ]);

    await manager.close();
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
            capabilities: { tools: {} },
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
            capabilities: { tools: {} },
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
            capabilities: { tools: {} },
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
              capabilities: { tools: {} },
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
            capabilities: { tools: {} },
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
            capabilities: { tools: {} },
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
            capabilities: { tools: {} },
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
            capabilities: { tools: {} },
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
