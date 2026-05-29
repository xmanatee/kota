import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModuleLoader } from "#core/modules/module-loader.js";
import {
  AGENT_SKILLS_DISCOVERY_SCHEMA,
  MCP_CURRENT_PROTOCOL_VERSION,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_SKILL_INDEX_RESOURCE_URI,
  MCP_SKILLS_EXTENSION_ID,
  MCP_TASKS_EXTENSION_ID,
  mcpOAuthSecret,
} from "./client.js";
import { type McpInputResolver, McpManager, namespaceTool, parseToolName } from "./manager.js";
import { FileRemoteMcpTaskStore } from "./remote-task-store.js";

type RecordedHttpRequest = {
  url: string;
  method: string;
  headers: Headers;
  bodyText: string;
  body: {
    id?: number;
    method?: string;
    params?: Record<string, any>;
  };
  form: URLSearchParams;
};

function privateKeyJwtTestPrivateKey(): string {
  const keyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return keyPair.privateKey;
}

function privateKeyJwtEcPrivateKey(): string {
  const keyPair = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return keyPair.privateKey;
}

function base64UrlJson(value: Record<string, any>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fakeEnterpriseIdJagJwt(): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return [
    base64UrlJson({ typ: "oauth-id-jag+jwt", alg: "none" }),
    base64UrlJson({
      iss: "https://idp.example.test",
      sub: "user-1",
      aud: "https://auth.example.test",
      resource: "https://mcp.example.test/mcp",
      client_id: "kota-client",
      jti: "id-jag-1",
      iat: nowSeconds,
      exp: nowSeconds + 300,
      scope: "files:read",
    }),
    "signature",
  ].join(".");
}

function mockMcpHttpFetch(
  handler: (request: RecordedHttpRequest) => Response,
): {
  requests: RecordedHttpRequest[];
  fetchSpy: { mockRestore: () => void };
} {
  const requests: RecordedHttpRequest[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const bodyText = String(init?.body ?? "");
    const body = bodyText.startsWith("{") ? JSON.parse(bodyText) : {};
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      bodyText,
      body,
      form: new URLSearchParams(bodyText),
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

function jsonRpcErrorResponse(
  id: number | undefined,
  code: number,
  message: string,
  data?: Record<string, any>,
): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseMessage(message: Record<string, any>): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function remoteTaskStorePath(projectDir: string): string {
  return join(projectDir, ".kota", "mcp-remote-tasks.json");
}

function readRemoteTaskStore(projectDir: string): { tasks: Array<Record<string, any>> } {
  return JSON.parse(readFileSync(remoteTaskStorePath(projectDir), "utf-8"));
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

async function waitForResult<T>(
  read: () => Promise<T>,
  assertion: (value: T) => void,
  timeoutMs = 2_000,
): Promise<T> {
  const started = Date.now();
  let lastError: Error | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await read();
      assertion(value);
      return value;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError ?? new Error("Timed out waiting for result");
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
          return expectElicitation
            ? {
                extensions: { "io.modelcontextprotocol/tasks": {} },
                elicitation: { form: {}, url: {} },
              }
            : {};
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
        ? {
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
            elicitation: { form: {}, url: {} },
          }
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
            tools: [{
              name: "ping",
              description: "Pings",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true, idempotentHint: true },
            }],
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
    expect(manager.isToolReadOnly("mcp__test-srv__ping")).toBe(true);
    expect(manager.isToolReadOnly("mcp__test-srv__missing")).toBe(false);

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
        const expectedProtocolVersion = request.body.method === "server/discover"
          ? MCP_CURRENT_PROTOCOL_VERSION
          : MCP_DRAFT_PROTOCOL_VERSION;
        expect(request.headers.get("mcp-protocol-version")).toBe(expectedProtocolVersion);
        expect(request.headers.get("mcp-method")).toBe(request.body.method);
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        expect(request.body.params?._meta).toMatchObject({
          "io.modelcontextprotocol/protocolVersion": expectedProtocolVersion,
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

  it("polls remote task-backed tool calls, routes task input through tasks/update, and returns the final result", async () => {
    let pollCount = 0;
    const { requests, fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          },
          serverInfo: { name: "task-http-fixture" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "deploy", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        expect(request.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"]).toMatchObject({
          extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
        });
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "task-deploy-1",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: null,
          pollIntervalMs: 1,
        });
      }
      if (request.body.method === "tasks/get") {
        pollCount += 1;
        if (pollCount === 1) {
          return jsonRpcResponse(request.body.id, {
            resultType: "task",
            taskId: "task-deploy-1",
            status: "input_required",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:01.000Z",
            ttlMs: null,
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: { mode: "form", message: "Deploy?" },
              },
            },
            requestState: "remote-task-state",
          });
        }
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "task-deploy-1",
          status: "completed",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:02.000Z",
          ttlMs: null,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "deployed" }],
            structuredContent: { deploymentId: "dep-1" },
          },
        });
      }
      if (request.body.method === "tasks/update") {
        expect(request.body.params).toMatchObject({
          taskId: "task-deploy-1",
          requestState: "remote-task-state",
          inputResponses: {
            approval: { action: "accept", content: { approved: true } },
          },
        });
        return jsonRpcResponse(request.body.id, {});
      }
      return jsonRpcErrorResponse(request.body.id, -32601, `unknown ${request.body.method}`);
    });
    const tmpDir = mkdtempSync(join(tmpdir(), "kota-mcp-task-store-"));
    const manager = new McpManager({
      remoteTaskStore: new FileRemoteMcpTaskStore(tmpDir),
    });

    try {
      await manager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      }, { inputResolverAvailable: true });

      const seenRequests: unknown[] = [];
      const result = await manager.executeTool("mcp__remote__deploy", {}, {
        inputResolver: async (request) => {
          const persisted = readFileSync(remoteTaskStorePath(tmpDir), "utf-8");
          expect(persisted).toContain('"status": "input_required"');
          expect(persisted).not.toContain("remote-task-state");
          expect(persisted).not.toContain("Deploy?");
          seenRequests.push(request);
          return {
            kind: "respond",
            inputResponses: {
              approval: { action: "accept", content: { approved: true } },
            },
          };
        },
      });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toBe("deployed");
      expect(result.structuredContent).toEqual({ deploymentId: "dep-1" });
      expect(result._meta?.mcpTask).toMatchObject({
        resultType: "task",
        server: "task-http-fixture",
        tool: "deploy",
        taskId: "task-deploy-1",
        status: "completed",
        pollCount: 2,
        inputUpdateCount: 1,
      });
      expect(seenRequests).toEqual([
        {
          server: "task-http-fixture",
          tool: "deploy",
          inputRequests: {
            approval: {
              method: "elicitation/create",
              params: { mode: "form", message: "Deploy?" },
            },
          },
          requestState: "remote-task-state",
        },
      ]);
      expect(requests.map((request) => request.body.method)).toEqual([
        "server/discover",
        "tools/list",
        "tools/call",
        "tasks/get",
        "tasks/update",
        "tasks/get",
      ]);
      expect(requests[2].headers.get("mcp-name")).toBe("deploy");
      for (const request of requests.slice(3)) {
        expect(request.headers.get("mcp-name")).toBe("task-deploy-1");
      }
      expect(readRemoteTaskStore(tmpDir).tasks).toEqual([]);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("persists unfinished remote task handles and resumes them after reconnect", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kota-mcp-task-resume-"));
    let phase: "first-run" | "resume" = "first-run";
    const { requests, fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          },
          serverInfo: { name: "resumable-http-fixture" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "deploy", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "task-resume-1",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: null,
          pollIntervalMs: 1,
        });
      }
      if (request.body.method === "tasks/get" && phase === "first-run") {
        return jsonRpcErrorResponse(request.body.id, -32055, "connection dropped before terminal state");
      }
      if (request.body.method === "tasks/get" && phase === "resume") {
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "task-resume-1",
          status: "completed",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:03.000Z",
          ttlMs: null,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "deployed after restart" }],
            structuredContent: { deploymentId: "dep-resumed" },
          },
        });
      }
      return jsonRpcErrorResponse(request.body.id, -32601, `unknown ${request.body.method}`);
    });

    try {
      const firstManager = new McpManager({
        remoteTaskStore: new FileRemoteMcpTaskStore(tmpDir),
      });
      await firstManager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      }, { inputResolverAvailable: true });

      const firstResult = await firstManager.executeTool("mcp__remote__deploy", {});
      expect(firstResult.is_error).toBe(true);
      expect(firstResult.content).toContain("connection dropped");
      await firstManager.close();

      const persistedBeforeResume = readRemoteTaskStore(tmpDir);
      expect(persistedBeforeResume.tasks).toHaveLength(1);
      expect(persistedBeforeResume.tasks[0]).toMatchObject({
        serverConfigName: "remote",
        serverDisplayName: "resumable-http-fixture",
        toolName: "deploy",
        taskId: "task-resume-1",
        status: "working",
      });
      const persistedJson = readFileSync(remoteTaskStorePath(tmpDir), "utf-8");
      expect(persistedJson).not.toContain("deployed after restart");
      expect(persistedJson).not.toContain("dep-resumed");

      phase = "resume";
      const secondManager = new McpManager({
        remoteTaskStore: new FileRemoteMcpTaskStore(tmpDir),
      });
      await secondManager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      }, { inputResolverAvailable: true });

      const [resumeResult] = secondManager.getRemoteTaskResumeResults();
      expect(resumeResult).toMatchObject({
        kind: "result",
        serverConfigName: "remote",
        serverDisplayName: "resumable-http-fixture",
        tool: "deploy",
        taskId: "task-resume-1",
      });
      if (resumeResult?.kind !== "result") {
        throw new Error("expected remote task resume result");
      }
      expect(resumeResult.result.is_error).toBeUndefined();
      expect(resumeResult.result.content).toBe("deployed after restart");
      expect(resumeResult.result.structuredContent).toEqual({ deploymentId: "dep-resumed" });
      expect(readRemoteTaskStore(tmpDir).tasks).toEqual([]);
      await secondManager.close();

      expect(requests.map((request) => request.body.method)).toEqual([
        "server/discover",
        "tools/list",
        "tools/call",
        "tasks/get",
        "server/discover",
        "tools/list",
        "tasks/get",
      ]);
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps unmatched persisted remote task handles as safe diagnostics", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kota-mcp-task-missing-server-"));
    const store = new FileRemoteMcpTaskStore(tmpDir);
    await store.upsert({
      id: "stored-task-1",
      serverConfigName: "missing",
      serverDisplayName: "missing-server",
      serverFingerprint: "stale-fingerprint",
      serverMatch: { kind: "safe" },
      toolName: "deploy",
      taskId: "task-missing-server",
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      status: "working",
      createdAt: "2026-05-25T12:00:00.000Z",
      lastUpdatedAt: "2026-05-25T12:00:00.000Z",
      ttlMs: null,
      pollCount: 0,
      inputUpdateCount: 0,
      startedAt: "2026-05-25T12:00:00.000Z",
      deadlineAt: null,
      updatedAt: "2026-05-25T12:00:00.000Z",
    });
    const manager = new McpManager({ remoteTaskStore: store });

    try {
      await manager.initialize({ mcpServers: {} }, { inputResolverAvailable: true });

      expect(manager.getRemoteTaskResumeResults()).toEqual([
        {
          kind: "diagnostic",
          serverConfigName: "missing",
          serverDisplayName: "missing-server",
          tool: "deploy",
          taskId: "task-missing-server",
          message: 'configured MCP server "missing" is not present; remote task was not resumed',
        },
      ]);
      expect(readRemoteTaskStore(tmpDir).tasks[0]?.lastDiagnostic).toContain(
        "not present",
      );
    } finally {
      await manager.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects task-backed tool calls when Tasks was not negotiated", async () => {
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "async", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "unnegotiated-task",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: 60000,
          pollIntervalMs: 1,
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

      const result = await manager.executeTool("mcp__remote__async", {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("without negotiated io.modelcontextprotocol/tasks support");
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("surfaces unknown remote task ids without leaking bearer tokens", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "kota-mcp-task-redaction-"));
    const { requests, fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "missing_task", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "missing-task",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: 60000,
          pollIntervalMs: 1,
        });
      }
      if (request.body.method === "tasks/get") {
        return jsonRpcErrorResponse(
          request.body.id,
          -32004,
          "unknown task for Bearer configured-token-secret",
        );
      }
      return jsonRpcResponse(request.body.id, {});
    });
    const manager = new McpManager({
      remoteTaskStore: new FileRemoteMcpTaskStore(tmpDir),
    });

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            headers: { Authorization: "Bearer configured-token-secret" },
          },
        },
      }, { inputResolverAvailable: true });

      const result = await manager.executeTool("mcp__remote__missing_task", {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("unknown task for [redacted]");
      expect(result.content).not.toContain("configured-token-secret");
      const persisted = readFileSync(remoteTaskStorePath(tmpDir), "utf-8");
      expect(persisted).toContain("missing-task");
      expect(persisted).not.toContain("configured-token-secret");
      expect(persisted).not.toContain("Bearer configured-token-secret");
      await manager.close();

      const resumed = new McpManager({
        remoteTaskStore: new FileRemoteMcpTaskStore(tmpDir),
      });
      await resumed.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            headers: { Authorization: "Bearer configured-token-secret" },
          },
        },
      }, { inputResolverAvailable: true });
      const [resumeResult] = resumed.getRemoteTaskResumeResults();
      expect(resumeResult).toMatchObject({
        kind: "diagnostic",
        taskId: "missing-task",
      });
      if (resumeResult?.kind !== "diagnostic") {
        throw new Error("expected remote task resume diagnostic");
      }
      expect(resumeResult.message).toContain("HTTP headers contain values");
      expect(requests.filter((request) => request.body.method === "tasks/get")).toHaveLength(1);
      await resumed.close();
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles TTL expiry, failed states, and cancelled states as task errors", async () => {
    for (const scenario of ["timeout", "failed", "cancelled"] as const) {
      const tmpDir = mkdtempSync(join(tmpdir(), `kota-mcp-task-${scenario}-`));
      const { fetchSpy } = mockMcpHttpFetch((request) => {
        if (request.body.method === "server/discover") {
          return jsonRpcResponse(request.body.id, {
            supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
            capabilities: {
              tools: {},
              extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
            },
          });
        }
        if (request.body.method === "tools/list") {
          return jsonRpcResponse(request.body.id, {
            tools: [{ name: scenario, inputSchema: { type: "object" } }],
          });
        }
        if (request.body.method === "tools/call") {
          return jsonRpcResponse(request.body.id, {
            resultType: "task",
            taskId: `task-${scenario}`,
            status: "working",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:00.000Z",
            ttlMs: scenario === "timeout" ? 1 : 60000,
            pollIntervalMs: 1,
          });
        }
        if (request.body.method === "tasks/get") {
          if (scenario === "failed") {
            return jsonRpcResponse(request.body.id, {
              taskId: "task-failed",
              status: "failed",
              createdAt: "2026-05-25T12:00:00.000Z",
              lastUpdatedAt: "2026-05-25T12:00:01.000Z",
              ttlMs: 60000,
              pollIntervalMs: 1,
              error: {
                code: -32001,
                message: "remote failure leaked payload-secret",
                data: { payload: "payload-secret" },
              },
            });
          }
          if (scenario === "cancelled") {
            return jsonRpcResponse(request.body.id, {
              taskId: "task-cancelled",
              status: "cancelled",
              createdAt: "2026-05-25T12:00:00.000Z",
              lastUpdatedAt: "2026-05-25T12:00:01.000Z",
              ttlMs: 60000,
              pollIntervalMs: 1,
            });
          }
          return jsonRpcResponse(request.body.id, {
            taskId: "task-timeout",
            status: "working",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:01.000Z",
            ttlMs: 1,
            pollIntervalMs: 1,
          });
        }
        return jsonRpcResponse(request.body.id, {});
      });
      const manager = new McpManager({
        remoteTaskStore: new FileRemoteMcpTaskStore(tmpDir),
      });

      try {
        await manager.initialize({
          mcpServers: {
            remote: { type: "http", url: "https://mcp.example.test/mcp" },
          },
        }, { inputResolverAvailable: true });

        const result = await manager.executeTool(`mcp__remote__${scenario}`, {});
        expect(result.is_error).toBe(true);
        expect(result._meta?.mcpTask).toMatchObject({
          resultType: "task",
          taskId: `task-${scenario}`,
        });
        if (scenario === "timeout") {
          expect(result.content).toContain("ttlMs=1");
        } else {
          expect(result.content).toContain(scenario === "failed" ? "failed" : "cancelled");
        }
        expect(result.content).not.toContain("payload-secret");
        expect(JSON.stringify(result._meta)).not.toContain("payload-secret");
        expect(readRemoteTaskStore(tmpDir).tasks).toEqual([]);
      } finally {
        await manager.close();
        fetchSpy.mockRestore();
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  it("sanitizes task input update failures without leaking operator input responses", async () => {
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "needs_input", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "task-input-error",
          status: "input_required",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:01.000Z",
          ttlMs: 60000,
          pollIntervalMs: 1,
          inputRequests: {
            secret: {
              method: "elicitation/create",
              params: { mode: "form", message: "Secret?" },
            },
          },
        });
      }
      if (request.body.method === "tasks/update") {
        return jsonRpcErrorResponse(
          request.body.id,
          -32030,
          "bad response contained operator-secret-value",
        );
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

      const result = await manager.executeTool("mcp__remote__needs_input", {}, {
        inputResolver: async () => ({
          kind: "respond",
          inputResponses: {
            secret: { action: "accept", content: { value: "operator-secret-value" } },
          },
        }),
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("remote task input update failed");
      expect(result.content).not.toContain("operator-secret-value");
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("requests remote task cancellation when the tool call is aborted", async () => {
    const controller = new AbortController();
    const { requests, fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "long_task", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        setTimeout(() => controller.abort(), 0);
        return jsonRpcResponse(request.body.id, {
          resultType: "task",
          taskId: "task-abort",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: 60000,
          pollIntervalMs: 1000,
        });
      }
      if (request.body.method === "tasks/cancel") {
        return jsonRpcResponse(request.body.id, {});
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

      const result = await manager.executeTool("mcp__remote__long_task", {}, {
        signal: controller.signal,
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("aborted by the operator");
      expect(requests.map((request) => request.body.method)).toContain("tasks/cancel");
      const cancel = requests.find((request) => request.body.method === "tasks/cancel");
      expect(cancel?.body.params?.taskId).toBe("task-abort");
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("refreshes the registry when an HTTP MCP server sends tools/list_changed on subscriptions/listen", async () => {
    const encoder = new TextEncoder();
    let listCount = 0;
    let subscription: ReadableStreamDefaultController<Uint8Array> | null = null;
    let subscriptionId = "";
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "http-dynamic" },
        });
      }
      if (request.body.method === "subscriptions/listen") {
        expect(request.body.params?.notifications).toEqual({ toolsListChanged: true });
        subscriptionId = String(request.body.id);
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            subscription = controller;
            controller.enqueue(encoder.encode(sseMessage({
              jsonrpc: "2.0",
              method: "notifications/subscriptions/acknowledged",
              params: {
                _meta: {
                  "io.modelcontextprotocol/subscriptionId": String(request.body.id),
                },
                notifications: { toolsListChanged: true },
              },
            })));
          },
        }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (request.body.method === "tools/list") {
        listCount += 1;
        return jsonRpcResponse(request.body.id, {
          tools: [{
            name: listCount === 1 ? "old_tool" : "new_tool",
            inputSchema: { type: "object" },
          }],
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          content: [{ type: "text", text: `${request.body.params?.name} route` }],
        });
      }
      return jsonRpcResponse(request.body.id, {});
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          dynamic: {
            type: "http",
            url: "https://mcp.example.test/mcp",
          },
        },
      });

      expect(manager.getTools().map((tool) => tool.name)).toEqual([
        "mcp__dynamic__old_tool",
      ]);
      expect(subscription).not.toBeNull();
      subscription!.enqueue(encoder.encode(sseMessage({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: {
          _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
        },
      })));

      await waitFor(() => {
        expect(manager.getTools().map((tool) => tool.name)).toEqual([
          "mcp__dynamic__new_tool",
        ]);
      });

      const removed = await manager.executeTool("mcp__dynamic__old_tool", {});
      expect(removed.is_error).toBe(true);
      const refreshed = await manager.executeTool("mcp__dynamic__new_tool", {});
      expect(refreshed.content).toBe("new_tool route");
      expect(fetchSpy).toHaveBeenCalled();
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

  it("accepts explicit Streamable HTTP OAuth client credentials config", async () => {
    let resolverCalled = false;
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        expect(request.form.get("grant_type")).toBe("client_credentials");
        expect(request.form.get("resource")).toBe("https://mcp.example.test/mcp");
        expect(request.form.get("scope")).toBe("files:read");
        return new Response(JSON.stringify({
          access_token: "access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            authorization: {
              type: "oauth-client-credentials",
              issuer: "https://auth.example.test",
              scopes: ["files:read"],
              tokenEndpointAuthMethod: "client_secret_basic",
              client: {
                kind: "registered",
                clientId: "kota-client",
                clientSecret: "client-secret",
              },
            },
          },
        },
      }, {
        authorizationResolver: async (request) => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=unused&state=${request.state}`),
          };
        },
      });

      expect(manager.getServerCount()).toBe(1);
      expect(manager.getTools().map((tool) => tool.name)).toEqual(["mcp__remote__read_file"]);
      expect(resolverCalled).toBe(false);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("accepts explicit Streamable HTTP OAuth private_key_jwt client credentials config", async () => {
    const privateKeyPem = privateKeyJwtTestPrivateKey();
    let resolverCalled = false;
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.form.get("grant_type")).toBe("client_credentials");
        expect(request.form.get("resource")).toBe("https://mcp.example.test/mcp");
        expect(request.form.get("scope")).toBe("files:read");
        expect(request.form.get("client_assertion_type")).toBe(
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        );
        expect(request.form.get("client_assertion")).toMatch(
          /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
        );
        return new Response(JSON.stringify({
          access_token: "access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            authorization: {
              type: "oauth-client-credentials",
              issuer: "https://auth.example.test",
              scopes: ["files:read"],
              tokenEndpointAuthMethod: "private_key_jwt",
              client: {
                kind: "registered",
                clientId: "kota-client",
                privateKeyPem,
                signingAlgorithm: "RS256",
              },
            },
          },
        },
      }, {
        authorizationResolver: async (request) => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=unused&state=${request.state}`),
          };
        },
      });

      expect(manager.getServerCount()).toBe(1);
      expect(manager.getTools().map((tool) => tool.name)).toEqual(["mcp__remote__read_file"]);
      expect(resolverCalled).toBe(false);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("accepts explicit Streamable HTTP enterprise-managed authorization config", async () => {
    let resolverCalled = false;
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://idp.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://idp.example.test",
          token_endpoint: "https://idp.example.test/token",
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          scopes_supported: ["files:read"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://idp.example.test/token") {
        expect(request.form.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:token-exchange",
        );
        expect(request.form.get("subject_token")).toBe("identity-assertion-secret");
        return new Response(JSON.stringify({
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          access_token: fakeEnterpriseIdJagJwt(),
          token_type: "N_A",
          scope: "files:read",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        expect(request.form.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        );
        return new Response(JSON.stringify({
          access_token: "access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing enterprise token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            authorization: {
              type: "enterprise-managed",
              issuer: "https://auth.example.test",
              resource: "https://mcp.example.test/mcp",
              scopes: ["files:read"],
              identityProvider: {
                issuer: "https://idp.example.test",
                tokenEndpoint: "https://idp.example.test/token",
              },
              subjectToken: {
                tokenType: "urn:ietf:params:oauth:token-type:id_token",
                source: { kind: "static", token: "identity-assertion-secret" },
              },
              tokenEndpointAuthMethod: "client_secret_basic",
              client: {
                kind: "registered",
                clientId: "kota-client",
                clientSecret: "client-secret",
              },
            },
          },
        },
      }, {
        authorizationResolver: async (request) => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=unused&state=${request.state}`),
          };
        },
      });

      expect(manager.getServerCount()).toBe(1);
      expect(manager.getTools().map((tool) => tool.name)).toEqual(["mcp__remote__read_file"]);
      expect(resolverCalled).toBe(false);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
    }
  });

  it("redacts acquired OAuth bearer tokens from manager connection diagnostics", async () => {
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          authorization_endpoint: "https://auth.example.test/authorize",
          token_endpoint: "https://auth.example.test/token",
          code_challenge_methods_supported: ["S256"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        return new Response(JSON.stringify({
          access_token: "access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return new Response("upstream echoed access-token-secret", {
          status: 500,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    const manager = new McpManager();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            authorization: {
              type: "oauth",
              issuer: "https://auth.example.test",
              redirectUri: "https://client.example.test/callback",
              scopes: ["files:read"],
              client: { kind: "registered", clientId: "kota-client" },
            },
          },
        },
      }, {
        authorizationResolver: async (request) => ({
          callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-1&state=${request.state}`),
        }),
      });

      expect(manager.getServerCount()).toBe(0);
      const output = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain('MCP server "remote" failed to connect');
      expect(output).toContain("upstream echoed [redacted]");
      expect(output).not.toContain("access-token-secret");
    } finally {
      errorSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("redacts malformed OAuth token JSON from manager connection diagnostics", async () => {
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        return new Response(`${request.headers.get("authorization")} client-secret`, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    const manager = new McpManager();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            type: "http",
            url: "https://mcp.example.test/mcp",
            authorization: {
              type: "oauth-client-credentials",
              issuer: "https://auth.example.test",
              scopes: ["files:read"],
              tokenEndpointAuthMethod: "client_secret_basic",
              client: {
                kind: "registered",
                clientId: "kota-client",
                clientSecret: "client-secret",
              },
            },
          },
        },
      });

      expect(manager.getServerCount()).toBe(0);
      const output = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain('MCP server "remote" failed to connect');
      expect(output).toContain("token endpoint returned malformed JSON");
      expect(output).not.toMatch(/client-secret|client-sec|Basic a290|a290YS1jb/);
    } finally {
      await manager.close();
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
        "mcp_skills__remote__list",
        "mcp_skills__remote__read",
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
        cache: { ttlMs: 0, cacheScope: "private" },
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

  it("exposes MCP-served skills as explicit list and read operations with untrusted provenance", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-remote-skills-"));
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            resources: {},
            extensions: { [MCP_SKILLS_EXTENSION_ID]: {} },
          },
          serverInfo: { name: "skill-server" },
        });
      }
      if (request.body.method === "resources/list") {
        return jsonRpcResponse(request.body.id, {
          resources: [{ uri: MCP_SKILL_INDEX_RESOURCE_URI, name: "Agent Skills Index" }],
        });
      }
      if (request.body.method === "resources/read") {
        if (request.body.params?.uri === MCP_SKILL_INDEX_RESOURCE_URI) {
          return jsonRpcResponse(request.body.id, {
            resultType: "complete",
            contents: [{
              uri: MCP_SKILL_INDEX_RESOURCE_URI,
              mimeType: "application/json",
              text: JSON.stringify({
                $schema: AGENT_SKILLS_DISCOVERY_SCHEMA,
                skills: [
                  {
                    name: "git-workflow",
                    type: "skill-md",
                    description: "Follow Git workflow",
                    url: "skill://git-workflow/SKILL.md",
                  },
                  {
                    type: "mcp-resource-template",
                    description: "Generated API skill",
                    url: "skill://api/{endpoint}/SKILL.md",
                  },
                ],
              }),
            }],
            ttlMs: 60_000,
            cacheScope: "public",
          });
        }
        if (request.body.params?.uri === "skill://git-workflow/references/guide.md") {
          return jsonRpcResponse(request.body.id, {
            resultType: "complete",
            contents: [{
              uri: "skill://git-workflow/references/guide.md",
              mimeType: "text/markdown",
              text: "Reference guidance.",
            }],
          });
        }
        return jsonRpcResponse(request.body.id, {
          resultType: "complete",
          contents: [{
            uri: request.body.params?.uri,
            mimeType: "text/markdown",
            text: "---\nname: git-workflow\n---\nRemote skill guidance.",
          }],
        });
      }
      return jsonRpcResponse(request.body.id, {});
    });
    const manager = new McpManager({ projectDir });

    try {
      await manager.initialize({
        mcpServers: {
          remote: { type: "http", url: "https://mcp.example.test/mcp" },
        },
      });

      expect(manager.getTools().map((tool) => tool.name)).toContain("mcp_skills__remote__list");
      expect(manager.getTools().map((tool) => tool.name)).toContain("mcp_skills__remote__read");

      const skills = await manager.executeTool("mcp_skills__remote__list", {});
      expect(skills.structuredContent).toMatchObject({
        server: "remote",
        displayName: "skill-server",
        status: "enumerated",
        advertised: true,
        enumerationExhaustive: false,
        skills: [
          {
            type: "skill-md",
            name: "git-workflow",
            uri: "skill://git-workflow/SKILL.md",
            source: "enumerated",
          },
          {
            type: "mcp-resource-template",
            uriTemplate: "skill://api/{endpoint}/SKILL.md",
            source: "enumerated",
          },
        ],
      });

      const byName = await manager.executeTool("mcp_skills__remote__read", {
        name: "git-workflow",
      });
      expect(byName.structuredContent).toMatchObject({
        resultType: "complete",
        provenance: {
          server: "skill-server",
          uri: "skill://git-workflow/SKILL.md",
          source: "enumerated",
          untrusted: true,
        },
        contents: [{
          uri: "skill://git-workflow/SKILL.md",
          text: "---\nname: git-workflow\n---\nRemote skill guidance.",
          textTruncated: false,
        }],
      });

      const sibling = await manager.executeTool("mcp_skills__remote__read", {
        name: "git-workflow",
        relativePath: "references/guide.md",
      });
      expect(sibling.structuredContent).toMatchObject({
        provenance: {
          uri: "skill://git-workflow/references/guide.md",
          source: "enumerated",
        },
        contents: [{ text: "Reference guidance." }],
      });

      const direct = await manager.executeTool("mcp_skills__remote__read", {
        uri: "skill://uri-only/SKILL.md",
      });
      expect(direct.structuredContent).toMatchObject({
        provenance: {
          uri: "skill://uri-only/SKILL.md",
          source: "direct",
          untrusted: true,
        },
      });

      const unresolvedTemplate = await manager.executeTool("mcp_skills__remote__read", {
        uri: "skill://api/{endpoint}/SKILL.md",
      });
      expect(unresolvedTemplate.is_error).toBe(true);
      expect(unresolvedTemplate.content).toContain("URI templates must be resolved before reading");

      expect(existsSync(join(projectDir, ".kota", "skills"))).toBe(false);
      const loader = new ModuleLoader({});
      loader.setCwd(projectDir);
      await loader.load({ name: "empty-module" });
      expect(loader.getSkillsPromptFor("all", "builder")).not.toContain("Remote skill guidance");
      expect(loader.getSkillsPromptFor(["git-workflow"], "builder")).not.toContain("Remote skill guidance");
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("refreshes cached MCP-served skill catalogs after resource list-changed notifications", async () => {
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      let subscriptionId = null;
      let indexReads = 0;
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      function skillIndex(name) {
        return {
          $schema: "${AGENT_SKILLS_DISCOVERY_SCHEMA}",
          skills: [{
            name,
            type: "skill-md",
            description: "Skill " + name,
            url: "skill://" + name + "/SKILL.md",
          }],
        };
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {
              resources: { listChanged: true },
              extensions: { "io.modelcontextprotocol/skills": {} },
            },
            serverInfo: { name: "skill-cache-server" },
          }});
          return;
        }
        if (msg.method === "notifications/initialized") return;
        if (msg.method === "subscriptions/listen") {
          subscriptionId = String(msg.id);
          write({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            notifications: { resourcesListChanged: true },
          }});
          return;
        }
        if (msg.method === "resources/read") {
          indexReads += 1;
          const name = indexReads === 1 ? "first-skill" : "second-skill";
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "complete",
            contents: [{ uri: "skill://index.json", text: JSON.stringify(skillIndex(name)) }],
            ttlMs: 60000,
            cacheScope: "public",
          }});
          if (indexReads === 1) {
            setTimeout(() => write({ jsonrpc: "2.0", method: "notifications/resources/list_changed", params: {
              _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            }}), 20);
          }
          return;
        }
        if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
          return;
        }
        write({ jsonrpc: "2.0", id: msg.id, result: {} });
      });
    `;
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: { command: "node", args: ["-e", server] },
        },
      });

      const first = await manager.executeTool("mcp_skills__remote__list", {});
      expect(first.structuredContent).toMatchObject({
        skills: [{ name: "first-skill" }],
      });
      const cached = await manager.executeTool("mcp_skills__remote__list", {});
      expect(cached.structuredContent).toEqual(first.structuredContent);
      expect(cached._meta).toMatchObject({
        mcp: { cache: [{ source: "cache", reason: "fresh" }] },
      });

      const refreshed = await waitForResult(
        () => manager.executeTool("mcp_skills__remote__list", {}),
        (result) => {
          expect(result.structuredContent).toMatchObject({
            skills: [{ name: "second-skill" }],
          });
        },
      );
      expect(refreshed._meta).toMatchObject({
        mcp: { cache: [{ source: "server", reason: "list_changed" }] },
      });
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("reuses fresh cached resource and prompt list pages and refreshes them after TTL expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T12:00:00.000Z"));
    let resourceListCalls = 0;
    let promptListCalls = 0;
    const { fetchSpy } = mockMcpHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {}, prompts: {} },
          serverInfo: { name: "cache-server" },
        });
      }
      if (request.body.method === "resources/list") {
        resourceListCalls += 1;
        return jsonRpcResponse(request.body.id, {
          resources: [{ uri: `file:///tmp/resource-${resourceListCalls}.md`, name: `resource-${resourceListCalls}` }],
          ttlMs: 1_000,
          cacheScope: "private",
        });
      }
      if (request.body.method === "prompts/list") {
        promptListCalls += 1;
        return jsonRpcResponse(request.body.id, {
          prompts: [{ name: `prompt-${promptListCalls}` }],
          ttlMs: 1_000,
          cacheScope: "public",
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

      const firstResources = await manager.executeTool("mcp_resources__remote__list", {});
      expect(firstResources.structuredContent).toEqual({
        resources: [{ uri: "file:///tmp/resource-1.md", name: "resource-1" }],
      });
      expect(firstResources._meta).toMatchObject({
        mcp: {
          cache: [{
            operation: "resources/list",
            source: "server",
            reason: "missing",
            ttlMs: 1_000,
            cacheScope: "private",
          }],
        },
      });

      const secondResources = await manager.executeTool("mcp_resources__remote__list", {});
      expect(secondResources.structuredContent).toEqual(firstResources.structuredContent);
      expect(secondResources._meta).toMatchObject({
        mcp: { cache: [{ source: "cache", reason: "fresh" }] },
      });
      expect(resourceListCalls).toBe(1);

      const firstPrompts = await manager.executeTool("mcp_prompts__remote__list", {});
      const secondPrompts = await manager.executeTool("mcp_prompts__remote__list", {});
      expect(secondPrompts.structuredContent).toEqual(firstPrompts.structuredContent);
      expect(secondPrompts._meta).toMatchObject({
        mcp: { cache: [{ operation: "prompts/list", source: "cache", reason: "fresh" }] },
      });
      expect(promptListCalls).toBe(1);

      vi.advanceTimersByTime(1_001);

      const expiredResources = await manager.executeTool("mcp_resources__remote__list", {});
      expect(expiredResources.structuredContent).toEqual({
        resources: [{ uri: "file:///tmp/resource-2.md", name: "resource-2" }],
      });
      expect(expiredResources._meta).toMatchObject({
        mcp: { cache: [{ source: "server", reason: "expired" }] },
      });
      expect(resourceListCalls).toBe(2);

      const expiredPrompts = await manager.executeTool("mcp_prompts__remote__list", {});
      expect(expiredPrompts.structuredContent).toEqual({
        prompts: [{ name: "prompt-2" }],
      });
      expect(expiredPrompts._meta).toMatchObject({
        mcp: { cache: [{ source: "server", reason: "expired" }] },
      });
      expect(promptListCalls).toBe(2);
    } finally {
      await manager.close();
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("invalidates cached resource and prompt list pages after matching list-changed notifications", async () => {
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      let subscriptionId = null;
      let resourceListCalls = 0;
      let promptListCalls = 0;
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: { resources: { listChanged: true }, prompts: { listChanged: true } },
            serverInfo: { name: "cache-invalidation-server" },
          }});
          return;
        }
        if (msg.method === "notifications/initialized") return;
        if (msg.method === "subscriptions/listen") {
          subscriptionId = String(msg.id);
          write({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            notifications: { resourcesListChanged: true, promptsListChanged: true },
          }});
          return;
        }
        if (msg.method === "resources/list") {
          resourceListCalls += 1;
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resources: [{ uri: "file:///tmp/resource-" + resourceListCalls + ".md", name: "resource-" + resourceListCalls }],
            ttlMs: 60000,
            cacheScope: "private",
          }});
          if (resourceListCalls === 1) {
            setTimeout(() => write({ jsonrpc: "2.0", method: "notifications/resources/list_changed", params: {
              _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            }}), 20);
          }
          return;
        }
        if (msg.method === "prompts/list") {
          promptListCalls += 1;
          write({ jsonrpc: "2.0", id: msg.id, result: {
            prompts: [{ name: "prompt-" + promptListCalls }],
            ttlMs: 60000,
            cacheScope: "public",
          }});
          if (promptListCalls === 1) {
            setTimeout(() => write({ jsonrpc: "2.0", method: "notifications/prompts/list_changed", params: {
              _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            }}), 20);
          }
          return;
        }
        if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
          return;
        }
        write({ jsonrpc: "2.0", id: msg.id, result: {} });
      });
    `;
    const manager = new McpManager();

    try {
      await manager.initialize({
        mcpServers: {
          remote: { command: "node", args: ["-e", server] },
        },
      });

      const firstResources = await manager.executeTool("mcp_resources__remote__list", {});
      const cachedResources = await manager.executeTool("mcp_resources__remote__list", {});
      expect(cachedResources.structuredContent).toEqual(firstResources.structuredContent);
      expect(cachedResources._meta).toMatchObject({
        mcp: { cache: [{ source: "cache", reason: "fresh" }] },
      });

      const firstPrompts = await manager.executeTool("mcp_prompts__remote__list", {});
      const cachedPrompts = await manager.executeTool("mcp_prompts__remote__list", {});
      expect(cachedPrompts.structuredContent).toEqual(firstPrompts.structuredContent);
      expect(cachedPrompts._meta).toMatchObject({
        mcp: { cache: [{ source: "cache", reason: "fresh" }] },
      });

      const refreshedResources = await waitForResult(
        () => manager.executeTool("mcp_resources__remote__list", {}),
        (result) => {
          expect(result.structuredContent).toEqual({
            resources: [{ uri: "file:///tmp/resource-2.md", name: "resource-2" }],
          });
        },
      );
      expect(refreshedResources._meta).toMatchObject({
        mcp: { cache: [{ source: "server", reason: "list_changed" }] },
      });

      const refreshedPrompts = await waitForResult(
        () => manager.executeTool("mcp_prompts__remote__list", {}),
        (result) => {
          expect(result.structuredContent).toEqual({
            prompts: [{ name: "prompt-2" }],
          });
        },
      );
      expect(refreshedPrompts._meta).toMatchObject({
        mcp: { cache: [{ source: "server", reason: "list_changed" }] },
      });
    } finally {
      await manager.close();
    }
  }, 10_000);

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
        "mcp_skills__remote__list",
        "mcp_skills__remote__read",
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
        "mcp_skills__remote__list",
        "mcp_skills__remote__read",
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
    const privateKeyPem = privateKeyJwtTestPrivateKey();
    const ecPrivateKeyPem = privateKeyJwtEcPrivateKey();
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
        serverName: "stdioOAuthAuthorization",
        config: {
          command: "node",
          authorization: {
            type: "oauth",
            issuer: "https://auth.example.test",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            client: { kind: "registered", clientId: "kota-client" },
          },
        } as never,
        expected: "stdio transport cannot define http field authorization",
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
      {
        serverName: "mixedStaticAndOAuth",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer static-token" },
          authorization: {
            type: "oauth",
            issuer: "https://auth.example.test",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            client: { kind: "registered", clientId: "kota-client" },
          },
        } as never,
        expected: "cannot combine static Authorization headers with acquired OAuth tokens",
      },
      {
        serverName: "authCodeMixedWithClientCredentialsMethod",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth",
            issuer: "https://auth.example.test",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "client_secret_basic",
            client: { kind: "registered", clientId: "kota-client" },
          },
        } as never,
        expected: "authorization has unexpected field tokenEndpointAuthMethod",
      },
      {
        serverName: "clientCredentialsMixedWithRedirect",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        } as never,
        expected: "authorization has unexpected field redirectUri",
      },
      {
        serverName: "clientCredentialsUnsupportedMethod",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "client_secret_post",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        } as never,
        expected: "authorization.tokenEndpointAuthMethod must be client_secret_basic or private_key_jwt",
      },
      {
        serverName: "clientCredentialsMissingSecret",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
            },
          },
        } as never,
        expected: "authorization.client.clientSecret must be a non-empty string",
      },
      {
        serverName: "clientCredentialsPrivateKeyJwtMixedSecret",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "private_key_jwt",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
              privateKeyPem,
              signingAlgorithm: "RS256",
            },
          },
        } as never,
        expected: "authorization.client has unexpected field clientSecret",
      },
      {
        serverName: "clientCredentialsPrivateKeyJwtMissingKey",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "private_key_jwt",
            client: {
              kind: "registered",
              clientId: "kota-client",
              signingAlgorithm: "RS256",
            },
          },
        } as never,
        expected: "authorization.client.privateKeyPem must be a non-empty string",
      },
      {
        serverName: "clientCredentialsPrivateKeyJwtMalformedKey",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "private_key_jwt",
            client: {
              kind: "registered",
              clientId: "kota-client",
              privateKeyPem: "not a private key",
              signingAlgorithm: "RS256",
            },
          },
        } as never,
        expected: "privateKeyPem must be a valid PEM private key",
      },
      {
        serverName: "clientCredentialsPrivateKeyJwtNonRsaKey",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "private_key_jwt",
            client: {
              kind: "registered",
              clientId: "kota-client",
              privateKeyPem: ecPrivateKeyPem,
              signingAlgorithm: "RS256",
            },
          },
        } as never,
        expected: "privateKeyPem must be an RSA private key usable with RS256",
      },
      {
        serverName: "clientCredentialsPrivateKeyJwtUnsupportedAlgorithm",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "private_key_jwt",
            client: {
              kind: "registered",
              clientId: "kota-client",
              privateKeyPem,
              signingAlgorithm: "HS256",
            },
          },
        } as never,
        expected: "authorization.client.signingAlgorithm must be RS256 for private_key_jwt",
      },
      {
        serverName: "clientCredentialsDynamicClient",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: ["files:read"],
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "dynamic",
              clientName: "KOTA",
              dynamicClientRegistration: { enabled: true },
            },
          },
        } as never,
        expected: "authorization.client has unexpected fields clientName, dynamicClientRegistration",
      },
      {
        serverName: "enterpriseManagedMixedStaticAuthorization",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer static-token" },
          authorization: {
            type: "enterprise-managed",
            issuer: "https://auth.example.test",
            resource: "https://mcp.example.test/mcp",
            scopes: ["files:read"],
            identityProvider: {
              issuer: "https://idp.example.test",
              tokenEndpoint: "https://idp.example.test/token",
            },
            subjectToken: {
              tokenType: "urn:ietf:params:oauth:token-type:id_token",
              source: { kind: "static", token: "identity-assertion-secret" },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        } as never,
        expected: "cannot combine static Authorization headers with acquired OAuth tokens",
      },
      {
        serverName: "enterpriseManagedMixedRedirect",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "enterprise-managed",
            issuer: "https://auth.example.test",
            resource: "https://mcp.example.test/mcp",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            identityProvider: {
              issuer: "https://idp.example.test",
              tokenEndpoint: "https://idp.example.test/token",
            },
            subjectToken: {
              tokenType: "urn:ietf:params:oauth:token-type:id_token",
              source: { kind: "static", token: "identity-assertion-secret" },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        } as never,
        expected: "authorization has unexpected field redirectUri",
      },
      {
        serverName: "enterpriseManagedUnsupportedSubjectTokenType",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "enterprise-managed",
            issuer: "https://auth.example.test",
            resource: "https://mcp.example.test/mcp",
            scopes: ["files:read"],
            identityProvider: {
              issuer: "https://idp.example.test",
              tokenEndpoint: "https://idp.example.test/token",
            },
            subjectToken: {
              tokenType: "urn:ietf:params:oauth:token-type:access_token",
              source: { kind: "static", token: "identity-assertion-secret" },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        } as never,
        expected: "authorization.subjectToken.tokenType must be urn:ietf:params:oauth:token-type:id_token or urn:ietf:params:oauth:token-type:saml2",
      },
      {
        serverName: "enterpriseManagedMissingIdpTokenEndpoint",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "enterprise-managed",
            issuer: "https://auth.example.test",
            resource: "https://mcp.example.test/mcp",
            scopes: ["files:read"],
            identityProvider: {
              issuer: "https://idp.example.test",
            },
            subjectToken: {
              tokenType: "urn:ietf:params:oauth:token-type:id_token",
              source: { kind: "static", token: "identity-assertion-secret" },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        } as never,
        expected: "authorization.identityProvider.tokenEndpoint must be a non-empty string",
      },
      {
        serverName: "dynamicDisabled",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth",
            issuer: "https://auth.example.test",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            client: {
              kind: "dynamic",
              clientName: "KOTA",
              dynamicClientRegistration: { enabled: false },
            },
          },
        } as never,
        expected: "dynamic client registration is disabled",
      },
      {
        serverName: "clientMetadataUrlNotHttps",
        config: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth",
            issuer: "https://auth.example.test",
            redirectUri: "https://client.example.test/callback",
            scopes: ["files:read"],
            client: {
              kind: "client-id-metadata-url",
              clientId: "http://client.example.test/metadata.json",
            },
          },
        } as never,
        expected: "client-id metadata document URL must use https",
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

  it("executeTool returns a sampling-specific diagnostic without registering request-scoped tools", async () => {
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
            tools: [{ name: "agentic", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "agentic") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "input_required",
            inputRequests: {
              sample: {
                method: "sampling/createMessage",
                params: {
                  messages: [{ role: "user", content: { type: "text", text: "Use a local tool." } }],
                  maxTokens: 128,
                  tools: [
                    {
                      name: "local_weather",
                      description: "Request-scoped tool.",
                      inputSchema: { type: "object", properties: { city: { type: "string" } } },
                    },
                  ],
                  toolChoice: { mode: "auto" },
                },
              },
            },
            requestState: "sampling-state",
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    await manager.initialize({
      mcpServers: { remote: { command: "node", args: ["-e", server] } },
    });

    expect(manager.getToolCount()).toBe(1);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await manager.executeTool("mcp__remote__agentic", {});

    expect(manager.getToolCount()).toBe(1);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("sampling/createMessage");
    expect(result.content).toContain("no operator-approved sampling bridge is configured");
    expect(result._meta).toEqual({
      mcp: {
        resultType: "input_required",
        protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
        server: "remote",
        tool: "agentic",
        inputRequests: {
          sample: {
            method: "sampling/createMessage",
            params: {
              messages: [{ role: "user", content: { type: "text", text: "Use a local tool." } }],
              maxTokens: 128,
              tools: [
                {
                  name: "local_weather",
                  description: "Request-scoped tool.",
                  inputSchema: { type: "object", properties: { city: { type: "string" } } },
                },
              ],
              toolChoice: { mode: "auto" },
            },
          },
        },
        requestState: "sampling-state",
      },
    });
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('MCP server "remote"');
    expect(warnings[0]).toContain('feature "sampling"');
    expect(warnings[0]).toContain(`protocol ${MCP_DRAFT_PROTOCOL_VERSION}`);
    expect(warnings[0]).toContain("compatibility-only");
    errorSpy.mockRestore();

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
