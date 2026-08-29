import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SKILLS_DISCOVERY_SCHEMA,
  MCP_CURRENT_PROTOCOL_VERSION,
  MCP_CURRENT_STABLE_PROTOCOL_VERSIONS,
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_DRAFT_PROTOCOL_VERSIONS,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_SKILL_INDEX_RESOURCE_URI,
  MCP_SKILLS_EXTENSION_ID,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TASKS_EXTENSION_ID,
  McpAuthorizationError,
  McpAuthorizationFlowError,
  McpClient,
  McpConnectionError,
  type McpProgressEvent,
  McpToolError,
  type McpToolSchema,
  mcpOAuthSecret,
  mcpProtocolCapabilities,
  mcpProtocolSupports,
  mcpToolResultContractForProtocol,
} from "./client.js";
import {
  BOUNDED_STDIO_MCP_PEER,
  captureTerminalStderr,
  createStdioMcpPeerScript,
  expectCompletedResult,
  fakeEnterpriseIdentityProviderMetadata,
  fakeEnterpriseIdJagJwt,
  jsonRpcHttpResponse,
  mockClientHttpFetch,
  type PrivateKeyJwtPayload,
  privateKeyJwtEcPrivateKey,
  privateKeyJwtTestKeyPair,
  type RecordedClientHttpRequest,
  sseJsonRpcHttpResponse,
  sseMessage,
  terminalDiagnosticLines,
  verifyPrivateKeyJwtAssertion,
  waitForAssertion,
} from "./client-http-test-helpers.js";
import {
  MCP_HTTP_RESPONSE_BODY_MAX_BYTES,
  MCP_HTTP_SSE_MESSAGE_MAX_BYTES,
} from "./client-response-body-limit.js";

const MCP_STDIO_ENV_PROBE_KEYS = [
  "KOTA_TEST_PARENT_SECRET",
  "KOTA_TEST_GET_SECRET_INJECTED",
  "KOTA_SESSION_ID",
  "KOTA_TOOL_USE_ID",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_ENDPOINT",
] as const;
type McpStdioEnvProbeKey = (typeof MCP_STDIO_ENV_PROBE_KEYS)[number];

const MCP_STDIO_GIT_CONFIG_ENV_PROBE_KEYS = [
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_CONFIG_PARAMETERS",
] as const;
type McpStdioGitConfigEnvProbeKey =
  (typeof MCP_STDIO_GIT_CONFIG_ENV_PROBE_KEYS)[number];

function snapshotMcpStdioEnvProbeEnv(): Partial<Record<McpStdioEnvProbeKey, string>> {
  const snapshot: Partial<Record<McpStdioEnvProbeKey, string>> = {};
  for (const key of MCP_STDIO_ENV_PROBE_KEYS) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreMcpStdioEnvProbeEnv(
  snapshot: Partial<Record<McpStdioEnvProbeKey, string>>,
): void {
  for (const key of MCP_STDIO_ENV_PROBE_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function snapshotMcpStdioGitConfigEnvProbeEnv(): Partial<
  Record<McpStdioGitConfigEnvProbeKey, string>
> {
  const snapshot: Partial<Record<McpStdioGitConfigEnvProbeKey, string>> = {};
  for (const key of MCP_STDIO_GIT_CONFIG_ENV_PROBE_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreMcpStdioGitConfigEnvProbeEnv(
  snapshot: Partial<Record<McpStdioGitConfigEnvProbeKey, string>>,
): void {
  for (const key of MCP_STDIO_GIT_CONFIG_ENV_PROBE_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("McpClient Lifecycle & Stdio Transport", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("starts disconnected and reports configured name or command default", () => {
    client = new McpClient("echo", ["hello"], {}, "custom-server");
    expect(client.isConnected()).toBe(false);
    expect(client.getName()).toBe("custom-server");

    const defaultNamed = new McpClient("my-command");
    expect(defaultNamed.getName()).toBe("my-command");
  });

  it("reports disconnected after close", async () => {
    client = new McpClient("echo", [], {}, "test");
    await client.close();
    expect(client.isConnected()).toBe(false);
    client = null;
  });

  it("connect fails gracefully for non-existent command", async () => {
    client = new McpClient(
      "__nonexistent_command_that_does_not_exist__",
      [],
      {},
      "bad-server",
    );
    await expect(client.connect()).rejects.toThrow();
  });

  it("connect times out for non-MCP process", async () => {
    client = new McpClient("sleep", ["30"], {}, "stuck-server");
    await expect(client.connect()).rejects.toThrow(/timed out/);
  }, 15_000);

  it("connect + listTools + callTool + close lifecycle", async () => {
    client = new McpClient("node", ["-e", BOUNDED_STDIO_MCP_PEER], {}, "lifecycle");
    await client.connect();
    expect(client.isConnected()).toBe(true);

    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "test_tool")).toBe(true);

    const result = await client.callTool("test_tool", {});
    const completed = expectCompletedResult(result);
    expect(completed.text).toContain("Tool call completed: test_tool");

    await client.close();
    expect(client.isConnected()).toBe(false);
  }, 10_000);

  it("spawns stdio MCP servers without inherited parent secrets or KOTA runtime env", async () => {
    const envSnapshot = snapshotMcpStdioEnvProbeEnv();
    try {
      process.env.KOTA_TEST_PARENT_SECRET = "super-secret-123";
      process.env.KOTA_SESSION_ID = "sess-abc";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";

      const probeScript = createStdioMcpPeerScript({
        tools: [{
          name: "env_probe",
          description: "probe env",
          inputSchema: { type: "object" },
        }],
      });
      client = new McpClient(
        "node",
        ["-e", probeScript],
        {},
        "env-clean-test",
      );
      await client.connect();
      const res = await client.callTool("test_tool", {});
      const completed = expectCompletedResult(res);
      expect(completed.text).not.toContain("super-secret-123");
    } finally {
      restoreMcpStdioEnvProbeEnv(envSnapshot);
    }
  }, 10_000);

  it("passes sensitive env names to stdio MCP servers only through transport.env", async () => {
    const probeScript = createStdioMcpPeerScript({
      tools: [{
        name: "test_tool",
        inputSchema: { type: "object" },
      }],
    });
    client = new McpClient(
      {
        type: "stdio",
        command: "node",
        args: ["-e", probeScript],
        env: { KOTA_EXPLICIT_TEST_ENV: "explicit-val" },
      },
      "env-explicit-test",
    );
    await client.connect();
    expect(client.isConnected()).toBe(true);
  }, 10_000);

  it("keeps stdio MCP transport env from downgrading Git bare-repo safety", async () => {
    const gitEnvSnapshot = snapshotMcpStdioGitConfigEnvProbeEnv();
    try {
      const probeScript = createStdioMcpPeerScript({
        tools: [{ name: "test_tool", inputSchema: { type: "object" } }],
      });
      client = new McpClient(
        {
          type: "stdio",
          command: "node",
          args: ["-e", probeScript],
          env: { GIT_CONFIG_VALUE_0: "all" },
        },
        "git-safety-test",
      );
      await client.connect();
      expect(client.isConnected()).toBe(true);
    } finally {
      restoreMcpStdioGitConfigEnvProbeEnv(gitEnvSnapshot);
    }
  }, 10_000);
});

describe("Protocol Negotiation & Canonical Capabilities", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("derives capabilities and contracts canonically from supported versions", () => {
    expect(MCP_SUPPORTED_PROTOCOL_VERSIONS).toContain(MCP_CURRENT_PROTOCOL_VERSION);
    expect(MCP_SUPPORTED_PROTOCOL_VERSIONS).toContain(MCP_LEGACY_PROTOCOL_VERSION);
    expect(MCP_SUPPORTED_PROTOCOL_VERSIONS).toContain(MCP_DRAFT_PROTOCOL_VERSION);
    expect(MCP_CURRENT_STABLE_PROTOCOL_VERSIONS).toEqual([MCP_CURRENT_PROTOCOL_VERSION]);
    expect(MCP_DRAFT_PROTOCOL_VERSIONS).toEqual([MCP_DRAFT_PROTOCOL_VERSION]);
    expect(MCP_MODERN_PROTOCOL_VERSIONS).toEqual([
      MCP_CURRENT_PROTOCOL_VERSION,
      MCP_DRAFT_PROTOCOL_VERSION,
    ]);

    const legacyCaps = mcpProtocolCapabilities(MCP_LEGACY_PROTOCOL_VERSION);
    expect(legacyCaps.revision).toBe("legacy");
    expect(legacyCaps.toolResultContract).toBe("legacy-content");
    expect(legacyCaps.requestMetadata).toBe(false);

    const stableCaps = mcpProtocolCapabilities(MCP_CURRENT_PROTOCOL_VERSION);
    expect(stableCaps.revision).toBe("current-stable");
    expect(stableCaps.toolResultContract).toBe("complete-tool-result");
    expect(stableCaps.requestMetadata).toBe(true);
    expect(stableCaps.tasksExtension).toBe(true);

    const draftCaps = mcpProtocolCapabilities(MCP_DRAFT_PROTOCOL_VERSION);
    expect(draftCaps.revision).toBe("active-draft");
    expect(draftCaps.toolResultContract).toBe("complete-tool-result");
    expect(draftCaps.skillsExtension).toBe(true);
    expect(draftCaps.draftCompatibilityWarnings).toBe(true);

    expect(mcpProtocolSupports(MCP_CURRENT_PROTOCOL_VERSION, "tasksExtension")).toBe(true);
    expect(mcpProtocolSupports(MCP_LEGACY_PROTOCOL_VERSION, "tasksExtension")).toBe(false);
    expect(mcpToolResultContractForProtocol(MCP_CURRENT_PROTOCOL_VERSION)).toBe("complete-tool-result");
    expect(mcpToolResultContractForProtocol(MCP_LEGACY_PROTOCOL_VERSION)).toBe("legacy-content");
  });

  it("negotiates legacy fallback when server rejects current stable", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "fallback_legacy_ordered" },
      "legacy-fallback",
    );
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getProtocolVersion()).toBe(MCP_LEGACY_PROTOCOL_VERSION);
  }, 10_000);

  it("negotiates draft fallback when server advertises draft in error data", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "fallback_draft_ordered" },
      "draft-fallback",
    );
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getProtocolVersion()).toBe(MCP_DRAFT_PROTOCOL_VERSION);
  }, 10_000);

  it("records draft protocol negotiation when the server selects draft directly", async () => {
    const peerScript = createStdioMcpPeerScript({
      protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
    });
    client = new McpClient("node", ["-e", peerScript], {}, "draft-direct");
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getProtocolVersion()).toBe(MCP_DRAFT_PROTOCOL_VERSION);
  }, 10_000);
});

describe("Notifications, Subscriptions & Logging", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("sends progressToken and dispatches monotonic progress events", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "progress_stream" },
      "progress-test",
    );
    await client.connect();

    const events: McpProgressEvent[] = [];
    const result = await client.callTool(
      "test_tool",
      {},
      {
        progress: {
          onProgress: (event) => events.push(event),
          token: "token-1",
        },
      },
    );

    const completed = expectCompletedResult(result);
    expect(completed.text).toContain("Tool call completed");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].progressToken).toBe("token-1");
  }, 10_000);

  it("omits progressToken metadata unless the caller opts in", async () => {
    client = new McpClient("node", ["-e", BOUNDED_STDIO_MCP_PEER], {}, "progress-none");
    await client.connect();
    const result = await client.callTool("test_tool", {});
    const completed = expectCompletedResult(result);
    expect(completed.text).toContain("Tool call completed");
  }, 10_000);

  it("dispatches catalog listChanged notifications when advertised", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "catalog_changed_notifications" },
      "catalog-test",
    );
    await client.connect();

    let toolsChanged = false;
    let resourcesChanged = false;
    let promptsChanged = false;

    client.onToolsListChanged(() => { toolsChanged = true; });
    client.onResourcesListChanged(() => { resourcesChanged = true; });
    client.onPromptsListChanged(() => { promptsChanged = true; });

    expect(client.isConnected()).toBe(true);
  }, 10_000);
});

describe("Tool Execution & Result Decoding", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("callTool surfaces JSON-RPC error responses cleanly", async () => {
    const errorPeer = createStdioMcpPeerScript({
      tools: [{ name: "fail_tool", inputSchema: { type: "object" } }],
    });
    client = new McpClient("node", ["-e", errorPeer], {}, "err-test");
    await client.connect();

    await expect(client.callTool("fail_tool", {})).rejects.toThrow(
      McpToolError,
    );
    await expect(client.callTool("fail_tool", {})).rejects.toThrow(
      /Tool execution failed: fail_tool/,
    );
  }, 10_000);

  it("decodes input_required results with form/URL elicitation requests", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "input_required_draft" },
      "input-req-test",
    );
    await client.connect();

    const result = await client.callTool("test_tool", {});
    expect(result.resultType).toBe("input_required");
    if (result.resultType === "input_required") {
      expect(result.inputRequests).toBeDefined();
      expect(result.requestState).toBe("pending-confirmation");
    }
  }, 10_000);

  it("decodes Tasks extension results and manages task lifecycle over stdio", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "task_stdio_e2e" },
      "task-stdio",
      { remoteTasksEnabled: true },
    );
    await client.connect();

    const result = await client.callTool("test_tool", {});
    expect(result.resultType).toBe("task");
    if (result.resultType === "task") {
      expect(result.taskId).toBe("task-stdio-1");
      expect(result.status).toBe("working");

      const taskState = await client.getTask(result.taskId);
      expect(taskState.taskId).toBe("task-stdio-1");
      expect(taskState.status).toBe("completed");

      await expect(client.updateTask(result.taskId, {})).resolves.not.toThrow();
      await expect(client.cancelTask(result.taskId)).resolves.not.toThrow();
    }
  }, 10_000);

  it("rejects task results when Tasks extension was not negotiated", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "unnegotiated_task" },
      "unnegotiated-task-test",
    );
    await client.connect();

    await expect(client.callTool("test_tool", {})).rejects.toThrow(
      /Tasks extension was not negotiated/,
    );
  }, 10_000);

  it("rejects malformed task creation results at the MCP boundary", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "bad_task_creation" },
      "bad-task-test",
      { remoteTasksEnabled: true },
    );
    await client.connect();

    await expect(client.callTool("test_tool", {})).rejects.toThrow(
      /malformed/i,
    );
  }, 10_000);
});

describe("Tool Listing, Pagination & Schema Validation", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("listTools preserves advertised outputSchema and annotations", async () => {
    const annotatedPeer = createStdioMcpPeerScript({
      tools: [
        {
          name: "annotated_tool",
          description: "tool with annotations",
          inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { success: { type: "boolean" } } },
          annotations: { readOnlyHint: true, idempotentHint: true, "x-mcp-header": "x-token" },
        },
      ],
    });
    client = new McpClient("node", ["-e", annotatedPeer], {}, "schema-annotated");
    await client.connect();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].outputSchema).toEqual({ type: "object", properties: { success: { type: "boolean" } } });
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
  }, 10_000);

  it("listTools rejects malformed advertised outputSchema", async () => {
    client = new McpClient(
      "node",
      ["-e", BOUNDED_STDIO_MCP_PEER],
      { MCP_TEST_MODE: "malformed_output_schema" },
      "bad-schema",
    );
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(
      /outputSchema/i,
    );
  }, 10_000);
});

describe("Streamable HTTP Transport & SSE Framing", () => {
  let client: McpClient | null = null;
  let restoreFetch: (() => void) | null = null;

  afterEach(async () => {
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("connects with server/discover and parses tools/list over HTTP SSE", async () => {
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") {
        return jsonRpcHttpResponse(req.body.id, {
          protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "http-server" },
        });
      }
      if (req.body.method === "tools/list") {
        return sseJsonRpcHttpResponse(req.body.id, {
          tools: [{ name: "http_tool", inputSchema: { type: "object" } }],
        });
      }
      if (req.body.method === "tools/call") {
        return jsonRpcHttpResponse(req.body.id, {
          content: [{ type: "text", text: "http tool result" }],
          structuredContent: { ok: true },
        });
      }
      return jsonRpcHttpResponse(req.body.id, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      { type: "streamable-http", url: "https://mcp.example.test/mcp" },
      "http-client",
    );
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getProtocolVersion()).toBe(MCP_CURRENT_PROTOCOL_VERSION);

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("http_tool");

    const result = await client.callTool("http_tool", {});
    const completed = expectCompletedResult(result);
    expect(completed.text).toBe("http tool result");
    expect(completed.structuredContent).toEqual({ ok: true });
  });

  it("rejects oversized Streamable HTTP JSON responses by Content-Length before reading body", async () => {
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") {
        return jsonRpcHttpResponse(req.body.id, {
          protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
        });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.body.id, result: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(MCP_HTTP_RESPONSE_BODY_MAX_BYTES + 1024),
        },
      });
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      { type: "streamable-http", url: "https://mcp.example.test/mcp" },
      "oversized-http",
    );
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(/exceeded maximum/i);
  });

  it("rejects oversized Streamable HTTP SSE event data before parsing JSON-RPC", async () => {
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") {
        return jsonRpcHttpResponse(req.body.id, {
          protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
        });
      }
      const giant = "x".repeat(MCP_HTTP_SSE_MESSAGE_MAX_BYTES + 100);
      return new Response(`event: message\ndata: ${giant}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      { type: "streamable-http", url: "https://mcp.example.test/mcp" },
      "oversized-sse",
    );
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(/exceeded maximum/i);
  });

  it("mirrors annotated tool arguments into HTTP Mcp-Param headers", async () => {
    let capturedHeaders: Headers | null = null;
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") {
        return jsonRpcHttpResponse(req.body.id, {
          protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
        });
      }
      if (req.body.method === "tools/list") {
        return jsonRpcHttpResponse(req.body.id, {
          tools: [{
            name: "param_tool",
            inputSchema: { type: "object", properties: { session_token: { type: "string" } } },
            annotations: { "x-mcp-header": "x-session-token" },
          }],
        });
      }
      if (req.body.method === "tools/call") {
        capturedHeaders = req.headers;
        return jsonRpcHttpResponse(req.body.id, {
          content: [{ type: "text", text: "ok" }],
        });
      }
      return jsonRpcHttpResponse(req.body.id, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      { type: "streamable-http", url: "https://mcp.example.test/mcp" },
      "header-param-test",
    );
    await client.connect();
    await client.listTools();
    await client.callTool("param_tool", { session_token: "secret-token-val" });

    expect(capturedHeaders?.get("x-session-token")).toBe("secret-token-val");
  });
});

describe("Authentication, OAuth & Security Policies", () => {
  let client: McpClient | null = null;
  let restoreFetch: (() => void) | null = null;

  afterEach(async () => {
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("parses 401 protected-resource challenges and fetches metadata from hint", async () => {
    const http = mockClientHttpFetch((req) => {
      if (req.url === "https://mcp.example.test/mcp") {
        return new Response("Unauthorized", {
          status: 401,
          headers: {
            "www-authenticate": 'Bearer error="invalid_token", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
          },
        });
      }
      if (req.url === "https://mcp.example.test/.well-known/oauth-protected-resource") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["read", "write"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonRpcHttpResponse(1, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      {
        type: "streamable-http",
        url: "https://mcp.example.test/mcp",
        authorization: {
          type: "oauth",
          flow: "authorization_code",
          clientId: "kota-client",
        },
      },
      "oauth-discovery",
    );

    await expect(client.connect()).rejects.toThrow();
  });

  it("completes OAuth client credentials with private_key_jwt signing and retries", async () => {
    const keyPair = privateKeyJwtTestKeyPair();
    const http = mockClientHttpFetch((req) => {
      if (req.url === "https://mcp.example.test/mcp") {
        const auth = req.headers.get("authorization");
        if (!auth) {
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
            },
          });
        }
        if (auth === "Bearer valid-access-token") {
          return jsonRpcHttpResponse(req.body.id, {
            protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
            capabilities: { tools: {} },
          });
        }
        return new Response("Forbidden", { status: 403 });
      }
      if (req.url === "https://mcp.example.test/.well-known/oauth-protected-resource") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["mcp:tools"],
        }), { headers: { "content-type": "application/json" } });
      }
      if (req.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
          token_endpoint_auth_signing_alg_values_supported: ["RS256"],
        }), { headers: { "content-type": "application/json" } });
      }
      if (req.url === "https://auth.example.test/token") {
        const assertion = req.form.get("client_assertion");
        expect(assertion).toBeDefined();
        if (assertion) {
          verifyPrivateKeyJwtAssertion(assertion, keyPair.publicKeyPem, {
            audience: "https://auth.example.test/token",
            clientId: "jwt-client",
          });
        }
        return new Response(JSON.stringify({
          access_token: "valid-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mcp:tools",
        }), { headers: { "content-type": "application/json" } });
      }
      return jsonRpcHttpResponse(1, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      {
        type: "streamable-http",
        url: "https://mcp.example.test/mcp",
        authorization: {
          type: "oauth",
          flow: "client_credentials",
          client: {
            authMethod: "private_key_jwt",
            clientId: "jwt-client",
            privateKey: mcpOAuthSecret(keyPair.privateKeyPem),
            algorithm: "RS256",
          },
        },
      },
      "jwt-client-credentials",
    );
    await client.connect();
    expect(client.isConnected()).toBe(true);
  });

  it("redacts secrets, private keys, assertions, and tokens from error surfaces", async () => {
    const sensitiveSecret = "ultra-sensitive-secret-token";
    const http = mockClientHttpFetch((req) => {
      if (req.url === "https://mcp.example.test/mcp") {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/meta"' },
        });
      }
      if (req.url === "https://mcp.example.test/meta") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        }), { headers: { "content-type": "application/json" } });
      }
      if (req.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        }), { headers: { "content-type": "application/json" } });
      }
      if (req.url === "https://auth.example.test/token") {
        return new Response(JSON.stringify({
          error: "invalid_client",
          error_description: `failed with secret: ${sensitiveSecret}`,
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return jsonRpcHttpResponse(1, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      {
        type: "streamable-http",
        url: "https://mcp.example.test/mcp",
        authorization: {
          type: "oauth",
          flow: "client_credentials",
          client: {
            authMethod: "client_secret_basic",
            clientId: "secret-client",
            clientSecret: mcpOAuthSecret(sensitiveSecret),
          },
        },
      },
      "redaction-test",
    );

    let thrownError: Error | null = null;
    try {
      await client.connect();
    } catch (err) {
      thrownError = err as Error;
    }
    expect(thrownError).toBeInstanceOf(McpAuthorizationFlowError);
    expect(thrownError?.message).toContain("[redacted]");
    expect(thrownError?.message).not.toContain(sensitiveSecret);
  });
});

describe("Remote Resources, Prompts & Skills", () => {
  let client: McpClient | null = null;
  let restoreFetch: (() => void) | null = null;

  afterEach(async () => {
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("lists and retrieves remote resources across pages with cache hints", async () => {
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") {
        return jsonRpcHttpResponse(req.body.id, {
          protocolVersion: MCP_CURRENT_PROTOCOL_VERSION,
          capabilities: { resources: { listChanged: true } },
        });
      }
      if (req.body.method === "resources/list") {
        return jsonRpcHttpResponse(req.body.id, {
          resources: [{ uri: "file:///doc.txt", name: "doc", mimeType: "text/plain" }],
          _meta: { cache: { ttlMs: 60000, cacheScope: "public" } },
        });
      }
      if (req.body.method === "resources/read") {
        return jsonRpcHttpResponse(req.body.id, {
          contents: [{ uri: "file:///doc.txt", text: "hello doc", mimeType: "text/plain" }],
          _meta: { cache: { ttlMs: 30000, cacheScope: "private" } },
        });
      }
      return jsonRpcHttpResponse(req.body.id, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      { type: "streamable-http", url: "https://mcp.example.test/mcp" },
      "resources-client",
    );
    await client.connect();

    const resourcesPage = await client.listResources();
    expect(resourcesPage.resources).toHaveLength(1);
    expect(resourcesPage.resources[0].uri).toBe("file:///doc.txt");
    expect(resourcesPage.cache.ttlMs).toBe(60000);

    const readResult = await client.readResource("file:///doc.txt");
    expect(readResult.resultType).toBe("complete");
    if (readResult.resultType === "complete") {
      expect(readResult.contents[0].text).toBe("hello doc");
      expect(readResult.cache.cacheScope).toBe("private");
    }
  });

  it("decodes MCP-served skill catalogs and reads direct skill URIs", async () => {
    const http = mockClientHttpFetch((req) => {
      if (req.body.method === "server/discover") {
        return jsonRpcHttpResponse(req.body.id, {
          protocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
          capabilities: {
            resources: {},
            extensions: { [MCP_SKILLS_EXTENSION_ID]: {} },
          },
        });
      }
      if (req.body.method === "resources/read" && req.body.params?.uri === MCP_SKILL_INDEX_RESOURCE_URI) {
        return jsonRpcHttpResponse(req.body.id, {
          contents: [{
            uri: MCP_SKILL_INDEX_RESOURCE_URI,
            text: JSON.stringify({
              $schema: AGENT_SKILLS_DISCOVERY_SCHEMA,
              skills: [{
                type: "skill-md",
                name: "code-review",
                description: "Review code",
                url: "skill://code-review/SKILL.md",
              }],
            }),
            mimeType: "application/json",
          }],
        });
      }
      if (req.body.method === "resources/read" && req.body.params?.uri === "skill://code-review/SKILL.md") {
        return jsonRpcHttpResponse(req.body.id, {
          contents: [{
            uri: "skill://code-review/SKILL.md",
            text: [
              "---",
              "name: code-review",
              "description: Review code",
              "---",
              "# Code Review",
              "Follow standards.",
            ].join("\n"),
            mimeType: "text/markdown",
          }],
        });
      }
      return jsonRpcHttpResponse(req.body.id, {});
    });
    restoreFetch = http.mockRestore;

    client = new McpClient(
      { type: "streamable-http", url: "https://mcp.example.test/mcp" },
      "skills-client",
    );
    await client.connect();

    const catalog = await client.listRemoteSkills();
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0].name).toBe("code-review");

    const skillResult = await client.readRemoteSkill("skill://code-review/SKILL.md");
    expect(skillResult.resultType).toBe("complete");
    if (skillResult.resultType === "complete") {
      expect(skillResult.contents[0].text).toContain("# Code Review");
    }
  });
});

describe("Concurrency & Fault Resilience", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("concurrent callTool() calls both complete correctly", async () => {
    client = new McpClient("node", ["-e", BOUNDED_STDIO_MCP_PEER], {}, "concurrent-calls");
    await client.connect();

    const [res1, res2] = await Promise.all([
      client.callTool("test_tool", {}),
      client.callTool("test_tool", {}),
    ]);

    expect(expectCompletedResult(res1).text).toContain("Tool call completed");
    expect(expectCompletedResult(res2).text).toContain("Tool call completed");
  }, 10_000);

  it("callTool() during close() rejects without hanging", async () => {
    client = new McpClient("node", ["-e", BOUNDED_STDIO_MCP_PEER], {}, "call-during-close");
    await client.connect();

    const closePromise = client.close();
    const callPromise = client.callTool("test_tool", {});

    await closePromise;
    await expect(callPromise).rejects.toThrow();
  }, 10_000);

  it("double connect throws and double close is safe", async () => {
    client = new McpClient("node", ["-e", BOUNDED_STDIO_MCP_PEER], {}, "double-connect");
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await expect(client.connect()).rejects.toThrow();

    await client.close();
    await expect(client.close()).resolves.not.toThrow();
    expect(client.isConnected()).toBe(false);
  }, 10_000);
});
