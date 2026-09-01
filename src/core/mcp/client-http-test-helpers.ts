import { Buffer } from "node:buffer";
import {
  generateKeyPairSync,
  verify as verifySignature,
} from "node:crypto";
import { expect, vi } from "vitest";
import type {
  McpCallToolResult,
  McpCompleteCallToolResult,
  McpLegacyCallToolResult,
} from "./client.js";

export type RecordedClientHttpRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal?: AbortSignal;
  readonly bodyText: string;
  readonly body: {
    readonly id?: number;
    readonly method?: string;
    readonly params?: Record<string, any>;
  };
  readonly form: URLSearchParams;
};

export type PrivateKeyJwtTestKeyPair = {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
};

export type PrivateKeyJwtPayload = {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
};

export function mockClientHttpFetch(
  handler: (request: RecordedClientHttpRequest) => Response,
): { readonly mockRestore: () => void; readonly requests: RecordedClientHttpRequest[] } {
  const requests: RecordedClientHttpRequest[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const bodyText = String(init?.body ?? "");
    const body = bodyText.startsWith("{") ? JSON.parse(bodyText) : {};
    const inputRequest = typeof input === "object" && input !== null && "method" in input
      ? (input as { method?: string })
      : null;
    const request: RecordedClientHttpRequest = {
      url: typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url,
      method: init?.method ?? inputRequest?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(init?.signal ? { signal: init.signal } : {}),
      bodyText,
      body,
      form: new URLSearchParams(bodyText),
    };
    requests.push(request);
    return handler(request);
  });
  return Object.assign(fetchSpy, { requests });
}

export function jsonRpcHttpResponse(
  id: number | undefined,
  result: object,
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function jsonRpcHttpError(
  id: number | undefined,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

export function sseMessage(message: Record<string, any>): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

export function sseJsonRpcHttpResponse(
  id: number | undefined,
  result: Record<string, any>,
): Response {
  return new Response(sseMessage({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export async function waitForAssertion(
  assertion: () => void,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  let lastError: Error | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError ?? new Error("Timed out waiting for assertion");
}

export function captureTerminalStderr(): { output: () => string; restore: () => void } {
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

export function terminalDiagnosticLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function expectCompletedResult(
  result: McpCallToolResult,
): McpCompleteCallToolResult | McpLegacyCallToolResult {
  if (result.resultType === "input_required" || result.resultType === "task") {
    throw new Error("Expected a completed MCP tool result");
  }
  return result;
}

export function privateKeyJwtTestKeyPair(): PrivateKeyJwtTestKeyPair {
  const keyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return {
    privateKeyPem: keyPair.privateKey,
    publicKeyPem: keyPair.publicKey,
  };
}

export function privateKeyJwtEcPrivateKey(): string {
  const keyPair = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return keyPair.privateKey;
}

export function decodeBase64Url(value: string): Buffer {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(base64, "base64");
}

export function decodeBase64UrlJson(value: string): Record<string, any> {
  return JSON.parse(decodeBase64Url(value).toString("utf8"));
}

export function base64UrlJson(value: Record<string, any>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function verifyPrivateKeyJwtAssertion(
  assertion: string,
  publicKeyPem: string,
  options: { audience: string; clientId: string; keyId?: string },
): PrivateKeyJwtPayload {
  const parts = assertion.split(".");
  expect(parts).toHaveLength(3);
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeBase64UrlJson(encodedHeader);
  const payload = decodeBase64UrlJson(encodedPayload) as PrivateKeyJwtPayload;
  expect(header).toEqual({
    alg: "RS256",
    typ: "JWT",
    ...(options.keyId !== undefined ? { kid: options.keyId } : {}),
  });
  expect(payload.iss).toBe(options.clientId);
  expect(payload.sub).toBe(options.clientId);
  expect(payload.aud).toBe(options.audience);
  expect(payload.exp - payload.iat).toBe(300);
  expect(payload.exp).toBeGreaterThan(payload.iat);
  expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
      publicKeyPem,
      decodeBase64Url(encodedSignature),
    ),
  ).toBe(true);
  return payload;
}

export function fakeEnterpriseIdJagJwt(
  overrides: {
    header?: Record<string, any>;
    payload?: Record<string, any>;
  } = {},
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = {
    typ: "oauth-id-jag+jwt",
    alg: "none",
    ...(overrides.header ?? {}),
  };
  const payload = {
    iss: "https://idp.example.test",
    sub: "user-1",
    aud: "https://auth.example.test",
    resource: "https://mcp.example.test/mcp",
    client_id: "kota-client",
    jti: "id-jag-1",
    iat: nowSeconds,
    exp: nowSeconds + 300,
    scope: "files:read",
    ...(overrides.payload ?? {}),
  };
  return `${base64UrlJson(header)}.${base64UrlJson(payload)}.signature`;
}

export function fakeEnterpriseIdentityProviderMetadata(
  overrides: Record<string, any> = {},
): Record<string, any> {
  return {
    issuer: "https://idp.example.test",
    token_endpoint: "https://idp.example.test/token",
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
  scopes_supported: ["files:read", "files:write"],
    ...overrides,
  };
}

export type StdioMcpPeerConfig = {
  mode?: string;
  protocolVersion?: string;
  serverName?: string;
  capabilities?: Record<string, any>;
  tools?: Array<Record<string, any>>;
  resources?: Array<Record<string, any>>;
  prompts?: Array<Record<string, any>>;
};

/**
 * Bounded standard MCP stdio peer script generator for testing client stdio transport.
 * Supports configurable tools, capabilities, protocol versions, and failure modes.
 */
export function createStdioMcpPeerScript(config: StdioMcpPeerConfig = {}): string {
  return `
const config = ${JSON.stringify(config)};
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });
let initCount = 0;

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

const defaultTools = [
  { name: "test_tool", description: "A test tool", inputSchema: { type: "object" } },
  { name: "crash", description: "Crash server", inputSchema: { type: "object" } },
];

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const mode = process.env.MCP_TEST_MODE || config.mode || "normal";
  if (mode === "noisy" && initCount === 0) {
    process.stdout.write("Starting up...\\n\\n");
  }

  if (msg.method === "initialize") {
    initCount += 1;
    if (mode === "slow_init") {
      setTimeout(() => {
        write({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: config.protocolVersion || "2024-11-05",
            capabilities: config.capabilities || {},
            serverInfo: { name: config.serverName || "slow-init" },
          },
        });
      }, 300);
      return;
    }
    if (mode === "fallback_legacy" && msg.params?.protocolVersion !== "2024-11-05") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: -32602,
          message: "Unsupported protocol version",
          data: { supported: ["2024-11-05"], requested: msg.params?.protocolVersion },
        },
      });
      return;
    }
    if (mode === "fallback_legacy_ordered") {
      if (initCount === 1) {
        write({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32602,
            message: "Unsupported protocol version",
            data: { supportedVersions: ["2024-11-05"], requestedVersion: msg.params?.protocolVersion },
          },
        });
        return;
      }
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: config.capabilities || {},
          serverInfo: { name: config.serverName || "legacy-after-current" },
        },
      });
      return;
    }
    if (mode === "fallback_draft_ordered") {
      if (initCount === 1) {
        write({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32602,
            message: "Unsupported protocol version",
            data: { supportedVersions: ["DRAFT-2026-v1"], requestedVersion: msg.params?.protocolVersion },
          },
        });
        return;
      }
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "DRAFT-2026-v1",
          capabilities: config.capabilities || {},
          serverInfo: { name: config.serverName || "draft-after-current" },
        },
      });
      return;
    }
    if (mode === "catalog_changed_notifications") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "DRAFT-2026-v1",
          capabilities: { resources: { listChanged: true }, prompts: { listChanged: true } },
          serverInfo: { name: config.serverName || "catalog-changing-server" },
        },
      });
      return;
    }
    if (mode === "task_stdio_e2e" || mode === "nested_task_result" || mode === "bad_task_creation") {
      if (!msg.params?.capabilities?.extensions?.["io.modelcontextprotocol/tasks"]) {
        write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "missing task capability" } });
        return;
      }
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "DRAFT-2026-v1",
          capabilities: { tools: {}, extensions: { "io.modelcontextprotocol/tasks": {} } },
          serverInfo: { name: config.serverName || "task-server" },
        },
      });
      return;
    }
    if (mode === "unnegotiated_task") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "DRAFT-2026-v1",
          capabilities: { tools: {} },
          serverInfo: { name: config.serverName || "unnegotiated-task-server" },
        },
      });
      return;
    }
    const defaultProto = (mode.startsWith("draft") || mode === "input_required_draft")
      ? "DRAFT-2026-v1"
      : "2024-11-05";
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: config.protocolVersion || (msg.params?.protocolVersion || defaultProto),
        capabilities: config.capabilities || { tools: { listChanged: true } },
        serverInfo: { name: config.serverName || "fake-mcp-server", version: "1.0.0" },
      },
    });
  } else if (msg.method === "notifications/initialized") {
    if (mode === "exit_after_init") {
      setTimeout(() => process.exit(1), 50);
    }
  } else if (msg.method === "tools/list") {
    if (mode === "slow_tools_list") {
      return;
    }
    if (mode === "malformed_output_schema") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [{ name: "bad", inputSchema: { type: "object" }, outputSchema: "not-an-object" }],
        },
      });
      return;
    }
    const tools = config.tools || defaultTools;
    write({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    if (mode === "catalog_changed_notifications") {
      setTimeout(() => {
        write({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} });
        write({ jsonrpc: "2.0", method: "notifications/resources/list_changed", params: {} });
        write({ jsonrpc: "2.0", method: "notifications/prompts/list_changed", params: {} });
      }, 10);
    }
  } else if (msg.method === "resources/list") {
    write({ jsonrpc: "2.0", id: msg.id, result: { resources: config.resources || [] } });
  } else if (msg.method === "prompts/list") {
    write({ jsonrpc: "2.0", id: msg.id, result: { prompts: config.prompts || [] } });
  } else if (msg.method === "tools/call") {
    if (mode === "crash_on_call" || msg.params?.name === "crash") {
      process.exit(1);
    }
    if (msg.params?.name === "fail_tool" || mode === "tool_call_error") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32000, message: "Tool execution failed: fail_tool" },
      });
      return;
    }
    if (mode === "bad_task_creation") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          resultType: "task",
          protocolVersion: "DRAFT-2026-v1",
          taskId: "bad-task",
          status: "not-a-valid-status",
          createdAt: "2026-08-28T00:00:00Z",
          lastUpdatedAt: "2026-08-28T00:00:00Z",
          ttlMs: null,
        },
      });
      return;
    }
    if (mode === "task_stdio_e2e" || mode === "nested_task_result" || mode === "unnegotiated_task") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          resultType: "task",
          protocolVersion: "DRAFT-2026-v1",
          taskId: "task-stdio-1",
          status: "working",
          createdAt: "2026-08-28T00:00:00Z",
          lastUpdatedAt: "2026-08-28T00:00:00Z",
          ttlMs: 60000,
        },
      });
      return;
    }
    if (mode === "input_required_draft") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          resultType: "input_required",
          inputRequests: {
            req1: {
              method: "elicitation/create",
              params: { message: "Provide confirmation", mode: "form" },
            },
          },
          requestState: "pending-confirmation",
        },
      });
      return;
    }
    if (mode === "progress_stream") {
      const progressToken = msg.params?._meta?.progressToken;
      if (progressToken !== undefined) {
        write({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken, progress: 50, total: 100, sequence: 1, message: "working" },
        });
      }
    }
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: "Tool call completed: " + (msg.params?.name || "unknown") }],
      },
    });
  } else if (msg.method === "tasks/get") {
    const completedResult = mode === "nested_task_result"
      ? {
          resultType: "task",
          taskId: "nested-task",
          status: "working",
          createdAt: "2026-08-28T00:00:01Z",
          lastUpdatedAt: "2026-08-28T00:00:01Z",
          ttlMs: null,
        }
      : {
          resultType: "complete",
          content: [{ type: "text", text: "task complete" }],
          structuredContent: { done: true },
        };
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        taskId: msg.params?.taskId || "task-1",
        status: "completed",
        createdAt: "2026-08-28T00:00:00Z",
        lastUpdatedAt: "2026-08-28T00:00:01Z",
        ttlMs: null,
        result: completedResult,
      },
    });
  } else if (msg.method === "tasks/update" || msg.method === "tasks/cancel") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "shutdown") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
`;
}

export const BOUNDED_STDIO_MCP_PEER = createStdioMcpPeerScript();
