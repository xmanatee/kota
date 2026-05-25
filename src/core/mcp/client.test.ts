import { Buffer } from "node:buffer";
import {
  generateKeyPairSync,
  verify as verifySignature,
} from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_TASKS_EXTENSION_ID,
  McpAuthorizationError,
  type McpCallToolResult,
  McpClient,
  type McpCompleteCallToolResult,
  McpConnectionError,
  type McpLegacyCallToolResult,
  type McpProgressEvent,
  McpToolError,
  type McpToolSchema,
  mcpOAuthSecret,
} from "./client.js";

type RecordedClientHttpRequest = {
  url: string;
  method: string;
  headers: Headers;
  signal?: AbortSignal;
  bodyText: string;
  body: {
    id?: number;
    method?: string;
    params?: Record<string, any>;
  };
  form: URLSearchParams;
};

type PrivateKeyJwtTestKeyPair = {
  privateKeyPem: string;
  publicKeyPem: string;
};

type PrivateKeyJwtPayload = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
};

function sseMessage(message: Record<string, any>): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

async function waitForAssertion(assertion: () => void, timeoutMs = 2_000): Promise<void> {
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

function expectCompletedResult(
  result: McpCallToolResult,
): McpCompleteCallToolResult | McpLegacyCallToolResult {
  if (result.resultType === "input_required" || result.resultType === "task") {
    throw new Error("Expected a completed MCP tool result");
  }
  return result;
}

function mockClientHttpFetch(
  handler: (request: RecordedClientHttpRequest) => Response,
): { mockRestore: () => void; requests: RecordedClientHttpRequest[] } {
  const requests: RecordedClientHttpRequest[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const bodyText = String(init?.body ?? "");
    const body = bodyText.startsWith("{") ? JSON.parse(bodyText) : {};
    const inputRequest = typeof _input === "object" && "method" in _input ? _input : null;
    const request = {
      url: typeof _input === "string"
        ? _input
        : _input instanceof URL
          ? _input.toString()
          : _input.url,
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

function jsonRpcHttpResponse(id: number | undefined, result: Record<string, any>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function privateKeyJwtTestKeyPair(): PrivateKeyJwtTestKeyPair {
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

function privateKeyJwtEcPrivateKey(): string {
  const keyPair = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return keyPair.privateKey;
}

function decodeBase64Url(value: string): Buffer {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(base64, "base64");
}

function decodeBase64UrlJson(value: string): Record<string, any> {
  return JSON.parse(decodeBase64Url(value).toString("utf8"));
}

function verifyPrivateKeyJwtAssertion(
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

function base64UrlJson(value: Record<string, any>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fakeEnterpriseIdJagJwt(
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

function fakeEnterpriseIdentityProviderMetadata(
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

function sseJsonRpcHttpResponse(id: number | undefined, result: Record<string, any>): Response {
  return new Response(sseMessage({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Inline Node.js script that acts as a minimal MCP server.
 * Reads JSON-RPC from stdin, responds to initialize/tools/list/tools/call.
 * Configurable behavior via MCP_TEST_MODE env var.
 */
const FAKE_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const mode = process.env.MCP_TEST_MODE || "normal";
const isDraftMode = mode.startsWith("draft");
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    if (mode === "fallback_legacy" && msg.params.protocolVersion !== "2024-11-05") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: {
        code: -32602,
        message: "Unsupported protocol version",
        data: { supported: ["2024-11-05"], requested: msg.params.protocolVersion },
      }}) + "\\n");
      return;
    }
    const protocolVersion = isDraftMode ? "DRAFT-2026-v1" : "2024-11-05";
    const resp = { jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion,
      capabilities: {},
      serverInfo: { name: "test-mcp-server" },
    }};
    process.stdout.write(JSON.stringify(resp) + "\\n");
  } else if (msg.method === "notifications/initialized") {
    // notification — no response
  } else if (msg.method === "tools/list") {
    if (mode === "paginated") {
      if (!msg.params?.cursor) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          tools: [{ name: "first_page", description: "First page", inputSchema: { type: "object" } }],
          nextCursor: "page-2",
        }}) + "\\n");
        return;
      }
      if (msg.params.cursor === "page-2") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          tools: [{ name: "second_page", description: "Second page", inputSchema: { type: "object" } }],
        }}) + "\\n");
        return;
      }
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: {
        code: -32602, message: "Unexpected cursor",
      }}) + "\\n");
      return;
    }
    if (mode === "malformed_cursor") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        tools: [],
        nextCursor: 42,
      }}) + "\\n");
      return;
    }
    if (mode === "repeated_cursor") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        tools: [],
        nextCursor: "repeat-me",
      }}) + "\\n");
      return;
    }
    if (mode === "malformed_later_page") {
      if (!msg.params?.cursor) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          tools: [{ name: "first_page", inputSchema: { type: "object" } }],
          nextCursor: "bad-page",
        }}) + "\\n");
        return;
      }
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        tools: [{ name: 123, inputSchema: { type: "object" } }],
      }}) + "\\n");
      return;
    }
    const tools = [
      {
        name: "echo",
        description: "Echoes input",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        outputSchema: {
          type: "object",
          properties: { echoed: { type: "string" } },
          required: ["echoed"],
          additionalProperties: false,
        },
      },
      { name: "fail", description: "Always errors", inputSchema: { type: "object" } },
    ];
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } }) + "\\n");
  } else if (msg.method === "tools/call") {
    if (msg.params.name === "echo") {
      const text = msg.params.arguments?.text || "empty";
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        content: [{ type: "text", text: "Echo: " + text }],
      }}) + "\\n");
    } else if (msg.params.name === "fail") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: {
        code: -32000, message: "Tool execution failed: intentional error",
      }}) + "\\n");
    } else if (msg.params.name === "mixed") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        content: [
          { type: "text", text: "line1" },
          { type: "image", data: "abc123", mimeType: "image/png" },
          { type: "resource_link", uri: "file:///tmp/report.json", name: "report", mimeType: "application/json" },
          { type: "text", text: "line2" },
        ],
      }}) + "\\n");
    } else if (msg.params.name === "structured") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        content: [{
          type: "text",
          text: "structured text",
          annotations: { audience: ["assistant"], priority: 0.7 },
          _meta: { textCache: "t1" },
        }],
        structuredContent: { answer: 42, nested: { ok: true } },
        _meta: { resultCache: "r1" },
      }}) + "\\n");
    } else if (msg.params.name === "future") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        content: [{ type: "video", data: "future-bytes", mimeType: "video/mp4" }],
      }}) + "\\n");
    } else if (msg.params.name === "empty") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        content: [],
      }}) + "\\n");
    } else if (msg.params.name === "is_error") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        content: [{ type: "text", text: "partial failure" }],
        isError: true,
      }}) + "\\n");
    } else if (msg.params.name === "draft_complete") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "complete",
        content: [
          { type: "text", text: "draft visible", _meta: { blockCache: "b-draft" } },
          { type: "image", data: "draft-image", mimeType: "image/png" },
          { type: "resource_link", uri: "file:///tmp/draft.json", name: "draft", mimeType: "application/json" },
        ],
        structuredContent: { ok: true, count: 3 },
        _meta: { resultCache: "r-draft" },
        isError: false,
      }}) + "\\n");
    } else if (msg.params.name === "input_required") {
      if (msg.params.requestState || msg.params.inputResponses) {
        const response = msg.params.inputResponses?.github_login;
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          resultType: "complete",
          content: [{ type: "text", text: "Retry: " + msg.params.requestState + " " + response?.action + " " + (response?.content?.name || "") }],
          structuredContent: {
            requestState: msg.params.requestState,
            inputResponses: msg.params.inputResponses,
          },
        }}) + "\\n");
        return;
      }
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          github_login: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: "Please provide your GitHub username",
              requestedSchema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
        requestState: "state-token-1",
        _meta: { traceId: "input-required-1" },
      }}) + "\\n");
    } else if (msg.params.name === "input_required_url") {
      if (msg.params.requestState || msg.params.inputResponses) {
        const response = msg.params.inputResponses?.oauth;
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          resultType: "complete",
          content: [{ type: "text", text: "URL retry: " + msg.params.requestState + " " + response?.action + " content:" + Object.prototype.hasOwnProperty.call(response || {}, "content") }],
          structuredContent: {
            requestState: msg.params.requestState,
            inputResponses: msg.params.inputResponses,
          },
        }}) + "\\n");
        return;
      }
      if (mode === "draft_notify_complete") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/elicitation/complete", params: {
          elicitationId: "unknown-or-stale",
        }}) + "\\n");
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
        requestState: "state-token-url",
      }}) + "\\n");
    } else if (msg.params.name === "input_required_url_missing_message") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          oauth: {
            method: "elicitation/create",
            params: {
              mode: "url",
              url: "https://auth.example.test/consent?state=abc",
              elicitationId: "oauth-abc",
            },
          },
        },
        requestState: "state-token-url",
      }}) + "\\n");
    } else if (msg.params.name === "input_required_sampling") {
      if (msg.params.requestState || msg.params.inputResponses) {
        const response = msg.params.inputResponses?.sample;
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          resultType: "complete",
          content: [{ type: "text", text: "Sampling retry " + response.model + " " + response.stopReason }],
          structuredContent: {
            samplingContent: response.content,
          },
        }}) + "\\n");
        return;
      }
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          sample: {
            method: "sampling/createMessage",
            params: {
              messages: [
                { role: "user", content: { type: "text", text: "Use the scoped weather tool." } },
                {
                  role: "assistant",
                  content: [
                    {
                      type: "tool_use",
                      id: "call_weather",
                      name: "get_weather",
                      input: { city: "Paris" },
                      _meta: { cache: "tool-use" },
                    },
                  ],
                },
                {
                  role: "user",
                  content: {
                    type: "tool_result",
                    toolUseId: "call_weather",
                    content: [
                      { type: "text", text: "18 C" },
                      { type: "image", data: "chart-bytes", mimeType: "image/png" },
                      { type: "audio", data: "spoken-bytes", mimeType: "audio/mpeg" },
                    ],
                    structuredContent: { tempC: 18 },
                    isError: false,
                    _meta: { cache: "tool-result" },
                  },
                },
              ],
              modelPreferences: {
                hints: [{ name: "sonnet" }],
                costPriority: 0.2,
                speedPriority: 0.4,
                intelligencePriority: 0.9,
              },
              systemPrompt: "Answer tersely.",
              includeContext: "none",
              temperature: 0.1,
              maxTokens: 300,
              stopSequences: ["STOP"],
              metadata: { provider: "test" },
              tools: [
                {
                  name: "get_weather",
                  description: "Get weather by city.",
                  inputSchema: {
                    type: "object",
                    properties: { city: { type: "string" } },
                    required: ["city"],
                  },
                },
              ],
              toolChoice: { mode: "required" },
            },
          },
        },
        requestState: "sampling-state-1",
      }}) + "\\n");
    } else if (msg.params.name === "input_required_roots") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          roots: {
            method: "roots/list",
            params: {},
          },
        },
        requestState: "roots-state-1",
      }}) + "\\n");
    } else if (msg.params.name === "input_required_sampling_bad_tool_choice") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          sample: {
            method: "sampling/createMessage",
            params: {
              messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
              maxTokens: 64,
              toolChoice: { mode: "always" },
            },
          },
        },
      }}) + "\\n");
    } else if (msg.params.name === "input_required_sampling_mixed_tool_result") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          sample: {
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Result:" },
                    { type: "tool_result", toolUseId: "call_1", content: [{ type: "text", text: "ok" }] },
                  ],
                },
              ],
              maxTokens: 64,
            },
          },
        },
      }}) + "\\n");
    } else if (msg.params.name === "input_required_sampling_missing_tool_result") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          sample: {
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "tool_use", id: "call_1", name: "lookup", input: {} }],
                },
                { role: "user", content: { type: "text", text: "continue" } },
              ],
              maxTokens: 64,
            },
          },
        },
      }}) + "\\n");
    } else if (msg.params.name === "input_required_sampling_unknown_content") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          sample: {
            method: "sampling/createMessage",
            params: {
              messages: [
                { role: "user", content: { type: "video", data: "bytes", mimeType: "video/mp4" } },
              ],
              maxTokens: 64,
            },
          },
        },
      }}) + "\\n");
    } else if (msg.params.name === "malformed_input_required") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: [],
        requestState: "state-token-1",
      }}) + "\\n");
    } else if (msg.params.name === "input_required_requests_only") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: {
          github_login: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: "Please provide your GitHub username",
            },
          },
        },
      }}) + "\\n");
    } else if (msg.params.name === "input_required_state_only") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        requestState: "state-token-only",
      }}) + "\\n");
    } else if (msg.params.name === "missing_input_required_fields") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
      }}) + "\\n");
    }
  } else if (msg.method === "shutdown") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  }
});
`;

const SERVER_INITIATED_REQUESTS_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const observed = {
  stringPing: false,
  numericPing: false,
  collidingNumericPing: false,
  unsupportedError: false,
};
let pendingToolsList = null;
let fallbackTimer = null;

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function emptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

function answerToolsList() {
  if (!pendingToolsList) return;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  const msg = pendingToolsList;
  pendingToolsList = null;
  write({ jsonrpc: "2.0", id: msg.id, result: {
    tools: [
      {
        name: observed.stringPing ? "string_ping_ok" : "string_ping_missing",
        inputSchema: { type: "object" },
      },
      {
        name: observed.numericPing ? "numeric_ping_ok" : "numeric_ping_missing",
        inputSchema: { type: "object" },
      },
      {
        name: observed.collidingNumericPing ? "colliding_numeric_ping_ok" : "colliding_numeric_ping_missing",
        inputSchema: { type: "object" },
      },
      {
        name: observed.unsupportedError ? "unsupported_request_error_ok" : "unsupported_request_error_missing",
        inputSchema: { type: "object" },
      },
    ],
  }});
}

function maybeAnswerToolsList() {
  if (!pendingToolsList) return;
  if (
    observed.stringPing &&
    observed.numericPing &&
    observed.collidingNumericPing &&
    observed.unsupportedError
  ) {
    answerToolsList();
    return;
  }
  if (!fallbackTimer) fallbackTimer = setTimeout(answerToolsList, 250);
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "DRAFT-2026-v1",
      capabilities: {},
      serverInfo: { name: "server-initiated-requests" },
    }});
    return;
  }
  if (msg.method === "notifications/initialized") {
    write({ jsonrpc: "2.0", id: "server-ping-1", method: "ping" });
    write({ jsonrpc: "2.0", id: 777, method: "ping" });
    write({ jsonrpc: "2.0", id: "server-unsupported-1", method: "server/unsupported" });
    return;
  }
  if (msg.id === "server-ping-1" && emptyObject(msg.result)) {
    observed.stringPing = true;
    maybeAnswerToolsList();
    return;
  }
  if (msg.id === 777 && emptyObject(msg.result)) {
    observed.numericPing = true;
    maybeAnswerToolsList();
    return;
  }
  if (pendingToolsList && msg.id === pendingToolsList.id && emptyObject(msg.result)) {
    observed.collidingNumericPing = true;
    maybeAnswerToolsList();
    return;
  }
  if (
    msg.id === "server-unsupported-1" &&
    msg.error?.code === -32601 &&
    typeof msg.error.message === "string" &&
    msg.error.message.includes("server/unsupported")
  ) {
    observed.unsupportedError = true;
    maybeAnswerToolsList();
    return;
  }
  if (msg.method === "tools/list") {
    pendingToolsList = msg;
    write({ jsonrpc: "2.0", id: msg.id, method: "ping" });
    maybeAnswerToolsList();
    return;
  }
  if (msg.method === "shutdown") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
`;

const PROGRESS_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
function complete(msg, text) {
  write({ jsonrpc: "2.0", id: msg.id, result: {
    resultType: "complete",
    content: [{ type: "text", text }],
    isError: false,
  }});
}
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "DRAFT-2026-v1",
      capabilities: {},
      serverInfo: { name: "progress-server" },
    }});
    return;
  }
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "shutdown") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method !== "tools/call") return;
  const token = msg.params?._meta?.progressToken;
  if (msg.params.name === "long") {
    if (token !== undefined) {
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
    }
    complete(msg, token === undefined ? "has-token:false" : "has-token:true");
    return;
  }
  if (msg.params.name === "negative") {
    write({ jsonrpc: "2.0", method: "notifications/progress", params: {
      progressToken: "unknown-token",
      progress: 1,
    }});
    write({ jsonrpc: "2.0", method: "notifications/progress", params: {
      progressToken: token,
      progress: 1,
      message: "accepted",
    }});
    write({ jsonrpc: "2.0", method: "notifications/progress", params: {
      progressToken: token,
      progress: 1,
      message: "non-monotonic",
    }});
    write({ jsonrpc: "2.0", method: "notifications/cancelled", params: {
      requestId: msg.id,
      reason: "test cancellation",
    }});
    write({ jsonrpc: "2.0", method: "notifications/progress", params: {
      progressToken: token,
      progress: 2,
      message: "late",
    }});
    complete(msg, "negative-complete");
    return;
  }
  if (msg.params.name === "flood") {
    for (let progress = 1; progress <= 5; progress += 1) {
      write({ jsonrpc: "2.0", method: "notifications/progress", params: {
        progressToken: token,
        progress,
      }});
    }
    complete(msg, "flood-complete");
  }
});
`;

function listToolsServerScript(tools: object[], serverName = "header-test-server"): string {
  return `
    const tools = ${JSON.stringify(tools)};
    const serverName = ${JSON.stringify(serverName)};
    const rl = require("readline").createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: serverName },
        }}) + "\\n");
      } else if (msg.method === "notifications/initialized") {
        // notification — no response
      } else if (msg.method === "tools/list") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } }) + "\\n");
      } else if (msg.method === "shutdown") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
      }
    });
  `;
}

const LIST_CHANGED_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
let subscriptionId = null;
let subscribed = false;
let listCount = 0;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function hasDraftRequestMeta(meta) {
  return isObject(meta)
    && meta["io.modelcontextprotocol/protocolVersion"] === "DRAFT-2026-v1"
    && isObject(meta["io.modelcontextprotocol/clientInfo"])
    && meta["io.modelcontextprotocol/clientInfo"].name === "kota"
    && meta["io.modelcontextprotocol/clientInfo"].version === "0.1.0"
    && isObject(meta["io.modelcontextprotocol/clientCapabilities"]);
}

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
      serverInfo: { name: "list-changing-server" },
    }});
  } else if (msg.method === "notifications/initialized") {
    // notification - no response
  } else if (msg.method === "subscriptions/listen") {
    subscriptionId = String(msg.id);
    subscribed = msg.params?.notifications?.toolsListChanged === true
      && hasDraftRequestMeta(msg.params?._meta);
    write({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: {
      _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
      notifications: { toolsListChanged: subscribed },
    }});
  } else if (msg.method === "tools/list") {
    listCount += 1;
    const toolName = listCount === 1
      ? (subscribed ? "before_subscribed" : "before_unsubscribed")
      : "after_refresh";
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
  } else if (msg.method === "shutdown") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
`;

const DRAFT_META_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const expectElicitation = process.env.MCP_EXPECT_ELICITATION === "1";
let initializeCapabilities = null;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function expectedCapabilities() {
  return expectElicitation ? { elicitation: { form: {}, url: {} } } : {};
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function writeProtocolError(msg, message) {
  write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message } });
}

function readDraftRequestCapabilities(msg) {
  const meta = msg.params?._meta;
  if (!isObject(meta)) return null;
  if (meta["io.modelcontextprotocol/protocolVersion"] !== "DRAFT-2026-v1") return null;
  const clientInfo = meta["io.modelcontextprotocol/clientInfo"];
  if (!isObject(clientInfo) || clientInfo.name !== "kota" || clientInfo.version !== "0.1.0") return null;
  const capabilities = meta["io.modelcontextprotocol/clientCapabilities"];
  if (!isObject(capabilities)) return null;
  if (!sameJson(capabilities, expectedCapabilities())) return null;
  return capabilities;
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    initializeCapabilities = msg.params?.capabilities;
    if (!sameJson(initializeCapabilities, expectedCapabilities())) {
      writeProtocolError(msg, "unexpected initialize capabilities");
      return;
    }
    write({ jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "DRAFT-2026-v1",
      capabilities: {},
      serverInfo: { name: "draft-meta-inspector" },
    }});
  } else if (msg.method === "notifications/initialized") {
    // notification - no response
  } else if (msg.method === "tools/list") {
    const capabilities = readDraftRequestCapabilities(msg);
    if (!capabilities) {
      writeProtocolError(msg, "missing draft tools/list request metadata");
      return;
    }
    write({ jsonrpc: "2.0", id: msg.id, result: {
      tools: [{
        name: "inspect",
        description: JSON.stringify({ initializeCapabilities, listCapabilities: capabilities }),
        inputSchema: { type: "object" },
      }],
    }});
  } else if (msg.method === "tools/call") {
    const capabilities = readDraftRequestCapabilities(msg);
    if (!capabilities) {
      writeProtocolError(msg, "missing draft tools/call request metadata");
      return;
    }
    write({ jsonrpc: "2.0", id: msg.id, result: {
      resultType: "complete",
      content: [{ type: "text", text: "ok" }],
      structuredContent: {
        callProtocolVersion: msg.params._meta["io.modelcontextprotocol/protocolVersion"],
        callClientInfo: msg.params._meta["io.modelcontextprotocol/clientInfo"],
        callCapabilities: capabilities,
      },
      isError: false,
    }});
  } else if (msg.method === "shutdown") {
    write({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
`;

describe("McpClient", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("starts disconnected", () => {
    client = new McpClient("echo", ["hello"], {}, "test-server");
    expect(client.isConnected()).toBe(false);
    expect(client.getName()).toBe("test-server");
  });

  it("uses command as default name", () => {
    client = new McpClient("my-command");
    expect(client.getName()).toBe("my-command");
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
});

describe("McpClient lifecycle (fake MCP server)", () => {
  let client: McpClient;

  afterEach(async () => {
    await client.close();
  });

  it("connect + listTools + callTool + close lifecycle", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "lifecycle");
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getName()).toBe("test-mcp-server"); // from serverInfo
    expect(client.getProtocolVersion()).toBe(MCP_LEGACY_PROTOCOL_VERSION);
    expect(client.getToolResultContract()).toBe("legacy-content");

    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("echo");
    expect(tools[1].name).toBe("fail");

    const result = expectCompletedResult(
      await client.callTool("echo", { text: "hello world" }),
    );
    expect(result.resultType).toBe("legacy");
    expect(result.text).toBe("Echo: hello world");
    expect(result.content).toEqual([{ type: "text", text: "Echo: hello world" }]);
    expect(result.blocks).toEqual([{ type: "text", text: "Echo: hello world" }]);
    expect(result.isError).toBeUndefined();
  }, 10_000);

  it("records draft protocol negotiation when the server selects draft", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "draft-negotiation",
    );
    await client.connect();

    expect(client.getProtocolVersion()).toBe(MCP_DRAFT_PROTOCOL_VERSION);
    expect(client.getToolResultContract()).toBe("draft-tool-result");
  }, 10_000);

  it("answers server-initiated stdio requests before matching pending numeric responses", async () => {
    client = new McpClient(
      "node",
      ["-e", SERVER_INITIATED_REQUESTS_MCP_SERVER],
      {},
      "server-requests",
    );
    await client.connect();

    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "string_ping_ok",
      "numeric_ping_ok",
      "colliding_numeric_ping_ok",
      "unsupported_request_error_ok",
    ]);
  }, 10_000);

  it("sends progressToken metadata and records bounded progress side-channel events", async () => {
    client = new McpClient("node", ["-e", PROGRESS_MCP_SERVER], {}, "progress");
    await client.connect();
    const events: McpProgressEvent[] = [];

    const result = expectCompletedResult(
      await client.callTool("long", {}, undefined, {
        progress: {
          token: "progress-1",
          onProgress: (event) => events.push(event),
        },
      }),
    );

    expect(result.text).toBe("has-token:true");
    expect(result.structuredContent).toBeUndefined();
    expect(events).toEqual([
      {
        requestId: 2,
        progressToken: "progress-1",
        progress: 1,
        sequence: 1,
        total: 2,
        message: "half",
      },
      {
        requestId: 2,
        progressToken: "progress-1",
        progress: 2,
        sequence: 2,
        total: 2,
        message: "done",
      },
    ]);
  }, 10_000);

  it("omits progressToken metadata unless the caller opts into progress", async () => {
    client = new McpClient("node", ["-e", PROGRESS_MCP_SERVER], {}, "progress-none");
    await client.connect();

    const result = expectCompletedResult(await client.callTool("long", {}));

    expect(result.text).toBe("has-token:false");
  }, 10_000);

  it("ignores unknown, non-monotonic, and post-cancel progress without mutating the result", async () => {
    client = new McpClient("node", ["-e", PROGRESS_MCP_SERVER], {}, "progress-negative");
    await client.connect();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: McpProgressEvent[] = [];

    const result = expectCompletedResult(
      await client.callTool("negative", {}, undefined, {
        progress: {
          token: "progress-negative",
          onProgress: (event) => events.push(event),
        },
      }),
    );

    expect(result.text).toBe("negative-complete");
    expect(events).toEqual([
      {
        requestId: 2,
        progressToken: "progress-negative",
        progress: 1,
        sequence: 1,
        message: "accepted",
      },
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ignored progress notification for inactive token"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ignored non-monotonic progress notification"),
    );
    errorSpy.mockRestore();
  }, 10_000);

  it("coalesces progress floods to the per-call event limit", async () => {
    client = new McpClient("node", ["-e", PROGRESS_MCP_SERVER], {}, "progress-flood");
    await client.connect();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: McpProgressEvent[] = [];

    const result = expectCompletedResult(
      await client.callTool("flood", {}, undefined, {
        progress: {
          maxEvents: 2,
          onProgress: (event) => events.push(event),
        },
      }),
    );

    expect(result.text).toBe("flood-complete");
    expect(events.map((event) => event.progress)).toEqual([1, 2]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("coalescing progress notifications"),
    );
    errorSpy.mockRestore();
  }, 10_000);

  it("sends draft request metadata without elicitation when no input bridge is configured", async () => {
    client = new McpClient(
      "node",
      ["-e", DRAFT_META_MCP_SERVER],
      {},
      "draft-meta-no-input",
    );
    await client.connect();

    const tools = await client.listTools();
    const description = JSON.parse(tools[0].description ?? "{}") as {
      initializeCapabilities: Record<string, unknown>;
      listCapabilities: Record<string, unknown>;
    };
    expect(description).toEqual({
      initializeCapabilities: {},
      listCapabilities: {},
    });

    const result = expectCompletedResult(await client.callTool("inspect", {}));
    expect(result.structuredContent).toEqual({
      callProtocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      callClientInfo: { name: "kota", version: "0.1.0" },
      callCapabilities: {},
    });
  }, 10_000);

  it("advertises form and URL elicitation in draft metadata when input modes are configured", async () => {
    client = new McpClient(
      "node",
      ["-e", DRAFT_META_MCP_SERVER],
      { MCP_EXPECT_ELICITATION: "1" },
      "draft-meta-with-input",
      { supportedElicitationModes: ["form", "url"] },
    );
    await client.connect();

    const expectedCapabilities = { elicitation: { form: {}, url: {} } };
    const tools = await client.listTools();
    const description = JSON.parse(tools[0].description ?? "{}") as {
      initializeCapabilities: Record<string, unknown>;
      listCapabilities: Record<string, unknown>;
    };
    expect(description).toEqual({
      initializeCapabilities: expectedCapabilities,
      listCapabilities: expectedCapabilities,
    });

    const result = expectCompletedResult(await client.callTool("inspect", {}));
    expect(result.structuredContent).toMatchObject({
      callProtocolVersion: MCP_DRAFT_PROTOCOL_VERSION,
      callClientInfo: { name: "kota", version: "0.1.0" },
      callCapabilities: expectedCapabilities,
    });
  }, 10_000);

  it("records tools.listChanged, opens a toolsListChanged subscription, and handles list_changed notifications", async () => {
    client = new McpClient(
      "node",
      ["-e", LIST_CHANGED_MCP_SERVER],
      {},
      "list-change-test",
    );
    const refreshed = new Promise<McpToolSchema[]>((resolve, reject) => {
      client.onToolListChanged(() => {
        client.listTools().then(resolve, reject);
      });
    });

    await client.connect();

    expect(client.getProtocolVersion()).toBe(MCP_DRAFT_PROTOCOL_VERSION);
    expect(client.supportsToolListChanged()).toBe(true);

    const initialTools = await client.listTools();
    expect(initialTools.map((tool) => tool.name)).toEqual(["before_subscribed"]);
    await expect(refreshed).resolves.toMatchObject([{ name: "after_refresh" }]);
  }, 10_000);

  it("opens resource and prompt listChanged subscriptions and dispatches notifications", async () => {
    const catalogChangedServer = `
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
            capabilities: {
              resources: { listChanged: true },
              prompts: { listChanged: true },
            },
            serverInfo: { name: "catalog-changing-server" },
          }});
        } else if (msg.method === "notifications/initialized") {
          // notification - no response
        } else if (msg.method === "subscriptions/listen") {
          const subscriptionId = String(msg.id);
          if (
            msg.params?.notifications?.resourcesListChanged !== true ||
            msg.params?.notifications?.promptsListChanged !== true
          ) {
            write({ jsonrpc: "2.0", id: msg.id, error: {
              code: -32602,
              message: "missing catalog subscriptions",
            }});
            return;
          }
          write({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            notifications: {
              resourcesListChanged: true,
              promptsListChanged: true,
            },
          }});
          setTimeout(() => {
            write({ jsonrpc: "2.0", method: "notifications/resources/list_changed", params: {
              _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            }});
            write({ jsonrpc: "2.0", method: "notifications/prompts/list_changed", params: {
              _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
            }});
          }, 20);
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    client = new McpClient(
      "node",
      ["-e", catalogChangedServer],
      {},
      "catalog-change-test",
    );
    const resourceChanged = new Promise<void>((resolve) => {
      client?.onResourceListChanged(() => resolve());
    });
    const promptChanged = new Promise<void>((resolve) => {
      client?.onPromptListChanged(() => resolve());
    });

    await client.connect();

    expect(client.supportsResources()).toBe(true);
    expect(client.supportsResourceListChanged()).toBe(true);
    expect(client.supportsPrompts()).toBe(true);
    expect(client.supportsPromptListChanged()).toBe(true);
    await expect(resourceChanged).resolves.toBeUndefined();
    await expect(promptChanged).resolves.toBeUndefined();
  }, 10_000);

  it("falls back to the legacy handshake when a server rejects draft", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "fallback_legacy" },
      "fallback-negotiation",
    );
    await client.connect();

    expect(client.getProtocolVersion()).toBe(MCP_LEGACY_PROTOCOL_VERSION);
    expect(client.getToolResultContract()).toBe("legacy-content");
  }, 10_000);

  it("listTools preserves advertised outputSchema", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "schema-list");
    await client.connect();

    const tools = await client.listTools();
    expect(tools[0]).toMatchObject({
      name: "echo",
      outputSchema: {
        type: "object",
        properties: { echoed: { type: "string" } },
        required: ["echoed"],
        additionalProperties: false,
      },
    });
  }, 10_000);

  it("listTools follows nextCursor and sends it in follow-up tools/list params", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "paginated" },
      "paginated-list",
    );
    await client.connect();

    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["first_page", "second_page"]);
  }, 10_000);

  it("listTools rejects malformed nextCursor values with server diagnostics", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "malformed_cursor" },
      "bad-cursor-list",
    );
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(
      /MCP tools\/list failed for server "test-mcp-server": Malformed MCP tools\/list result: nextCursor must be a string/,
    );
  }, 10_000);

  it("listTools rejects repeated nextCursor values as pagination loops", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "repeated_cursor" },
      "repeated-cursor-list",
    );
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(
      /Malformed MCP tools\/list result from server "test-mcp-server": repeated nextCursor/,
    );
  }, 10_000);

  it("listTools rejects malformed tool data on later pages", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "malformed_later_page" },
      "bad-later-page-list",
    );
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(
      /MCP tools\/list failed for server "test-mcp-server": Malformed MCP tools\/list result: tools\[0\]\.name must be a string/,
    );
  }, 10_000);

  it("callTool surfaces JSON-RPC errors", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "err-test");
    await client.connect();

    await expect(client.callTool("fail", {})).rejects.toThrow(
      /MCP error -32000.*intentional error/,
    );
  }, 10_000);

  it("callTool preserves image and unsupported MCP content beside text fallback", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "mixed-test");
    await client.connect();

    const result = expectCompletedResult(await client.callTool("mixed", {}));
    expect(result.text).toBe("line1\nline2");
    expect(result.content).toEqual([
      { type: "text", text: "line1" },
      { type: "image", data: "abc123", mimeType: "image/png" },
      { type: "resource_link", uri: "file:///tmp/report.json", name: "report", mimeType: "application/json" },
      { type: "text", text: "line2" },
    ]);
    expect(result.blocks).toEqual([
      { type: "text", text: "line1" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc123" },
      },
      {
        type: "mcp_content",
        content: {
          type: "resource_link",
          uri: "file:///tmp/report.json",
          name: "report",
          mimeType: "application/json",
        },
      },
      { type: "text", text: "line2" },
    ]);
  }, 10_000);

  it("callTool preserves structuredContent and _meta separately from text", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "structured-test");
    await client.connect();

    const result = expectCompletedResult(await client.callTool("structured", {}));
    expect(result.text).toBe("structured text");
    expect(result.structuredContent).toEqual({ answer: 42, nested: { ok: true } });
    expect(result._meta).toEqual({ resultCache: "r1" });
    expect(result.content[0]).toEqual({
      type: "text",
      text: "structured text",
      annotations: { audience: ["assistant"], priority: 0.7 },
      _meta: { textCache: "t1" },
    });
    expect(result.blocks[0]).toEqual({
      type: "text",
      text: "structured text",
      annotations: { audience: ["assistant"], priority: 0.7 },
      _meta: { textCache: "t1" },
    });
  }, 10_000);

  it("callTool decodes draft complete results without dropping rich fields", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "draft-complete-test",
    );
    await client.connect();

    const result = expectCompletedResult(await client.callTool("draft_complete", {}));
    expect(result.resultType).toBe("complete");
    expect(result.protocolVersion).toBe(MCP_DRAFT_PROTOCOL_VERSION);
    expect(result.text).toBe("draft visible");
    expect(result.content).toEqual([
      { type: "text", text: "draft visible", _meta: { blockCache: "b-draft" } },
      { type: "image", data: "draft-image", mimeType: "image/png" },
      {
        type: "resource_link",
        uri: "file:///tmp/draft.json",
        name: "draft",
        mimeType: "application/json",
      },
    ]);
    expect(result.blocks).toEqual([
      { type: "text", text: "draft visible", _meta: { blockCache: "b-draft" } },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "draft-image",
        },
      },
      {
        type: "mcp_content",
        content: {
          type: "resource_link",
          uri: "file:///tmp/draft.json",
          name: "draft",
          mimeType: "application/json",
        },
      },
    ]);
    expect(result.structuredContent).toEqual({ ok: true, count: 3 });
    expect(result._meta).toEqual({ resultCache: "r-draft" });
    expect(result.isError).toBe(false);
  }, 10_000);

  it("decodes task-backed tool results and issues task methods over stdio", async () => {
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
      function hasTaskCapability(msg) {
        return Boolean(msg.params?._meta?.["io.modelcontextprotocol/clientCapabilities"]?.extensions?.["io.modelcontextprotocol/tasks"]);
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          if (!msg.params?.capabilities?.extensions?.["io.modelcontextprotocol/tasks"]) {
            write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "missing task capability" } });
            return;
          }
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {
              tools: {},
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          }});
        } else if (msg.method === "notifications/initialized") {
          return;
        } else if (msg.method === "tools/list") {
          if (!hasTaskCapability(msg)) {
            write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "missing per-request task capability" } });
            return;
          }
          write({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "async_tool", inputSchema: { type: "object" } }],
          }});
        } else if (msg.method === "tools/call") {
          if (!hasTaskCapability(msg)) {
            write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "missing call task capability" } });
            return;
          }
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "task",
            taskId: "remote-task-1",
            status: "working",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:00.000Z",
            ttlMs: 60000,
            pollIntervalMs: 1,
          }});
        } else if (msg.method === "tasks/get") {
          if (!hasTaskCapability(msg)) {
            write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "missing get task capability" } });
            return;
          }
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "task",
            taskId: msg.params.taskId,
            status: "completed",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:01.000Z",
            ttlMs: null,
            result: {
              resultType: "complete",
              content: [{ type: "text", text: "task done" }],
            },
          }});
        } else if (msg.method === "tasks/update") {
          if (msg.params.inputResponses.confirm.action !== "accept") {
            write({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "bad input response" } });
            return;
          }
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        } else if (msg.method === "tasks/cancel") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    client = new McpClient(
      "node",
      ["-e", server],
      {},
      "stdio-task-client",
      { enableRemoteTasks: true },
    );
    await client.connect();
    await client.listTools();

    const created = await client.callTool("async_tool", {});
    expect(created).toMatchObject({
      resultType: "task",
      taskId: "remote-task-1",
      status: "working",
      ttlMs: 60000,
      pollIntervalMs: 1,
    });

    const updated = await client.updateTask("remote-task-1", {
      inputRequests: {
        confirm: {
          method: "elicitation/create",
          params: { mode: "form", message: "Continue?" },
        },
      },
      inputResponses: {
        confirm: { action: "accept", content: { ok: true } },
      },
    });
    expect(updated).toEqual({ resultType: "complete" });

    const task = await client.getTask("remote-task-1");
    expect(task.status).toBe("completed");
    expect(task.resultType).toBe("task");
    expect(task.ttlMs).toBeNull();
    expect(task.pollIntervalMs).toBeUndefined();
    expect(task.result).toMatchObject({
      resultType: "complete",
      content: [{ type: "text", text: "task done" }],
    });
    expect(await client.cancelTask("remote-task-1")).toEqual({ resultType: "complete" });
  }, 10_000);

  it("issues task methods over Streamable HTTP with draft metadata and headers", async () => {
    const { requests } = mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            tools: {},
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          },
        });
      }
      if (request.body.method === "tools/call") {
        return jsonRpcHttpResponse(request.body.id, {
          resultType: "task",
          taskId: "http-task-1",
          status: "working",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:00.000Z",
          ttlMs: 60000,
          pollIntervalMs: 1,
        });
      }
      if (request.body.method === "tasks/get") {
        return jsonRpcHttpResponse(request.body.id, {
          resultType: "task",
          taskId: request.body.params?.taskId,
          status: "completed",
          createdAt: "2026-05-25T12:00:00.000Z",
          lastUpdatedAt: "2026-05-25T12:00:01.000Z",
          ttlMs: null,
          result: {
            resultType: "complete",
            content: [{ type: "text", text: "http done" }],
          },
        });
      }
      if (request.body.method === "tasks/update" || request.body.method === "tasks/cancel") {
        return jsonRpcHttpResponse(request.body.id, {});
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      {
        type: "http",
        url: "https://mcp.example.test/mcp",
        headers: { Authorization: "Bearer task-token" },
      },
      "http-task-client",
      { enableRemoteTasks: true },
    );
    await client.connect();

    const created = await client.callTool("async_tool", {});
    expect(created.resultType).toBe("task");
    const task = await client.getTask("http-task-1");
    expect(task).toMatchObject({
      resultType: "task",
      ttlMs: null,
    });
    expect(task.pollIntervalMs).toBeUndefined();
    await expect(client.updateTask("http-task-1", {
      inputRequests: {
        confirm: {
          method: "elicitation/create",
          params: { mode: "form", message: "Continue?" },
        },
      },
      inputResponses: {
        confirm: { action: "accept", content: { ok: true } },
      },
    })).resolves.toEqual({ resultType: "complete" });
    await expect(client.cancelTask("http-task-1")).resolves.toEqual({ resultType: "complete" });

    expect(requests.map((request) => request.body.method)).toEqual([
      "server/discover",
      "tools/call",
      "tasks/get",
      "tasks/update",
      "tasks/cancel",
    ]);
    for (const request of requests.slice(1)) {
      expect(request.headers.get("mcp-method")).toBe(request.body.method);
      expect(request.headers.get("authorization")).toBe("Bearer task-token");
      expect(request.body.params?._meta).toMatchObject({
        "io.modelcontextprotocol/protocolVersion": MCP_DRAFT_PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
        },
      });
    }
    expect(requests[1].headers.get("mcp-name")).toBe("async_tool");
    for (const request of requests.slice(2)) {
      expect(request.headers.get("mcp-name")).toBe("http-task-1");
    }
  });

  it("rejects malformed task creation results at the MCP boundary", async () => {
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: {
              tools: {},
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          }});
        } else if (msg.method === "notifications/initialized") {
          return;
        } else if (msg.method === "tools/call") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "task",
            status: "working",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:00.000Z",
            ttlMs: 60000,
            pollIntervalMs: 1,
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    client = new McpClient(
      "node",
      ["-e", server],
      {},
      "bad-task-client",
      { enableRemoteTasks: true },
    );
    await client.connect();

    await expect(client.callTool("async_tool", {})).rejects.toThrow(
      /Malformed MCP tools\/call result: taskId must be a string/,
    );
  }, 10_000);

  it("rejects task results when the Tasks extension was not negotiated", async () => {
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "DRAFT-2026-v1",
            capabilities: { tools: {} },
          }});
        } else if (msg.method === "notifications/initialized") {
          return;
        } else if (msg.method === "tools/call") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            resultType: "task",
            taskId: "unnegotiated-task",
            status: "working",
            createdAt: "2026-05-25T12:00:00.000Z",
            lastUpdatedAt: "2026-05-25T12:00:00.000Z",
            ttlMs: 60000,
            pollIntervalMs: 1,
          }});
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    client = new McpClient("node", ["-e", server], {}, "unnegotiated-task-client");
    await client.connect();

    await expect(client.callTool("async_tool", {})).rejects.toThrow(
      /without negotiated io\.modelcontextprotocol\/tasks support/,
    );
  }, 10_000);

  it("callTool decodes draft input_required results without treating content as malformed", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "input-required-test",
    );
    await client.connect();

    const result = await client.callTool("input_required", {});
    expect(result.resultType).toBe("input_required");
    if (result.resultType !== "input_required") {
      throw new Error("Expected input_required result");
    }
    expect(result.protocolVersion).toBe(MCP_DRAFT_PROTOCOL_VERSION);
    expect(result.inputRequests).toEqual({
      github_login: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message: "Please provide your GitHub username",
          requestedSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
    });
    expect(result.requestState).toBe("state-token-1");
    expect(result._meta).toEqual({ traceId: "input-required-1" });
  }, 10_000);

  it("callTool decodes draft input_required results with inputRequests and no requestState", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "input-required-requests-only-test",
    );
    await client.connect();

    const result = await client.callTool("input_required_requests_only", {});
    expect(result.resultType).toBe("input_required");
    if (result.resultType !== "input_required") {
      throw new Error("Expected input_required result");
    }
    expect(result.inputRequests).toEqual({
      github_login: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message: "Please provide your GitHub username",
        },
      },
    });
    expect(result.requestState).toBeUndefined();
  }, 10_000);

  it("callTool decodes draft input_required results with requestState and no inputRequests", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "input-required-state-only-test",
    );
    await client.connect();

    const result = await client.callTool("input_required_state_only", {});
    expect(result.resultType).toBe("input_required");
    if (result.resultType !== "input_required") {
      throw new Error("Expected input_required result");
    }
    expect(result.inputRequests).toBeUndefined();
    expect(result.requestState).toBe("state-token-only");
  }, 10_000);

  it("callTool retries draft input_required requests with requestState and inputResponses", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "input-required-retry-test",
    );
    await client.connect();

    const result = expectCompletedResult(
      await client.callTool("input_required", {}, {
        requestState: "state-token-1",
        inputResponses: {
          github_login: {
            action: "accept",
            content: { name: "octocat" },
          },
        },
      }),
    );

    expect(result.resultType).toBe("complete");
    expect(result.text).toBe("Retry: state-token-1 accept octocat");
    expect(result.structuredContent).toEqual({
      requestState: "state-token-1",
      inputResponses: {
        github_login: {
          action: "accept",
          content: { name: "octocat" },
        },
      },
    });
  }, 10_000);

  it("callTool sends decline for explicit draft input_required refusals", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "input-required-decline-test",
    );
    await client.connect();

    for (const operatorAction of ["decline", "reject"] as const) {
      const inputResponses = operatorAction === "reject"
        // Legacy `reject` arrives from untyped operator JSON; the public type
        // stays on the current draft `decline` action.
        ? ({ github_login: { action: "reject" } } as never)
        : { github_login: { action: "decline" as const } };
      const result = expectCompletedResult(
        await client.callTool("input_required", {}, {
          requestState: "state-token-1",
          inputResponses,
        }),
      );

      expect(result.resultType).toBe("complete");
      expect(result.text).toBe("Retry: state-token-1 decline ");
      expect(result.structuredContent).toEqual({
        requestState: "state-token-1",
        inputResponses: {
          github_login: { action: "decline" },
        },
      });
    }
  }, 10_000);

  it("callTool retries URL-mode input_required requests without content", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "url-input-required-retry-test",
    );
    await client.connect();

    const inputRequired = await client.callTool("input_required_url", {});
    expect(inputRequired.resultType).toBe("input_required");
    if (inputRequired.resultType !== "input_required" || !inputRequired.inputRequests) {
      throw new Error("Expected URL input_required result");
    }

    const result = expectCompletedResult(
      await client.callTool("input_required_url", {}, {
        requestState: "state-token-url",
        inputRequests: inputRequired.inputRequests,
        inputResponses: {
          oauth: { action: "accept" },
        },
      }),
    );

    expect(result.resultType).toBe("complete");
    expect(result.text).toBe("URL retry: state-token-url accept content:false");
    expect(result.structuredContent).toEqual({
      requestState: "state-token-url",
      inputResponses: {
        oauth: { action: "accept" },
      },
    });
  }, 10_000);

  it("callTool decodes and retries draft sampling input_required requests", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "sampling-input-required-retry-test",
    );
    await client.connect();

    const inputRequired = await client.callTool("input_required_sampling", {});
    expect(inputRequired.resultType).toBe("input_required");
    if (inputRequired.resultType !== "input_required" || !inputRequired.inputRequests) {
      throw new Error("Expected sampling input_required result");
    }
    expect(inputRequired.inputRequests.sample).toMatchObject({
      method: "sampling/createMessage",
      params: {
        includeContext: "none",
        maxTokens: 300,
        toolChoice: { mode: "required" },
        tools: [
          {
            name: "get_weather",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
      },
    });

    const result = expectCompletedResult(
      await client.callTool("input_required_sampling", {}, {
        requestState: "sampling-state-1",
        inputRequests: inputRequired.inputRequests,
        inputResponses: {
          sample: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "call_weather_2",
                name: "get_weather",
                input: { city: "London" },
              },
            ],
            model: "claude-sonnet-test",
            stopReason: "toolUse",
          },
        },
      }),
    );

    expect(result.text).toBe("Sampling retry claude-sonnet-test toolUse");
    expect(result.structuredContent).toEqual({
      samplingContent: [
        {
          type: "tool_use",
          id: "call_weather_2",
          name: "get_weather",
          input: { city: "London" },
        },
      ],
    });
  }, 10_000);

  it("warns once per deprecated client-feature input request returned by a remote server", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "deprecated-input-request-test",
    );
    await client.connect();

    const roots = await client.callTool("input_required_roots", {});
    const sampling = await client.callTool("input_required_sampling", {});
    await client.callTool("input_required_roots", {});
    await client.callTool("input_required_sampling", {});

    expect(roots.resultType).toBe("input_required");
    expect(sampling.resultType).toBe("input_required");
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('MCP server "test-mcp-server"');
    expect(warnings[0]).toContain('feature "roots"');
    expect(warnings[0]).toContain(`protocol ${MCP_DRAFT_PROTOCOL_VERSION}`);
    expect(warnings[0]).toContain("compatibility-only");
    expect(warnings[1]).toContain('feature "sampling"');
  }, 10_000);

  it("callTool rejects malformed sampling input_required payloads at the MCP boundary", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "bad-sampling-input-required-test",
    );
    await client.connect();

    await expect(client.callTool("input_required_sampling_bad_tool_choice", {})).rejects.toThrow(
      /inputRequests\.sample\.params\.toolChoice\.mode must be none, required, or auto/,
    );
    await expect(client.callTool("input_required_sampling_mixed_tool_result", {})).rejects.toThrow(
      /inputRequests\.sample\.params\.messages\[0\]\.content must contain only tool_result blocks/,
    );
    await expect(client.callTool("input_required_sampling_missing_tool_result", {})).rejects.toThrow(
      /inputRequests\.sample\.params\.messages\[1\] must answer pending tool_use ids call_1 before normal conversation continues/,
    );
    await expect(client.callTool("input_required_sampling_unknown_content", {})).rejects.toThrow(
      /inputRequests\.sample\.params\.messages\[0\]\.content\.type must be text, image, audio, tool_use, or tool_result/,
    );
  }, 10_000);

  it("ignores unknown URL-mode elicitation completion notifications", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft_notify_complete" },
      "url-input-complete-notification-test",
    );
    await client.connect();

    const inputRequired = await client.callTool("input_required_url", {});
    expect(inputRequired.resultType).toBe("input_required");
    if (inputRequired.resultType !== "input_required" || !inputRequired.inputRequests) {
      throw new Error("Expected URL input_required result");
    }

    expect(inputRequired.inputRequests.oauth.params).toMatchObject({
      url: "https://auth.example.test/consent?state=abc",
      elicitationId: "oauth-abc",
    });
  }, 10_000);

  it("callTool rejects URL-mode input_required requests without message", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "url-input-missing-message-test",
    );
    await client.connect();

    await expect(client.callTool("input_required_url_missing_message", {})).rejects.toThrow(
      /inputRequests\.oauth\.params\.message must be a string/,
    );
  }, 10_000);

  it("callTool rejects URL-mode retry responses with extra fields", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "url-input-extra-field-test",
    );
    await client.connect();

    const inputRequired = await client.callTool("input_required_url", {});
    expect(inputRequired.resultType).toBe("input_required");
    if (inputRequired.resultType !== "input_required" || !inputRequired.inputRequests) {
      throw new Error("Expected URL input_required result");
    }

    await expect(
      client.callTool("input_required_url", {}, {
        requestState: "state-token-url",
        inputRequests: inputRequired.inputRequests,
        inputResponses: {
          oauth: { action: "accept", code: "secret" },
        },
      }),
    ).rejects.toThrow(/inputResponses\.oauth must include only action/);
  }, 10_000);

  it("callTool rejects malformed retry inputResponses before sending the retry", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "bad-input-response-test",
    );
    await client.connect();

    await expect(
      client.callTool("input_required", {}, {
        requestState: "state-token-1",
        inputResponses: {
          github_login: {
            action: "accept",
          },
        } as never,
      }),
    ).rejects.toThrow(/inputResponses\.github_login\.content must be an object/);
  }, 10_000);

  it("callTool rejects malformed draft input_required payloads at the MCP boundary", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "bad-input-required-test",
    );
    await client.connect();

    await expect(client.callTool("malformed_input_required", {})).rejects.toThrow(
      /Malformed MCP tools\/call result: inputRequests must be an object/,
    );
  }, 10_000);

  it("callTool rejects draft input_required payloads with neither inputRequests nor requestState", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "missing-input-required-fields-test",
    );
    await client.connect();

    await expect(client.callTool("missing_input_required_fields", {})).rejects.toThrow(
      /Malformed MCP tools\/call result: input_required must include inputRequests or requestState/,
    );
  }, 10_000);

  it("callTool preserves future MCP content kinds instead of erasing them", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "future-test");
    await client.connect();

    const result = expectCompletedResult(await client.callTool("future", {}));
    expect(result.text).toBe("(no output)");
    expect(result.content).toEqual([
      {
        type: "unknown",
        mcpType: "video",
        raw: { type: "video", data: "future-bytes", mimeType: "video/mp4" },
      },
    ]);
    expect(result.blocks).toEqual([
      {
        type: "mcp_content",
        content: {
          type: "unknown",
          mcpType: "video",
          raw: { type: "video", data: "future-bytes", mimeType: "video/mp4" },
        },
      },
    ]);
  }, 10_000);

  it("callTool returns fallback for empty content", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "empty-test");
    await client.connect();

    const result = expectCompletedResult(await client.callTool("empty", {}));
    expect(result.text).toBe("(no output)");
    expect(result.content).toEqual([]);
    expect(result.blocks).toEqual([]);
  }, 10_000);

  it("callTool preserves isError flag", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "iserr-test");
    await client.connect();

    const result = expectCompletedResult(await client.callTool("is_error", {}));
    expect(result.text).toBe("partial failure");
    expect(result.isError).toBe(true);
  }, 10_000);

  it("close sets connected to false", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "close-test");
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await client.close();
    expect(client.isConnected()).toBe(false);
  }, 10_000);

  it("handleLine ignores non-JSON lines", async () => {
    // Server that sends garbage before valid response
    const noisyServer = `
      process.stdout.write("Starting up...\\n");
      process.stdout.write("\\n");
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write("debug: got init\\n");
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "noisy" },
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    client = new McpClient("node", ["-e", noisyServer], {}, "noisy-test");
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(client.getName()).toBe("noisy");
  }, 10_000);

  it("pending requests rejected when server exits unexpectedly", async () => {
    // Server that exits immediately after initialize
    const exitServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "notifications/initialized") {
          // exit after handshake
          setTimeout(() => process.exit(1), 50);
        }
      });
    `;
    client = new McpClient("node", ["-e", exitServer], {}, "exit-test");
    await client.connect();

    // Server will exit; next call should be rejected
    await expect(client.listTools()).rejects.toThrow(/exited/);
  }, 10_000);
});

describe("McpClient Streamable HTTP transport", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("connects with server/discover and parses SSE tools/list responses", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "sse-http-fixture" },
        });
      }
      if (request.body.method === "tools/list") {
        expect(request.headers.get("mcp-method")).toBe("tools/list");
        return sseJsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "from_sse", inputSchema: { type: "object" } }],
        });
      }
      return jsonRpcHttpResponse(request.body.id, {
        resultType: "complete",
        content: [{ type: "text", text: "ok" }],
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "sse-client",
    );

    await client.connect();
    const tools = await client.listTools();

    expect(client.getName()).toBe("sse-http-fixture");
    expect(client.getProtocolVersion()).toBe(MCP_DRAFT_PROTOCOL_VERSION);
    expect(tools.map((tool) => tool.name)).toEqual(["from_sse"]);
  });

  it("dispatches HTTP SSE progress and log notifications before the final response", async () => {
    const encoder = new TextEncoder();
    let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    const progressEvents: McpProgressEvent[] = [];
    const logMessages: Array<{ level: string; data?: unknown }> = [];
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "sse-progress-fixture" },
        });
      }
      if (request.body.method === "tools/call") {
        const token = request.body.params?._meta?.progressToken;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
              controller.enqueue(encoder.encode(sseMessage({
                jsonrpc: "2.0",
                method: "notifications/message",
                params: {
                  level: "info",
                  data: { message: "started" },
                },
              })));
              controller.enqueue(encoder.encode(sseMessage({
                jsonrpc: "2.0",
                method: "notifications/progress",
                params: {
                  progressToken: token,
                  progress: 1,
                  total: 2,
                  message: "half",
                },
              })));
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "sse-progress-client",
      {
        onLogMessage: (event) => {
          logMessages.push({ level: event.level, data: event.data });
        },
      },
    );
    await client.connect();

    const resultPromise = client.callTool("long", {}, undefined, {
      progress: {
        token: "http-progress-1",
        onProgress: (event) => progressEvents.push(event),
      },
    });

    await waitForAssertion(() => {
      expect(progressEvents).toHaveLength(1);
      expect(logMessages).toHaveLength(1);
    });
    expect(stream).not.toBeNull();
    stream!.enqueue(encoder.encode(sseMessage({
      jsonrpc: "2.0",
      id: 2,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: "done" }],
      },
    })));
    stream!.close();

    const result = expectCompletedResult(await resultPromise);

    expect(result.text).toBe("done");
    expect(progressEvents).toEqual([
      {
        requestId: 2,
        progressToken: "http-progress-1",
        progress: 1,
        sequence: 1,
        total: 2,
        message: "half",
      },
    ]);
    expect(logMessages).toEqual([
      { level: "info", data: { message: "started" } },
    ]);
  });

  it("rejects server-to-client requests on HTTP SSE response streams", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "sse-peer-request-fixture" },
        });
      }
      if (request.body.method === "tools/call") {
        return new Response(
          [
            sseMessage({ jsonrpc: "2.0", id: "server-ping-1", method: "ping" }),
            sseMessage({
              jsonrpc: "2.0",
              id: request.body.id,
              result: {
                resultType: "complete",
                content: [{ type: "text", text: "done" }],
              },
            }),
          ].join(""),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "sse-peer-request-client",
    );
    await client.connect();

    await expect(client.callTool("needs_ping", {})).rejects.toThrow(
      /server-to-client request "ping".*HTTP SSE response stream cannot send JSON-RPC responses/,
    );
  });

  it("fails HTTP SSE responses that end without a final JSON-RPC response", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      return new Response(
        sseMessage({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", data: { message: "no final" } },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "missing-final-client",
    );
    await client.connect();

    await expect(client.callTool("never_finishes", {})).rejects.toThrow(
      /SSE response stream ended without a final JSON-RPC response/,
    );
  });

  it("times out HTTP SSE responses that never send a final JSON-RPC response", async () => {
    const encoder = new TextEncoder();
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sseMessage({
              jsonrpc: "2.0",
              method: "notifications/message",
              params: { level: "info", data: { message: "still running" } },
            })));
            request.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              controller.error(err);
            });
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "timeout-sse-client",
    );
    await client.connect();

    vi.useFakeTimers();
    try {
      const result = client.callTool("never_finishes", {});
      const rejection = expect(result).rejects.toThrow(/request timed out after 120000ms/);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(120_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns once when an HTTP MCP server advertises deprecated logging support", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockClientHttpFetch((request) => {
      expect(request.body.method).toBe("server/discover");
      return jsonRpcHttpResponse(request.body.id, {
        supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: "deprecated-http" },
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-before-discover",
    );

    await client.connect();

    expect(client.supportsTools()).toBe(true);
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('MCP server "deprecated-http"');
    expect(warnings[0]).toContain('feature "logging"');
    expect(warnings[0]).toContain(`protocol ${MCP_DRAFT_PROTOCOL_VERSION}`);
    expect(warnings[0]).toContain("compatibility-only");
  });

  it("rejects unsupported discover protocol versions as a typed connection error", async () => {
    mockClientHttpFetch((request) => jsonRpcHttpResponse(request.body.id, {
      supportedVersions: ["2024-11-05"],
      capabilities: {},
      serverInfo: { name: "legacy-only" },
    }));
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-client",
    );

    await expect(client.connect()).rejects.toMatchObject({
      name: "McpConnectionError",
      serverName: "http-client",
      method: "server/discover",
    });
    await expect(client.connect()).rejects.toThrow(McpConnectionError);
  });

  it("wraps HTTP transport failures as typed connection errors that name the server", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "offline-http-client",
    );

    await expect(client.connect()).rejects.toMatchObject({
      name: "McpConnectionError",
      serverName: "offline-http-client",
      method: "server/discover",
    });
    await expect(client.connect()).rejects.toThrow(/fetch failed/);
  });

  it("wraps HTTP JSON-RPC method failures as typed tool errors that name the server", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "http-tool-errors" },
        });
      }
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.body.id,
        error: { code: -32601, message: `Method not found: ${request.body.method}` },
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-tool-client",
    );
    await client.connect();

    await expect(client.callTool("missing", {})).rejects.toMatchObject({
      name: "McpToolError",
      serverName: "http-tool-errors",
      method: "tools/call",
    });
    await expect(client.callTool("missing", {})).rejects.toThrow(McpToolError);
  });

  it("parses 401 protected-resource authorization challenges as typed redacted errors", async () => {
    mockClientHttpFetch(() => new Response("access token leaked-token", {
      status: 401,
      headers: {
        "content-type": "text/plain",
        "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read files:write"',
      },
    }));
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "auth-http-client",
    );

    await expect(client.connect()).rejects.toMatchObject({
      name: "McpAuthorizationError",
      serverName: "auth-http-client",
      method: "server/discover",
      status: 401,
      challenge: {
        resourceMetadataUrl: "https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
        scopes: ["files:read", "files:write"],
      },
    });
    await expect(client.connect()).rejects.toThrow(McpAuthorizationError);
    await expect(client.connect()).rejects.not.toThrow(/leaked-token/);
  });

  it("fetches protected-resource metadata from 401 challenge hints", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (
        request.method === "GET" &&
        request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp"
      ) {
        expect(request.headers.get("authorization")).toBeNull();
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          bearer_methods_supported: ["header"],
          scopes_supported: ["files:read", "files:write"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("access token leaked-token", {
        status: 401,
        headers: {
          "content-type": "text/plain",
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read files:write"',
        },
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "auth-metadata-client",
    );

    let thrown: unknown;
    try {
      await client.connect();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(McpAuthorizationError);
    expect(thrown).toMatchObject({
      name: "McpAuthorizationError",
      challenge: {
        resourceMetadataUrl: "https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
        metadataDiscovery: {
          status: "found",
          url: "https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
          metadata: {
            resource: "https://mcp.example.test/mcp",
            authorizationServers: ["https://auth.example.test"],
            bearerMethodsSupported: ["header"],
            scopesSupported: ["files:read", "files:write"],
          },
        },
      },
    });
    expect(thrown instanceof Error ? thrown.message : "").toMatch(
      /authorization_servers=https:\/\/auth\.example\.test/,
    );
    expect(thrown instanceof Error ? thrown.message : "").not.toContain("leaked-token");
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
    ]);
  });

  it("falls back to well-known protected-resource metadata URLs when challenges omit resource_metadata", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (
        request.method === "GET" &&
        request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp"
      ) {
        return new Response("not found", { status: 404 });
      }
      if (
        request.method === "GET" &&
        request.url === "https://mcp.example.test/.well-known/oauth-protected-resource"
      ) {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test",
          authorization_servers: ["https://auth.example.test"],
          bearer_methods_supported: ["header"],
          scopes_supported: ["mcp:tools"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "content-type": "text/plain",
          "www-authenticate": 'Bearer scope="mcp:tools"',
        },
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "auth-well-known-client",
    );

    await expect(client.connect()).rejects.toMatchObject({
      name: "McpAuthorizationError",
      challenge: {
        resourceMetadataUrl: "https://mcp.example.test/.well-known/oauth-protected-resource",
        metadataDiscovery: {
          status: "found",
          url: "https://mcp.example.test/.well-known/oauth-protected-resource",
          metadata: {
            resource: "https://mcp.example.test",
            authorizationServers: ["https://auth.example.test"],
            scopesSupported: ["mcp:tools"],
          },
        },
      },
    });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource",
    ]);
  });

  it("parses 403 insufficient-scope challenges without leaking bearer tokens", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "scope-http-fixture" },
        });
      }
      return new Response("configured token: configured-secret", {
        status: 403,
        headers: {
          "content-type": "text/plain",
          "www-authenticate": 'Bearer error="insufficient_scope", scope="files:write", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", error_description="configured-secret"',
        },
      });
    });
    client = new McpClient(
      {
        type: "http",
        url: "https://mcp.example.test/mcp",
        headers: { Authorization: "Bearer configured-secret" },
      },
      "scope-http-client",
    );
    await client.connect();

    await expect(client.callTool("write_file", {})).rejects.toMatchObject({
      name: "McpAuthorizationError",
      serverName: "scope-http-fixture",
      method: "tools/call",
      status: 403,
      challenge: {
        error: "insufficient_scope",
        resourceMetadataUrl: "https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
        scopes: ["files:write"],
      },
    });
    await expect(client.callTool("write_file", {})).rejects.toThrow(McpAuthorizationError);
    await expect(client.callTool("write_file", {})).rejects.not.toThrow(/configured-secret/);
  });

  it("completes OAuth authorization-code with PKCE and retries protected Streamable HTTP requests with a scoped token", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    const resolverCalls: Array<{ authorizationUrl: string; state: string; scopes: string[] }> = [];
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          bearer_methods_supported: ["header"],
          scopes_supported: ["files:read", "files:write"],
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
          scopes_supported: ["files:read", "files:write"],
          authorization_response_iss_parameter_supported: true,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        expect(request.form.get("grant_type")).toBe("authorization_code");
        expect(request.form.get("code")).toBe("code-1");
        expect(request.form.get("client_id")).toBe("kota-client");
        expect(request.form.get("redirect_uri")).toBe("https://client.example.test/callback");
        expect(request.form.get("resource")).toBe("https://mcp.example.test/mcp");
        expect(request.form.get("code_verifier")).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
        return new Response(JSON.stringify({
          access_token: "access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
          refresh_token: "refresh-token-secret",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "oauth-fixture" },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing bearer access-token-secret", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "oauth-http-client",
      {
        authorizationResolver: async (request) => {
          resolverCalls.push({
            authorizationUrl: request.authorizationUrl,
            state: request.state,
            scopes: request.scopes,
          });
          return {
            callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-1&state=${request.state}&iss=https%3A%2F%2Fauth.example.test`),
          };
        },
      },
    );

    await client.connect();
    const tools = await client.listTools();

    expect(client.getName()).toBe("oauth-fixture");
    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(resolverCalls).toHaveLength(1);
    const authorizationUrl = new URL(resolverCalls[0].authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe("https://auth.example.test/authorize");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("kota-client");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://client.example.test/callback");
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.example.test/mcp");
    expect(authorizationUrl.searchParams.get("scope")).toBe("files:read");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("state")).toBe(resolverCalls[0].state);
    expect(resolverCalls[0].scopes).toEqual(["files:read"]);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "GET https://auth.example.test/.well-known/oauth-authorization-server",
      "POST https://auth.example.test/token",
      "POST https://mcp.example.test/mcp",
      "POST https://mcp.example.test/mcp",
    ]);
  });

  it("redacts OAuth callback URLs when resolver results are stringified for logs or artifacts", () => {
    const callbackUrl = mcpOAuthSecret(
      "https://client.example.test/callback?code=code-1&state=state-1",
    );
    const result = { callbackUrl };

    expect(callbackUrl.reveal()).toContain("code-1");
    expect(String(callbackUrl)).toBe("[redacted]");
    expect(JSON.stringify(result)).toBe('{"callbackUrl":"[redacted]"}');
    expect(JSON.stringify(result)).not.toContain("code-1");
  });

  it("completes OAuth client credentials authorization and retries protected Streamable HTTP requests with a scoped token", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    let resolverCalled = false;
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (
        request.body.method === "server/discover" &&
        request.headers.get("authorization") === null
      ) {
        expect(
          request.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"]
            ?.extensions?.["io.modelcontextprotocol/oauth-client-credentials"],
        ).toEqual({});
      }
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:read"],
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
          scopes_supported: ["files:read"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        expect(request.headers.get("authorization")).toBe(
          "Basic a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA==",
        );
        expect(request.form.get("grant_type")).toBe("client_credentials");
        expect(request.form.get("resource")).toBe("https://mcp.example.test/mcp");
        expect(request.form.get("scope")).toBe("files:read");
        expect(request.form.get("client_secret")).toBeNull();
        return new Response(JSON.stringify({
          access_token: "client-credentials-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer client-credentials-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "client-credentials-fixture" },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer client-credentials-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing client credentials token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "client-credentials-http-client",
      {
        authorizationResolver: async () => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret("https://client.example.test/callback?code=unused&state=unused"),
          };
        },
      },
    );

    await client.connect();
    const tools = await client.listTools();

    expect(client.getName()).toBe("client-credentials-fixture");
    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(resolverCalled).toBe(false);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "GET https://auth.example.test/.well-known/oauth-authorization-server",
      "POST https://auth.example.test/token",
      "POST https://mcp.example.test/mcp",
      "POST https://mcp.example.test/mcp",
    ]);
  });

  it("completes OAuth client credentials private_key_jwt authorization with a signed assertion and scoped retry", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    const { privateKeyPem, publicKeyPem } = privateKeyJwtTestKeyPair();
    let resolverCalled = false;
    let submittedAssertion = "";
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (
        request.body.method === "server/discover" &&
        request.headers.get("authorization") === null
      ) {
        expect(
          request.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"]
            ?.extensions?.["io.modelcontextprotocol/oauth-client-credentials"],
        ).toEqual({});
      }
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:read"],
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
          scopes_supported: ["files:read"],
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
        expect(request.form.get("client_id")).toBe("kota-client");
        expect(request.form.get("client_secret")).toBeNull();
        expect(request.form.get("client_assertion_type")).toBe(
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        );
        submittedAssertion = request.form.get("client_assertion") ?? "";
        verifyPrivateKeyJwtAssertion(submittedAssertion, publicKeyPem, {
          audience: "https://auth.example.test/token",
          clientId: "kota-client",
          keyId: "key-1",
        });
        return new Response(JSON.stringify({
          access_token: "private-key-jwt-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer private-key-jwt-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "private-key-jwt-fixture" },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer private-key-jwt-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing private_key_jwt token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
            keyId: "key-1",
          },
        },
      },
      "private-key-jwt-http-client",
      {
        authorizationResolver: async () => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret("https://client.example.test/callback?code=unused&state=unused"),
          };
        },
      },
    );

    await client.connect();
    const tools = await client.listTools();

    expect(client.getName()).toBe("private-key-jwt-fixture");
    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(resolverCalled).toBe(false);
    expect(submittedAssertion).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(submittedAssertion).not.toContain(privateKeyPem);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "GET https://auth.example.test/.well-known/oauth-authorization-server",
      "POST https://auth.example.test/token",
      "POST https://mcp.example.test/mcp",
      "POST https://mcp.example.test/mcp",
    ]);
  });

  it("completes enterprise-managed authorization with ID-JAG exchange, JWT bearer exchange, and scoped retry", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    let resolverCalled = false;
    let submittedIdJag = "";
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (
        request.body.method === "server/discover" &&
        request.headers.get("authorization") === null
      ) {
        expect(
          request.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"]
            ?.extensions?.["io.modelcontextprotocol/enterprise-managed-authorization"],
        ).toEqual({});
        expect(
          request.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"]
            ?.extensions?.["io.modelcontextprotocol/oauth-client-credentials"],
        ).toBeUndefined();
      }
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:read"],
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
          scopes_supported: ["files:read"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://idp.example.test/.well-known/oauth-authorization-server") {
        return new Response(JSON.stringify(fakeEnterpriseIdentityProviderMetadata({
          scopes_supported: ["files:read"],
        })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://idp.example.test/token") {
        expect(request.headers.get("authorization")).toBe(
          "Basic a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA==",
        );
        expect(request.form.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:token-exchange",
        );
        expect(request.form.get("requested_token_type")).toBe(
          "urn:ietf:params:oauth:token-type:id-jag",
        );
        expect(request.form.get("audience")).toBe("https://auth.example.test");
        expect(request.form.get("resource")).toBe("https://mcp.example.test/mcp");
        expect(request.form.get("scope")).toBe("files:read");
        expect(request.form.get("subject_token")).toBe("identity-assertion-secret");
        expect(request.form.get("subject_token_type")).toBe(
          "urn:ietf:params:oauth:token-type:id_token",
        );
        return new Response(JSON.stringify({
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          access_token: fakeEnterpriseIdJagJwt(),
          token_type: "N_A",
          scope: "files:read",
          expires_in: 300,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/token") {
        expect(request.headers.get("authorization")).toBe(
          "Basic a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA==",
        );
        expect(request.form.get("grant_type")).toBe(
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        );
        submittedIdJag = request.form.get("assertion") ?? "";
        expect(submittedIdJag).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.signature$/);
        return new Response(JSON.stringify({
          access_token: "enterprise-access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer enterprise-access-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "enterprise-managed-fixture" },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer enterprise-access-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
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
    client = new McpClient(
      {
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
      "enterprise-managed-http-client",
      {
        authorizationResolver: async () => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret("https://client.example.test/callback?code=unused&state=unused"),
          };
        },
      },
    );

    await client.connect();
    const tools = await client.listTools();

    expect(client.getName()).toBe("enterprise-managed-fixture");
    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(resolverCalled).toBe(false);
    expect(submittedIdJag).not.toContain("identity-assertion-secret");
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "GET https://auth.example.test/.well-known/oauth-authorization-server",
      "GET https://idp.example.test/.well-known/oauth-authorization-server",
      "POST https://idp.example.test/token",
      "POST https://auth.example.test/token",
      "POST https://mcp.example.test/mcp",
      "POST https://mcp.example.test/mcp",
    ]);
  });

  it("rejects enterprise-managed authorization mismatches and malformed token exchange responses before retry", async () => {
    for (const variant of [
      {
        name: "unsupported-extension",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:read"],
        },
        idpResponse: null,
        authResponse: null,
        expected: /does not advertise enterprise-managed authorization extension/,
      },
      {
        name: "resource-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/other",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpResponse: null,
        authResponse: null,
        expected: /protected-resource metadata resource does not match configured MCP resource/,
      },
      {
        name: "missing-idp-metadata",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpMetadata: null,
        idpResponse: null,
        authResponse: null,
        expected: /identity-provider metadata discovery failed/,
      },
      {
        name: "malformed-idp-metadata",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpMetadata: {
          issuer: "https://idp.example.test",
        },
        idpResponse: null,
        authResponse: null,
        expected: /identity-provider metadata discovery failed/,
      },
      {
        name: "id-jag-token-type-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpResponse: {
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          access_token: fakeEnterpriseIdJagJwt(),
          token_type: "N_A",
          scope: "files:read",
        },
        authResponse: null,
        expected: /issued_token_type must be urn:ietf:params:oauth:token-type:id-jag/,
      },
      {
        name: "id-jag-response-token-type-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpResponse: {
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          access_token: fakeEnterpriseIdJagJwt(),
          token_type: "Bearer",
          scope: "files:read",
        },
        authResponse: null,
        expected: /token_type must be N_A/,
      },
      {
        name: "id-jag-issuer-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpResponse: {
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          access_token: fakeEnterpriseIdJagJwt({ payload: { iss: "https://other-idp.example.test" } }),
          token_type: "N_A",
          scope: "files:read",
        },
        authResponse: null,
        expected: /ID-JAG issuer did not match/,
      },
      {
        name: "jwt-bearer-bad-response",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
        },
        idpResponse: {
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          access_token: fakeEnterpriseIdJagJwt(),
          token_type: "N_A",
          scope: "files:read",
        },
        authResponse: {
          access_token: "enterprise-access-token-secret",
          token_type: "Mac",
          scope: "files:read",
        },
        expected: /token_type must be Bearer/,
      },
      {
        name: "insufficient-scope",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          extensions_supported: ["io.modelcontextprotocol/enterprise-managed-authorization"],
          scopes_supported: ["files:read", "files:write"],
        },
        idpResponse: {
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          access_token: fakeEnterpriseIdJagJwt({ payload: { scope: "files:read files:write" } }),
          token_type: "N_A",
          scope: "files:read files:write",
        },
        authResponse: {
          access_token: "enterprise-access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
        },
        expected: /authorization token did not grant the required scopes/,
        scopes: ["files:read", "files:write"],
      },
    ]) {
      let idpCalled = false;
      let authCalled = false;
      mockClientHttpFetch((request) => {
        if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
          return new Response(JSON.stringify(variant.protectedResource), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
          return new Response(JSON.stringify({
            issuer: "https://auth.example.test",
            token_endpoint: "https://auth.example.test/token",
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
            scopes_supported: ["files:read", "files:write"],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "GET" && request.url === "https://idp.example.test/.well-known/oauth-authorization-server") {
          const idpMetadata = "idpMetadata" in variant ? variant.idpMetadata : undefined;
          if (idpMetadata === null) {
            return new Response("missing identity-provider metadata", { status: 404 });
          }
          return new Response(JSON.stringify(idpMetadata ?? fakeEnterpriseIdentityProviderMetadata()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://idp.example.test/token") {
          idpCalled = true;
          if (variant.idpResponse !== null) {
            return new Response(JSON.stringify(variant.idpResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
        }
        if (request.method === "POST" && request.url === "https://auth.example.test/token") {
          authCalled = true;
          if (variant.authResponse !== null) {
            return new Response(JSON.stringify(variant.authResponse), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
        }
        return new Response("missing enterprise token", {
          status: 401,
          headers: {
            "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
          },
        });
      });
      client = new McpClient(
        {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "enterprise-managed",
            issuer: "https://auth.example.test",
            resource: "https://mcp.example.test/mcp",
            scopes: variant.scopes ?? ["files:read"],
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
        `enterprise-managed-${variant.name}`,
      );

      await expect(client.connect()).rejects.toThrow(variant.expected);
      if (variant.idpResponse === null) expect(idpCalled).toBe(false);
      if (variant.authResponse === null) expect(authCalled).toBe(false);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("reacquires expired enterprise-managed access tokens from the subject-token env source", async () => {
    const envKey = "KOTA_TEST_ENTERPRISE_SUBJECT_TOKEN";
    const previousEnv = process.env[envKey];
    process.env[envKey] = "env-identity-assertion-secret";
    let idpRequests = 0;
    let authRequests = 0;
    try {
      mockClientHttpFetch((request) => {
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
          return new Response(JSON.stringify(fakeEnterpriseIdentityProviderMetadata()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://idp.example.test/token") {
          idpRequests += 1;
          expect(request.form.get("subject_token")).toBe("env-identity-assertion-secret");
          return new Response(JSON.stringify({
            issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
            access_token: fakeEnterpriseIdJagJwt({ payload: { jti: `id-jag-${idpRequests}` } }),
            token_type: "N_A",
            scope: "files:read",
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://auth.example.test/token") {
          authRequests += 1;
          return new Response(JSON.stringify({
            access_token: authRequests === 1
              ? "expired-enterprise-access-token-secret"
              : "fresh-enterprise-access-token-secret",
            token_type: "Bearer",
            scope: "files:read",
            expires_in: authRequests === 1 ? 0 : 3600,
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer expired-enterprise-access-token-secret") {
          return jsonRpcHttpResponse(request.body.id, {
            supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
            capabilities: { tools: {} },
          });
        }
        if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer fresh-enterprise-access-token-secret") {
          return jsonRpcHttpResponse(request.body.id, {
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
      client = new McpClient(
        {
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
              source: { kind: "env", name: envKey },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        },
        "enterprise-managed-expiry-client",
      );

      await client.connect();
      const tools = await client.listTools();

      expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
      expect(idpRequests).toBe(2);
      expect(authRequests).toBe(2);
    } finally {
      if (previousEnv === undefined) delete process.env[envKey];
      else process.env[envKey] = previousEnv;
    }
  });

  it("redacts enterprise-managed identity assertions, grants, credentials, and bearer tokens from runtime failures", async () => {
    const envKey = "KOTA_TEST_ENTERPRISE_REDACTION_SUBJECT_TOKEN";
    const previousEnv = process.env[envKey];
    process.env[envKey] = "env-identity-assertion-secret";
    let idJag = "";
    try {
      mockClientHttpFetch((request) => {
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
          return new Response(JSON.stringify(fakeEnterpriseIdentityProviderMetadata({
            scopes_supported: ["files:read"],
          })), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://idp.example.test/token") {
          idJag = fakeEnterpriseIdJagJwt();
          return new Response(JSON.stringify({
            issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
            access_token: idJag,
            token_type: "N_A",
            scope: "files:read",
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://auth.example.test/token") {
          return new Response(JSON.stringify({
            access_token: "enterprise-access-token-secret",
            token_type: "Bearer",
            scope: "files:read",
            expires_in: 3600,
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer enterprise-access-token-secret") {
          return jsonRpcHttpResponse(request.body.id, {
            supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
            capabilities: { tools: {} },
          });
        }
        if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer enterprise-access-token-secret") {
          return jsonRpcHttpResponse(request.body.id, {
            tools: [{ name: "raw_error", inputSchema: { type: "object" } }],
          });
        }
        if (request.body.method === "tools/call") {
          return new Response(
            `env-identity-assertion-secret ${idJag} client-secret Basic a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA== enterprise-access-token-secret`,
            {
              status: 500,
              headers: { "content-type": "text/plain" },
            },
          );
        }
        return new Response("missing enterprise token", {
          status: 401,
          headers: {
            "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
          },
        });
      });

      client = new McpClient(
        {
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
              source: { kind: "env", name: envKey },
            },
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        },
        "enterprise-managed-redaction-client",
      );

      await client.connect();
      await client.listTools();

      await expect(client.callTool("raw_error", {})).rejects.toThrow(
        /\[redacted\] \[redacted\] \[redacted\] \[redacted\] \[redacted\]/,
      );
      await expect(client.callTool("raw_error", {})).rejects.not.toThrow(
        /env-identity-assertion-secret|client-secret|a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA==|enterprise-access-token-secret/,
      );
      await expect(client.callTool("raw_error", {})).rejects.not.toThrow(idJag);
    } finally {
      if (previousEnv === undefined) delete process.env[envKey];
      else process.env[envKey] = previousEnv;
    }
  });

  it("rejects malformed OAuth client credentials configuration before authorization", () => {
    const { privateKeyPem } = privateKeyJwtTestKeyPair();
    const ecPrivateKeyPem = privateKeyJwtEcPrivateKey();
    expect(() => new McpClient({
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
      } as never,
    }, "missing-client-secret")).toThrow(/clientSecret must be a non-empty string/);

    expect(() => new McpClient({
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
        },
      } as never,
    }, "mixed-private-key-jwt-client-secret")).toThrow(/unexpected field clientSecret/);

    expect(() => new McpClient({
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
      } as never,
    }, "unsupported-client-auth-method")).toThrow(
      /tokenEndpointAuthMethod must be client_secret_basic or private_key_jwt/,
    );

    expect(() => new McpClient({
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
        },
      } as never,
    }, "missing-private-key-jwt-key")).toThrow(/privateKeyPem must be a non-empty string/);

    expect(() => new McpClient({
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
    }, "malformed-private-key-jwt-key")).toThrow(/privateKeyPem must be a valid PEM private key/);

    expect(() => new McpClient({
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
    }, "non-rsa-private-key-jwt-key")).toThrow(
      /privateKeyPem must be an RSA private key usable with RS256/,
    );

    expect(() => new McpClient({
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
      } as never,
    }, "unsupported-private-key-jwt-algorithm")).toThrow(/signingAlgorithm must be RS256/);
  });

  it("rejects OAuth client credentials metadata mismatches before using configured secrets", async () => {
    for (const variant of [
      {
        name: "issuer-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://other-auth.example.test"],
        },
        authorizationServer: null,
        challengeScope: "files:read",
        expected: /issuer "https:\/\/auth\.example\.test".*not advertised/,
      },
      {
        name: "resource-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/other",
          authorization_servers: ["https://auth.example.test"],
        },
        authorizationServer: null,
        challengeScope: "files:read",
        expected: /protected-resource metadata resource does not match configured MCP HTTP URL/,
      },
      {
        name: "challenge-scope-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        },
        authorizationServer: null,
        challengeScope: "files:write",
        expected: /challenge requested scope outside configured client credentials scopes: files:write/,
      },
      {
        name: "protected-resource-scope-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:write"],
        },
        authorizationServer: null,
        challengeScope: "files:read",
        expected: /protected-resource metadata does not advertise configured scope files:read/,
      },
      {
        name: "unsupported-auth-method",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        },
        authorizationServer: {
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
        },
        challengeScope: "files:read",
        expected: /does not advertise token endpoint auth method client_secret_basic/,
      },
      {
        name: "authorization-server-scope-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        },
        authorizationServer: {
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          scopes_supported: ["files:write"],
        },
        challengeScope: "files:read",
        expected: /authorization server does not advertise configured scope files:read/,
      },
    ]) {
      let tokenEndpointCalled = false;
      mockClientHttpFetch((request) => {
        if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
          return new Response(JSON.stringify(variant.protectedResource), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (variant.authorizationServer && request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
          return new Response(JSON.stringify(variant.authorizationServer), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://auth.example.test/token") {
          tokenEndpointCalled = true;
        }
        return new Response("missing token", {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="${variant.challengeScope ?? "files:read"}"`,
          },
        });
      });
      client = new McpClient(
        {
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
        `client-credentials-${variant.name}`,
      );

      await expect(client.connect()).rejects.toThrow(variant.expected);
      expect(tokenEndpointCalled).toBe(false);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("rejects private_key_jwt before signing when authorization-server metadata does not advertise it", async () => {
    const { privateKeyPem } = privateKeyJwtTestKeyPair();
    let tokenEndpointCalled = false;
    mockClientHttpFetch((request) => {
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
        tokenEndpointCalled = true;
      }
      return new Response("missing private_key_jwt token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "private-key-jwt-unsupported-method-client",
    );

    await expect(client.connect()).rejects.toThrow(
      /does not advertise token endpoint auth method private_key_jwt/,
    );
    expect(tokenEndpointCalled).toBe(false);
  });

  it("rejects private_key_jwt issuer, resource, and scope metadata mismatches before signing", async () => {
    for (const variant of [
      {
        name: "issuer-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://other-auth.example.test"],
        },
        authorizationServer: null,
        expected: /issuer "https:\/\/auth\.example\.test".*not advertised/,
      },
      {
        name: "resource-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/other",
          authorization_servers: ["https://auth.example.test"],
        },
        authorizationServer: null,
        expected: /protected-resource metadata resource does not match configured MCP HTTP URL/,
      },
      {
        name: "protected-resource-scope-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:write"],
        },
        authorizationServer: null,
        expected: /protected-resource metadata does not advertise configured scope files:read/,
      },
      {
        name: "authorization-server-scope-mismatch",
        protectedResource: {
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
        },
        authorizationServer: {
          issuer: "https://auth.example.test",
          token_endpoint: "https://auth.example.test/token",
          token_endpoint_auth_methods_supported: ["private_key_jwt"],
          scopes_supported: ["files:write"],
        },
        expected: /authorization server does not advertise configured scope files:read/,
      },
    ]) {
      const { privateKeyPem } = privateKeyJwtTestKeyPair();
      let tokenEndpointCalled = false;
      mockClientHttpFetch((request) => {
        if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
          return new Response(JSON.stringify(variant.protectedResource), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (variant.authorizationServer && request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server") {
          return new Response(JSON.stringify(variant.authorizationServer), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (request.method === "POST" && request.url === "https://auth.example.test/token") {
          tokenEndpointCalled = true;
        }
        return new Response("missing private_key_jwt token", {
          status: 401,
          headers: {
            "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
          },
        });
      });
      client = new McpClient(
        {
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
        `private-key-jwt-${variant.name}`,
      );

      await expect(client.connect()).rejects.toThrow(variant.expected);
      expect(tokenEndpointCalled).toBe(false);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("requires protected-resource metadata for OAuth client credentials mode", async () => {
    mockClientHttpFetch((request) => {
      if (
        request.method === "GET" &&
        (
          request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp" ||
          request.url === "https://mcp.example.test/.well-known/oauth-protected-resource"
        )
      ) {
        return new Response("not found", { status: 404 });
      }
      return new Response("missing metadata hint", {
        status: 401,
        headers: { "www-authenticate": 'Bearer scope="files:read"' },
      });
    });
    client = new McpClient(
      {
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
      "client-credentials-metadata-required",
    );

    await expect(client.connect()).rejects.toThrow(/protected-resource metadata unavailable/);
  });

  it("rejects OAuth client credentials token endpoint failures and insufficient granted scope without leaking secrets", async () => {
    for (const variant of [
      {
        name: "token-endpoint-failure",
        configScopes: ["files:read"],
        challengeScope: "files:read",
        expectedRequestScope: "files:read",
        tokenResponse: new Response("client-secret client-credentials-token-secret", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
        expected: /token endpoint failed: HTTP 500/,
      },
      {
        name: "insufficient-scope",
        configScopes: ["files:read", "files:write"],
        challengeScope: "files:write",
        expectedRequestScope: "files:read files:write",
        tokenResponse: new Response(JSON.stringify({
          access_token: "client-credentials-token-secret",
          token_type: "Bearer",
          scope: "files:read",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        expected: /authorization token did not grant the required scopes/,
      },
    ]) {
      mockClientHttpFetch((request) => {
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
          expect(request.form.get("scope")).toBe(variant.expectedRequestScope);
          return variant.tokenResponse;
        }
        return new Response("missing token", {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="${variant.challengeScope}"`,
          },
        });
      });
      client = new McpClient(
        {
          type: "http",
          url: "https://mcp.example.test/mcp",
          authorization: {
            type: "oauth-client-credentials",
            issuer: "https://auth.example.test",
            scopes: variant.configScopes,
            tokenEndpointAuthMethod: "client_secret_basic",
            client: {
              kind: "registered",
              clientId: "kota-client",
              clientSecret: "client-secret",
            },
          },
        },
        `client-credentials-${variant.name}`,
      );

      let thrown: unknown = null;
      try {
        await client.connect();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toMatch(variant.expected);
      expect(String(thrown)).not.toMatch(/client-secret|client-credentials-token-secret/);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("reacquires expired OAuth client credentials tokens when no refresh token is returned", async () => {
    let tokenRequests = 0;
    mockClientHttpFetch((request) => {
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
        tokenRequests += 1;
        expect(request.form.get("grant_type")).toBe("client_credentials");
        return new Response(JSON.stringify({
          access_token: tokenRequests === 1 ? "expired-token-secret" : "fresh-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: tokenRequests === 1 ? 0 : 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer expired-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer fresh-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
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
    client = new McpClient(
      {
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
      "client-credentials-expiry-client",
    );

    await client.connect();
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(tokenRequests).toBe(2);
  });

  it("redacts malformed OAuth client credentials token JSON before surfacing parser diagnostics", async () => {
    let tokenRequests = 0;
    mockClientHttpFetch((request) => {
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
        tokenRequests += 1;
        if (tokenRequests === 1) {
          return new Response(JSON.stringify({
            access_token: "expired-token-secret",
            token_type: "Bearer",
            scope: "files:read",
            expires_in: 0,
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(`${request.headers.get("authorization")} client-secret expired-token-secret`, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer expired-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "client-credentials-malformed-json-client",
    );

    await client.connect();

    let thrown: unknown = null;
    try {
      await client.listTools();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("token endpoint returned malformed JSON");
    expect(String(thrown)).not.toMatch(
      /client-secret|client-sec|Basic a290|a290YS1jb|expired-token-secret|expired-t/,
    );
    expect(tokenRequests).toBe(2);
  });

  it("redacts OAuth client credentials secrets, basic auth, and acquired bearer tokens from runtime failures", async () => {
    mockClientHttpFetch((request) => {
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
        return new Response(JSON.stringify({
          access_token: "client-credentials-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer client-credentials-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer client-credentials-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "raw_error", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        return new Response(
          "client-secret Basic a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA== client-credentials-token-secret",
          {
            status: 500,
            headers: { "content-type": "text/plain" },
          },
        );
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "client-credentials-redaction-client",
    );

    await client.connect();
    await client.listTools();

    await expect(client.callTool("raw_error", {})).rejects.toThrow(
      /\[redacted\] \[redacted\] \[redacted\]/,
    );
    await expect(client.callTool("raw_error", {})).rejects.not.toThrow(
      /client-secret|a290YS1jbGllbnQ6Y2xpZW50LXNlY3JldA==|client-credentials-token-secret/,
    );
  });

  it("rejects private_key_jwt token endpoint assertion validation failures without leaking key material or assertions", async () => {
    for (const variant of [
      {
        name: "bad-audience",
        reject: (payload: PrivateKeyJwtPayload) => payload.aud !== "https://auth.example.test/other-token",
      },
      {
        name: "bad-expiry",
        reject: (payload: PrivateKeyJwtPayload) => payload.exp > payload.iat + 1,
      },
    ]) {
      const { privateKeyPem, publicKeyPem } = privateKeyJwtTestKeyPair();
      let submittedAssertion = "";
      mockClientHttpFetch((request) => {
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
          submittedAssertion = request.form.get("client_assertion") ?? "";
          const payload = verifyPrivateKeyJwtAssertion(submittedAssertion, publicKeyPem, {
            audience: "https://auth.example.test/token",
            clientId: "kota-client",
          });
          if (variant.reject(payload)) {
            return new Response(`${privateKeyPem} ${submittedAssertion}`, {
              status: 400,
              headers: { "content-type": "text/plain" },
            });
          }
        }
        return new Response("missing private_key_jwt token", {
          status: 401,
          headers: {
            "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
          },
        });
      });
      client = new McpClient(
        {
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
        `private-key-jwt-${variant.name}`,
      );

      let thrown: unknown = null;
      try {
        await client.connect();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toMatch(/token endpoint failed: HTTP 400/);
      expect(String(thrown)).not.toContain(privateKeyPem);
      expect(String(thrown)).not.toContain(submittedAssertion);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("reacquires expired private_key_jwt client credentials tokens with fresh assertions", async () => {
    const { privateKeyPem, publicKeyPem } = privateKeyJwtTestKeyPair();
    const assertions: string[] = [];
    let tokenRequests = 0;
    mockClientHttpFetch((request) => {
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
        tokenRequests += 1;
        const assertion = request.form.get("client_assertion") ?? "";
        assertions.push(assertion);
        verifyPrivateKeyJwtAssertion(assertion, publicKeyPem, {
          audience: "https://auth.example.test/token",
          clientId: "kota-client",
        });
        return new Response(JSON.stringify({
          access_token: tokenRequests === 1 ? "expired-private-key-token-secret" : "fresh-private-key-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: tokenRequests === 1 ? 0 : 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer expired-private-key-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer fresh-private-key-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "read_file", inputSchema: { type: "object" } }],
        });
      }
      return new Response("missing private_key_jwt token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "private-key-jwt-expiry-client",
    );

    await client.connect();
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(tokenRequests).toBe(2);
    expect(assertions).toHaveLength(2);
    expect(assertions[0]).not.toBe(assertions[1]);
  });

  it("redacts private_key_jwt private keys, assertions, and acquired bearer tokens from runtime failures", async () => {
    const { privateKeyPem } = privateKeyJwtTestKeyPair();
    let submittedAssertion = "";
    mockClientHttpFetch((request) => {
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
        submittedAssertion = request.form.get("client_assertion") ?? "";
        return new Response(JSON.stringify({
          access_token: "private-key-jwt-token-secret",
          token_type: "Bearer",
          scope: "files:read",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer private-key-jwt-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer private-key-jwt-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "raw_error", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call") {
        return new Response(
          `${privateKeyPem} ${submittedAssertion} private-key-jwt-token-secret`,
          {
            status: 500,
            headers: { "content-type": "text/plain" },
          },
        );
      }
      return new Response("missing private_key_jwt token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "private-key-jwt-redaction-client",
    );

    await client.connect();
    await client.listTools();

    await expect(client.callTool("raw_error", {})).rejects.toThrow(
      /\[redacted\] \[redacted\] \[redacted\]/,
    );
    await expect(client.callTool("raw_error", {})).rejects.not.toThrow(
      /private-key-jwt-token-secret/,
    );
    await expect(client.callTool("raw_error", {})).rejects.not.toThrow(submittedAssertion);
    await expect(client.callTool("raw_error", {})).rejects.not.toThrow(privateKeyPem);
  });

  it("falls back to OpenID Connect discovery when OAuth authorization-server metadata is unavailable", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test/tenant"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/oauth-authorization-server/tenant") {
        return new Response("not found", { status: 404 });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/.well-known/openid-configuration/tenant") {
        return new Response("not found", { status: 404 });
      }
      if (request.method === "GET" && request.url === "https://auth.example.test/tenant/.well-known/openid-configuration") {
        return new Response(JSON.stringify({
          issuer: "https://auth.example.test/tenant",
          authorization_endpoint: "https://auth.example.test/tenant/authorize",
          token_endpoint: "https://auth.example.test/tenant/token",
          code_challenge_methods_supported: ["S256"],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.method === "POST" && request.url === "https://auth.example.test/tenant/token") {
        return new Response(JSON.stringify({
          access_token: "tenant-access-token-secret",
          token_type: "Bearer",
          scope: "files:read",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer tenant-access-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {},
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
        type: "http",
        url: "https://mcp.example.test/mcp",
        authorization: {
          type: "oauth",
          issuer: "https://auth.example.test/tenant",
          redirectUri: "https://client.example.test/callback",
          scopes: ["files:read"],
          client: { kind: "registered", clientId: "kota-client" },
        },
      },
      "oidc-fallback-client",
      {
        authorizationResolver: async (request) => ({
          callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-tenant&state=${request.state}`),
        }),
      },
    );

    await client.connect();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://mcp.example.test/mcp",
      "GET https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
      "GET https://auth.example.test/.well-known/oauth-authorization-server/tenant",
      "GET https://auth.example.test/.well-known/openid-configuration/tenant",
      "GET https://auth.example.test/tenant/.well-known/openid-configuration",
      "POST https://auth.example.test/tenant/token",
      "POST https://mcp.example.test/mcp",
    ]);
  });

  it("rejects authorization-server metadata that does not explicitly advertise PKCE S256", async () => {
    let resolverCalled = false;
    mockClientHttpFetch((request) => {
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
        }), {
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
    client = new McpClient(
      {
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
      "pkce-metadata-client",
      {
        authorizationResolver: async (request) => {
          resolverCalled = true;
          return {
            callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-1&state=${request.state}`),
          };
        },
      },
    );

    await expect(client.connect()).rejects.toThrow(/authorization server does not support PKCE S256/);
    expect(resolverCalled).toBe(false);
  });

  it("binds authorization-server metadata issuer and callback issuer parameters exactly", async () => {
    for (const variant of [
      {
        metadataIssuer: "https://auth.example.test/",
        callbackIssuer: "https://auth.example.test",
      },
      {
        metadataIssuer: "https://auth.example.test",
        callbackIssuer: "https://auth.example.test/",
      },
      {
        metadataIssuer: "https://auth.example.test",
        callbackIssuer: "https://AUTH.example.test",
      },
    ]) {
      mockClientHttpFetch((request) => {
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
            issuer: variant.metadataIssuer,
            authorization_endpoint: "https://auth.example.test/authorize",
            token_endpoint: "https://auth.example.test/token",
            code_challenge_methods_supported: ["S256"],
            authorization_response_iss_parameter_supported: true,
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
          return jsonRpcHttpResponse(request.body.id, {
            supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
            capabilities: {},
          });
        }
        return new Response("missing token", {
          status: 401,
          headers: {
            "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
          },
        });
      });
      client = new McpClient(
        {
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
        "exact-issuer-client",
        {
          authorizationResolver: async (request) => ({
            callbackUrl: mcpOAuthSecret(
              `https://client.example.test/callback?code=code-1&state=${request.state}&iss=${encodeURIComponent(variant.callbackIssuer)}`,
            ),
          }),
        },
      );

      await expect(client.connect()).rejects.toThrow(/issuer/);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("rejects OAuth issuer mismatches before opening an operator authorization URL", async () => {
    let resolverCalled = false;
    mockClientHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://other-auth.example.test"],
        }), {
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
    client = new McpClient(
      {
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
      "issuer-client",
      {
        authorizationResolver: async () => {
          resolverCalled = true;
          return { callbackUrl: mcpOAuthSecret("https://client.example.test/callback?code=unused&state=unused") };
        },
      },
    );

    await expect(client.connect()).rejects.toThrow(/issuer "https:\/\/auth\.example\.test".*not advertised/);
    expect(resolverCalled).toBe(false);
  });

  it("fails loudly when dynamic client registration is disabled or unsupported", async () => {
    expect(() => new McpClient({
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
    }, "dcr-disabled")).toThrow(/dynamic client registration is disabled/);

    mockClientHttpFetch((request) => {
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
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
            dynamicClientRegistration: { enabled: true },
          },
        },
      },
      "dcr-unsupported",
      {
        authorizationResolver: async (request) => ({
          callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-1&state=${request.state}`),
        }),
      },
    );

    await expect(client.connect()).rejects.toThrow(/does not advertise dynamic client registration/);
  });

  it("validates OAuth callback state and required issuer response parameter", async () => {
    for (const callbackUrl of [
      "https://client.example.test/callback?code=code-1&state=wrong&iss=https%3A%2F%2Fauth.example.test",
      "https://client.example.test/callback?code=code-1&state=STATE_PLACEHOLDER",
      "https://client.example.test/callback?code=code-1&state=STATE_PLACEHOLDER&iss=https%3A%2F%2Fevil.example.test",
    ]) {
      mockClientHttpFetch((request) => {
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
            authorization_response_iss_parameter_supported: true,
          }), {
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
      client = new McpClient(
        {
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
        "callback-client",
        {
          authorizationResolver: async (request) => ({
            callbackUrl: mcpOAuthSecret(callbackUrl.replace("STATE_PLACEHOLDER", request.state)),
          }),
        },
      );

      await expect(client.connect()).rejects.toThrow(/OAuth callback/);
      await client.close();
      client = null;
      vi.restoreAllMocks();
    }
  });

  it("redacts token endpoint failures and reports deterministic next steps when no authorization resolver is available", async () => {
    const makeProtectedFetch = (tokenEndpointFails: boolean) => mockClientHttpFetch((request) => {
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
      if (tokenEndpointFails && request.method === "POST" && request.url === "https://auth.example.test/token") {
        return new Response("access-token-secret refresh-token-secret code-1 client-secret", {
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

    makeProtectedFetch(false);
    client = new McpClient(
      {
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
      "no-operator-client",
    );

    await expect(client.connect()).rejects.toThrow(
      /interactive authorization is required but no MCP authorization resolver is configured/,
    );
    await client.close();
    client = null;
    vi.restoreAllMocks();

    makeProtectedFetch(true);
    client = new McpClient(
      {
        type: "http",
        url: "https://mcp.example.test/mcp",
        authorization: {
          type: "oauth",
          issuer: "https://auth.example.test",
          redirectUri: "https://client.example.test/callback",
          scopes: ["files:read"],
          client: { kind: "registered", clientId: "kota-client", clientSecret: "client-secret" },
        },
      },
      "token-failure-client",
      {
        authorizationResolver: async (request) => ({
          callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-1&state=${request.state}`),
        }),
      },
    );

    await expect(client.connect()).rejects.toThrow(/token endpoint failed: HTTP 500/);
    await expect(client.connect()).rejects.not.toThrow(/access-token-secret|refresh-token-secret|code-1|client-secret/);
  });

  it("uses refresh tokens and performs insufficient-scope step-up without losing previously granted scopes", async () => {
    const resolverScopes: string[][] = [];
    mockClientHttpFetch((request) => {
      if (request.method === "GET" && request.url === "https://mcp.example.test/.well-known/oauth-protected-resource/mcp") {
        return new Response(JSON.stringify({
          resource: "https://mcp.example.test/mcp",
          authorization_servers: ["https://auth.example.test"],
          scopes_supported: ["files:read", "files:write"],
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
        if (request.form.get("grant_type") === "refresh_token") {
          expect(request.form.get("refresh_token")).toBe("refresh-token-secret");
          return new Response(JSON.stringify({
            access_token: "refreshed-token-secret",
            token_type: "Bearer",
            scope: "files:read",
            refresh_token: "refresh-token-secret",
            expires_in: 3600,
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const code = request.form.get("code");
        return new Response(JSON.stringify({
          access_token: code === "code-step-up" ? "step-up-token-secret" : "initial-token-secret",
          token_type: "Bearer",
          scope: code === "code-step-up" ? "files:read files:write" : "files:read",
          refresh_token: "refresh-token-secret",
          expires_in: code === "code-step-up" ? 3600 : 0,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (request.body.method === "server/discover" && request.headers.get("authorization") === "Bearer initial-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer refreshed-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "write_file", inputSchema: { type: "object" } }],
        });
      }
      if (request.body.method === "tools/call" && request.headers.get("authorization") === "Bearer refreshed-token-secret") {
        return new Response("needs write", {
          status: 403,
          headers: {
            "www-authenticate": 'Bearer error="insufficient_scope", scope="files:write", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
          },
        });
      }
      if (request.body.method === "tools/call" && request.headers.get("authorization") === "Bearer step-up-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          resultType: "complete",
          content: [{ type: "text", text: "wrote" }],
        });
      }
      return new Response("missing token", {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="files:read"',
        },
      });
    });
    client = new McpClient(
      {
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
      "step-up-client",
      {
        authorizationResolver: async (request) => {
          resolverScopes.push(request.scopes);
          const code = request.scopes.includes("files:write") ? "code-step-up" : "code-initial";
          return {
            callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=${code}&state=${request.state}`),
          };
        },
      },
    );

    await client.connect();
    await client.listTools();
    const result = expectCompletedResult(await client.callTool("write_file", {}));

    expect(result.text).toBe("wrote");
    expect(resolverScopes).toEqual([
      ["files:read"],
      ["files:read", "files:write"],
    ]);
  });

  it("redacts acquired bearer tokens from protected-resource HTTP and JSON-RPC failures", async () => {
    mockClientHttpFetch((request) => {
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
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/list" && request.headers.get("authorization") === "Bearer access-token-secret") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [
            { name: "raw_error", inputSchema: { type: "object" } },
            { name: "json_error", inputSchema: { type: "object" } },
          ],
        });
      }
      if (request.body.method === "tools/call" && request.body.params?.name === "raw_error") {
        return new Response("upstream echoed access-token-secret", {
          status: 500,
          headers: { "content-type": "text/plain" },
        });
      }
      if (request.body.method === "tools/call" && request.body.params?.name === "json_error") {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: request.body.id,
          error: {
            code: -32000,
            message: "upstream echoed access-token-secret",
          },
        }), {
          status: 500,
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
    client = new McpClient(
      {
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
      "redacted-runtime-client",
      {
        authorizationResolver: async (request) => ({
          callbackUrl: mcpOAuthSecret(`https://client.example.test/callback?code=code-1&state=${request.state}`),
        }),
      },
    );

    await client.connect();
    await client.listTools();

    await expect(client.callTool("raw_error", {})).rejects.toThrow(/upstream echoed \[redacted\]/);
    await expect(client.callTool("raw_error", {})).rejects.not.toThrow(/access-token-secret/);
    await expect(client.callTool("json_error", {})).rejects.toThrow(/upstream echoed \[redacted\]/);
    await expect(client.callTool("json_error", {})).rejects.not.toThrow(/access-token-secret/);
  });

  it("opens an HTTP subscriptions/listen SSE stream for advertised tools.listChanged", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "http-list-changed-fixture" },
        });
      }
      if (request.body.method === "subscriptions/listen") {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseMessage({
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
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-list-changed-client",
    );

    await client.connect();

    expect(client.getName()).toBe("http-list-changed-fixture");
    expect(client.supportsToolListChanged()).toBe(true);
    await waitForAssertion(() => {
      expect(requests.map((request) => request.body.method)).toContain("subscriptions/listen");
    });
    const listen = requests.find((request) => request.body.method === "subscriptions/listen");
    expect(listen?.body.params?.notifications).toEqual({
      toolsListChanged: true,
    });
  });

  it("rejects server-to-client requests that collide with HTTP subscriptions/listen ids", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "http-list-changed-peer-request-fixture" },
        });
      }
      if (request.body.method === "subscriptions/listen") {
        return new Response(sseMessage({
          jsonrpc: "2.0",
          id: request.body.id,
          method: "ping",
        }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-list-changed-peer-request-client",
    );

    await client.connect();

    await waitForAssertion(() => {
      expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(
        /failed to open subscription: .*server-to-client request "ping" with id 2 arrived on HTTP SSE response stream; HTTP SSE response stream cannot send JSON-RPC responses/,
      ));
    });
  });

  it("opens an HTTP subscriptions/listen SSE stream for resource and prompt listChanged", async () => {
    const requests: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      requests.push(request);
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: {
            resources: { listChanged: true },
            prompts: { listChanged: true },
          },
          serverInfo: { name: "http-catalog-list-changed-fixture" },
        });
      }
      if (request.body.method === "subscriptions/listen") {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseMessage({
              jsonrpc: "2.0",
              method: "notifications/subscriptions/acknowledged",
              params: {
                _meta: {
                  "io.modelcontextprotocol/subscriptionId": String(request.body.id),
                },
                notifications: {
                  resourcesListChanged: true,
                  promptsListChanged: true,
                },
              },
            })));
          },
        }), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-catalog-list-changed-client",
    );

    await client.connect();

    expect(client.supportsResourceListChanged()).toBe(true);
    expect(client.supportsPromptListChanged()).toBe(true);
    await waitForAssertion(() => {
      expect(requests.map((request) => request.body.method)).toContain("subscriptions/listen");
    });
    const listen = requests.find((request) => request.body.method === "subscriptions/listen");
    expect(listen?.body.params?.notifications).toEqual({
      resourcesListChanged: true,
      promptsListChanged: true,
    });
  });

  it("lists and retrieves remote resources, templates, and prompts across pages", async () => {
    const seenMethods: string[] = [];
    mockClientHttpFetch((request) => {
      seenMethods.push(request.body.method ?? "");
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {}, prompts: {} },
          serverInfo: { name: "catalog-http-fixture" },
        });
      }
      if (request.body.method === "resources/list") {
        expect(request.headers.get("mcp-method")).toBe("resources/list");
        if (!request.body.params?.cursor) {
          return jsonRpcHttpResponse(request.body.id, {
            resources: [{
              uri: "file:///tmp/first.md",
              name: "first",
              title: "First",
              description: "First page",
              mimeType: "text/markdown",
            }],
            nextCursor: "resources-page-2",
          });
        }
        return jsonRpcHttpResponse(request.body.id, {
          resources: [{ uri: "file:///tmp/second.md", name: "second" }],
        });
      }
      if (request.body.method === "resources/templates/list") {
        if (!request.body.params?.cursor) {
          return jsonRpcHttpResponse(request.body.id, {
            resourceTemplates: [{
              uriTemplate: "file:///tmp/{name}.md",
              name: "tmp-file",
              title: "Temp file",
            }],
            nextCursor: "templates-page-2",
          });
        }
        return jsonRpcHttpResponse(request.body.id, {
          resourceTemplates: [{
            uriTemplate: "repo://{path}",
            name: "repo-path",
            description: "Repo path",
          }],
        });
      }
      if (request.body.method === "prompts/list") {
        if (!request.body.params?.cursor) {
          return jsonRpcHttpResponse(request.body.id, {
            prompts: [{
              name: "summarize",
              title: "Summarize",
              arguments: [{ name: "topic", required: true }],
            }],
            nextCursor: "prompts-page-2",
          });
        }
        return jsonRpcHttpResponse(request.body.id, {
          prompts: [{ name: "triage", description: "Triage prompt" }],
        });
      }
      if (request.body.method === "resources/read") {
        expect(request.headers.get("mcp-name")).toBe("file:///tmp/first.md");
        return jsonRpcHttpResponse(request.body.id, {
          resultType: "complete",
          contents: [{
            uri: "file:///tmp/first.md",
            mimeType: "text/markdown",
            text: "# First",
          }],
          _meta: { trace: "resource-read" },
        });
      }
      if (request.body.method === "prompts/get") {
        expect(request.headers.get("mcp-name")).toBe("summarize");
        return jsonRpcHttpResponse(request.body.id, {
          resultType: "complete",
          description: "Prompt text from the remote server",
          messages: [
            { role: "user", content: { type: "text", text: "Summarize runtime state" } },
            {
              role: "assistant",
              content: {
                type: "resource",
                resource: {
                  uri: "file:///tmp/context.md",
                  text: "remote context",
                },
              },
            },
          ],
          _meta: { trace: "prompt-get" },
        });
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "catalog-http-client",
    );

    await client.connect();
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();
    const resource = await client.readResource("file:///tmp/first.md");
    const prompt = await client.getPrompt("summarize", { topic: "runtime" });

    expect(resources.map((entry) => entry.name)).toEqual(["first", "second"]);
    expect(templates.map((entry) => entry.name)).toEqual(["tmp-file", "repo-path"]);
    expect(prompts.map((entry) => entry.name)).toEqual(["summarize", "triage"]);
    expect(resource).toMatchObject({
      resultType: "complete",
      contents: [{ uri: "file:///tmp/first.md", text: "# First" }],
      _meta: { trace: "resource-read" },
    });
    expect(prompt).toMatchObject({
      resultType: "complete",
      description: "Prompt text from the remote server",
      messages: [
        { role: "user", content: { type: "text", text: "Summarize runtime state" } },
        {
          role: "assistant",
          content: {
            type: "resource",
            resource: { uri: "file:///tmp/context.md", text: "remote context" },
          },
        },
      ],
      _meta: { trace: "prompt-get" },
    });
    expect(seenMethods).toEqual([
      "server/discover",
      "resources/list",
      "resources/list",
      "resources/templates/list",
      "resources/templates/list",
      "prompts/list",
      "prompts/list",
      "resources/read",
      "prompts/get",
    ]);
  });

  it("decodes cache hints on tools, resource, prompt, and resource-read results", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "cache-hints-fixture" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{ name: "cacheable_tool", inputSchema: { type: "object" } }],
          ttlMs: 5_000,
          cacheScope: "public",
        });
      }
      if (request.body.method === "resources/list") {
        return jsonRpcHttpResponse(request.body.id, {
          resources: [{ uri: "file:///tmp/cache.md", name: "cache" }],
          ttlMs: 4_000,
          cacheScope: "private",
        });
      }
      if (request.body.method === "resources/templates/list") {
        return jsonRpcHttpResponse(request.body.id, {
          resourceTemplates: [{ uriTemplate: "file:///{name}.md", name: "file" }],
          ttlMs: 3_000,
          cacheScope: "public",
        });
      }
      if (request.body.method === "prompts/list") {
        return jsonRpcHttpResponse(request.body.id, {
          prompts: [{ name: "brief" }],
          ttlMs: 2_000,
          cacheScope: "public",
        });
      }
      if (request.body.method === "resources/read") {
        return jsonRpcHttpResponse(request.body.id, {
          resultType: "complete",
          contents: [{ uri: "file:///tmp/cache.md", text: "cached resource" }],
          ttlMs: 1_000,
          cacheScope: "private",
        });
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "cache-hints-client",
    );

    await client.connect();

    await expect(client.listToolsPage()).resolves.toMatchObject({
      tools: [{ name: "cacheable_tool" }],
      cache: { ttlMs: 5_000, cacheScope: "public" },
    });
    await expect(client.listResourcesPage()).resolves.toMatchObject({
      resources: [{ uri: "file:///tmp/cache.md", name: "cache" }],
      cache: { ttlMs: 4_000, cacheScope: "private" },
    });
    await expect(client.listResourceTemplatesPage()).resolves.toMatchObject({
      resourceTemplates: [{ uriTemplate: "file:///{name}.md", name: "file" }],
      cache: { ttlMs: 3_000, cacheScope: "public" },
    });
    await expect(client.listPromptsPage()).resolves.toMatchObject({
      prompts: [{ name: "brief" }],
      cache: { ttlMs: 2_000, cacheScope: "public" },
    });
    await expect(client.readResource("file:///tmp/cache.md")).resolves.toMatchObject({
      resultType: "complete",
      cache: { ttlMs: 1_000, cacheScope: "private" },
      contents: [{ uri: "file:///tmp/cache.md", text: "cached resource" }],
    });
  });

  it("normalizes absent or negative ttl cache hints to immediately stale private cache hints", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {}, prompts: {} },
        });
      }
      if (request.body.method === "resources/list") {
        return jsonRpcHttpResponse(request.body.id, {
          resources: [{ uri: "file:///tmp/old.md", name: "old" }],
        });
      }
      if (request.body.method === "prompts/list") {
        return jsonRpcHttpResponse(request.body.id, {
          prompts: [{ name: "negative-ttl" }],
          ttlMs: -1,
          cacheScope: "public",
        });
      }
      return jsonRpcHttpResponse(request.body.id, {});
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "missing-cache-hints-client",
    );

    await client.connect();

    await expect(client.listResourcesPage()).resolves.toMatchObject({
      cache: { ttlMs: 0, cacheScope: "private" },
    });
    await expect(client.listPromptsPage()).resolves.toMatchObject({
      cache: { ttlMs: 0, cacheScope: "public" },
    });
  });

  it("rejects malformed cacheScope values on cacheable result pages", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {} },
        });
      }
      return jsonRpcHttpResponse(request.body.id, {
        resources: [{ uri: "file:///tmp/bad.md", name: "bad" }],
        ttlMs: 100,
        cacheScope: "shared",
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "bad-cache-scope-client",
    );
    await client.connect();

    await expect(client.listResourcesPage()).rejects.toThrow(
      /Malformed MCP resources\/list result: cacheScope must be "public" or "private"/,
    );
  });

  it("rejects malformed resource catalogs with method-specific diagnostics", async () => {
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { resources: {} },
        });
      }
      return jsonRpcHttpResponse(request.body.id, {
        resources: [{ uri: 42, name: "bad" }],
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "bad-resource-client",
    );
    await client.connect();

    await expect(client.listResources()).rejects.toThrow(
      /MCP resources\/list failed.*resources\[0\]\.uri must be a string/,
    );
  });

  it("mirrors annotated tool arguments into HTTP Mcp-Param headers", async () => {
    const toolCalls: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          serverInfo: { name: "http-header-fixture" },
        });
      }
      if (request.body.method === "tools/list") {
        return jsonRpcHttpResponse(request.body.id, {
          tools: [{
            name: "annotated",
            inputSchema: {
              type: "object",
              properties: {
                token: { type: "string", "x-mcp-header": "X-Token" },
                retries: { type: "number", "x-mcp-header": "X-Retry" },
                dryRun: { type: "boolean", "x-mcp-header": "X-Dry-Run" },
              },
            },
          }],
        });
      }
      if (request.body.method === "tools/call") {
        toolCalls.push(request);
      }
      return jsonRpcHttpResponse(request.body.id, {
        resultType: "complete",
        content: [{ type: "text", text: "ok" }],
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "http-header-client",
    );
    await client.connect();
    await client.listTools();

    const result = expectCompletedResult(await client.callTool("annotated", {
      token: "secret",
      retries: 3,
      dryRun: false,
    }));

    expect(result.text).toBe("ok");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].headers.get("mcp-param-x-token")).toBe("secret");
    expect(toolCalls[0].headers.get("mcp-param-x-retry")).toBe("3");
    expect(toolCalls[0].headers.get("mcp-param-x-dry-run")).toBe("false");
  });

  it("sends progressToken metadata for progress-enabled HTTP tool calls", async () => {
    const callRequests: RecordedClientHttpRequest[] = [];
    mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_DRAFT_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }
      if (request.body.method === "tools/call") {
        callRequests.push(request);
      }
      return jsonRpcHttpResponse(request.body.id, {
        resultType: "complete",
        content: [{ type: "text", text: "ok" }],
      });
    });
    client = new McpClient(
      { type: "http", url: "https://mcp.example.test/mcp" },
      "progress-http-client",
    );
    await client.connect();

    const result = expectCompletedResult(await client.callTool("long", {}, undefined, {
      progress: { token: "http-progress-token", onProgress: () => {} },
    }));

    expect(result.text).toBe("ok");
    expect(callRequests).toHaveLength(1);
    expect(callRequests[0].body.params?._meta?.progressToken).toBe("http-progress-token");
  });
});

describe("McpClient x-mcp-header validation", () => {
  let client: McpClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("accepts valid annotated primitive properties", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new McpClient(
      "node",
      [
        "-e",
        listToolsServerScript([
          {
            name: "headers_ok",
            inputSchema: {
              type: "object",
              properties: {
                token: { type: "string", "x-mcp-header": "X-Token" },
                retries: { type: "number", "x-mcp-header": "X-Retry" },
                dryRun: { type: "boolean", "x-mcp-header": "X-Dry-Run" },
              },
            },
          },
        ]),
      ],
      {},
      "configured-header-server",
    );
    await client.connect();

    const tools = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("headers_ok");
    expect(tools[0].inputSchema.properties.token).toEqual({
      type: "string",
      "x-mcp-header": "X-Token",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  }, 10_000);

  it("excludes tools with empty x-mcp-header values while preserving valid tools", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new McpClient(
      "node",
      [
        "-e",
        listToolsServerScript([
          { name: "kept", inputSchema: { type: "object" } },
          {
            name: "empty_header",
            inputSchema: {
              type: "object",
              properties: {
                token: { type: "string", "x-mcp-header": "" },
              },
            },
          },
        ]),
      ],
      {},
      "configured-header-server",
    );
    await client.connect();

    const tools = await client.listTools();
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));

    expect(tools.map((tool) => tool.name)).toEqual(["kept"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('server "header-test-server"');
    expect(warnings[0]).toContain('tool "empty_header"');
    expect(warnings[0]).toContain("empty value");
    errorSpy.mockRestore();
  }, 10_000);

  it("excludes tools whose x-mcp-header contains a space or colon", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new McpClient(
      "node",
      [
        "-e",
        listToolsServerScript([
          { name: "kept", inputSchema: { type: "object" } },
          {
            name: "space_header",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", "x-mcp-header": "X Query" },
              },
            },
          },
          {
            name: "colon_header",
            inputSchema: {
              type: "object",
              properties: {
                trace: { type: "string", "x-mcp-header": "X:Trace" },
              },
            },
          },
        ]),
      ],
      {},
      "configured-header-server",
    );
    await client.connect();

    const tools = await client.listTools();
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));

    expect(tools.map((tool) => tool.name)).toEqual(["kept"]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('tool "space_header"');
    expect(warnings[0]).toContain("forbidden character");
    expect(warnings[1]).toContain('tool "colon_header"');
    expect(warnings[1]).toContain("forbidden character");
    errorSpy.mockRestore();
  }, 10_000);

  it("excludes duplicate x-mcp-header values case-insensitively", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new McpClient(
      "node",
      [
        "-e",
        listToolsServerScript([
          {
            name: "duplicate_header",
            inputSchema: {
              type: "object",
              properties: {
                first: { type: "string", "x-mcp-header": "X-Trace" },
                second: { type: "string", "x-mcp-header": "x-trace" },
              },
            },
          },
        ]),
      ],
      {},
      "configured-header-server",
    );
    await client.connect();

    const tools = await client.listTools();
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));

    expect(tools).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('tool "duplicate_header"');
    expect(warnings[0]).toContain("duplicates header");
    expect(errorSpy.mock.calls[0][0]).toContain("case-insensitively");
    errorSpy.mockRestore();
  }, 10_000);

  it("excludes x-mcp-header annotations on object or array properties", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new McpClient(
      "node",
      [
        "-e",
        listToolsServerScript([
          { name: "kept", inputSchema: { type: "object" } },
          {
            name: "object_header",
            inputSchema: {
              type: "object",
              properties: {
                filter: {
                  type: "object",
                  "x-mcp-header": "X-Filter",
                  properties: { value: { type: "string" } },
                },
              },
            },
          },
          {
            name: "array_header",
            inputSchema: {
              type: "object",
              properties: {
                tags: { type: "array", "x-mcp-header": "X-Tags" },
              },
            },
          },
        ]),
      ],
      {},
      "configured-header-server",
    );
    await client.connect();

    const tools = await client.listTools();
    const warnings = errorSpy.mock.calls.map((call) => call.join(" "));

    expect(tools.map((tool) => tool.name)).toEqual(["kept"]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('tool "object_header"');
    expect(warnings[0]).toContain("primitive string, number, or boolean");
    expect(warnings[1]).toContain('tool "array_header"');
    expect(warnings[1]).toContain("primitive string, number, or boolean");
    errorSpy.mockRestore();
  }, 10_000);
});

/**
 * Slow-init MCP server: delays the initialize response by 300ms.
 * Used to create timing windows for concurrency tests.
 */
const SLOW_INIT_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: "2024-11-05", capabilities: {},
        serverInfo: { name: "slow-init" },
      }}) + "\\n");
    }, 300);
  } else if (msg.method === "shutdown") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
  }
});
`;

describe("McpClient concurrency", () => {
  let client: McpClient;

  afterEach(async () => {
    await client.close();
  });

  it("concurrent connect() calls — second throws 'already connecting'", async () => {
    client = new McpClient("node", ["-e", SLOW_INIT_SERVER], {}, "concurrent-connect");

    const first = client.connect();
    // Second call while first is in-flight
    await expect(client.connect()).rejects.toThrow(/already connecting/);

    // First should still succeed
    await first;
    expect(client.isConnected()).toBe(true);
  }, 10_000);

  it("close() during connect() prevents stale connected state", async () => {
    client = new McpClient("node", ["-e", SLOW_INIT_SERVER], {}, "close-during-connect");

    const connectPromise = client.connect();
    // Suppress unhandled rejection warning — we assert on it below
    connectPromise.catch(() => {});
    // Give the spawn a moment to start, then close before handshake completes
    await new Promise((r) => setTimeout(r, 50));
    await client.close();

    // connect() should reject (either from rejectAll or the closing check)
    await expect(connectPromise).rejects.toThrow();
    // Must NOT report connected after close
    expect(client.isConnected()).toBe(false);
  }, 10_000);

  it("connect() after close() throws 'is closed'", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "reconnect-after-close");
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await client.close();
    expect(client.isConnected()).toBe(false);

    // Attempting to reconnect a closed client should fail
    await expect(client.connect()).rejects.toThrow(/is closed/);
  }, 10_000);

  it("connect() after failed connect() works (connecting flag properly reset)", async () => {
    // First attempt: non-existent command — will fail
    client = new McpClient(
      "__nonexistent_mcp_cmd__", [], {}, "retry-after-fail",
    );
    await expect(client.connect()).rejects.toThrow();

    // connecting flag should be reset, allowing a fresh client to work
    // (We need a new client since the old one's proc state is polluted)
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "retry-after-fail");
    await client.connect();
    expect(client.isConnected()).toBe(true);
  }, 10_000);

  it("concurrent callTool() calls both complete correctly", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "concurrent-calls");
    await client.connect();

    // Fire two tool calls simultaneously
    const [raw1, raw2] = await Promise.all([
      client.callTool("echo", { text: "first" }),
      client.callTool("echo", { text: "second" }),
    ]);
    const r1 = expectCompletedResult(raw1);
    const r2 = expectCompletedResult(raw2);

    expect(r1.content).toEqual([{ type: "text", text: "Echo: first" }]);
    expect(r1.text).toBe("Echo: first");
    expect(r2.text).toBe("Echo: second");
  }, 10_000);

  it("callTool() during close() rejects without hanging", async () => {
    client = new McpClient("node", ["-e", SLOW_INIT_SERVER], {}, "call-during-close");
    // Use the normal server for this test
    const normalClient = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "call-during-close");
    await normalClient.connect();

    // Start close and a tool call concurrently
    const closePromise = normalClient.close();
    const callPromise = normalClient.callTool("echo", { text: "hi" });
    // Suppress unhandled rejection warning — we assert on it below
    callPromise.catch(() => {});

    await closePromise;
    // The call should reject (closing rejects all pending, or stdin is gone)
    await expect(callPromise).rejects.toThrow();

    // Clean up — use the slow client as the one afterEach closes
    client = normalClient;
  }, 10_000);
});

describe("McpClient error paths", () => {
  let client: McpClient;

  afterEach(async () => {
    await client.close();
  });

  it("double connect throws", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "double-connect");
    await client.connect();
    expect(client.isConnected()).toBe(true);

    await expect(client.connect()).rejects.toThrow(/already connected/);
  }, 10_000);

  it("callTool after close fails fast", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "post-close-call");
    await client.connect();
    await client.close();

    await expect(client.callTool("echo", { text: "hi" })).rejects.toThrow(/not connected/);
  }, 10_000);

  it("listTools after close fails fast", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "post-close-list");
    await client.connect();
    await client.close();

    await expect(client.listTools()).rejects.toThrow(/not connected/);
  }, 10_000);

  it("listTools rejects malformed advertised outputSchema", async () => {
    const malformedSchemaServer = `
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
              name: "bad",
              inputSchema: { type: "object" },
              outputSchema: { type: "string" },
            }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    client = new McpClient("node", ["-e", malformedSchemaServer], {}, "bad-schema");
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(
      /Malformed MCP tools\/list result: tools\[0\]\.outputSchema\.type must be "object"/,
    );
  }, 10_000);

  it("double close is safe", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "double-close");
    await client.connect();

    await client.close();
    await client.close();
    expect(client.isConnected()).toBe(false);
  }, 10_000);

  it("callTool after server crash fails fast without hanging", async () => {
    // Server that crashes after a specific tool call
    const crashServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: "crash-server" },
          }}) + "\\n");
        } else if (msg.method === "tools/call" && msg.params.name === "crash") {
          process.exit(1);
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    client = new McpClient("node", ["-e", crashServer], {}, "crash-test");
    await client.connect();

    // Server crashes during tool call — should reject quickly
    await expect(client.callTool("crash", {})).rejects.toThrow(/exited/);
    expect(client.isConnected()).toBe(false);
  }, 10_000);

  it("second callTool after server crash also fails fast", async () => {
    // Server that exits right after initialize
    const dieServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "notifications/initialized") {
          setTimeout(() => process.exit(1), 50);
        }
      });
    `;
    client = new McpClient("node", ["-e", dieServer], {}, "die-test");
    await client.connect();

    // Wait for server to exit
    await new Promise((r) => setTimeout(r, 200));
    expect(client.isConnected()).toBe(false);

    // Both calls should fail immediately with "not connected"
    await expect(client.callTool("anything", {})).rejects.toThrow(/not connected/);
    await expect(client.listTools()).rejects.toThrow(/not connected/);
  }, 10_000);

  it("close on never-connected client is safe", async () => {
    client = new McpClient("echo", [], {}, "never-connected");
    await client.close();
    await client.close();
    expect(client.isConnected()).toBe(false);
  });

  it("server slow to respond still times out", async () => {
    // Server that accepts initialize but never responds to tools/list
    const slowServer = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
        // tools/list: intentionally no response — triggers timeout
      });
    `;
    client = new McpClient("node", ["-e", slowServer], {}, "slow-test");
    await client.connect();

    // listTools sends a request with CONNECT_TIMEOUT (10s) — should timeout
    await expect(client.listTools()).rejects.toThrow(/timed out/);
  }, 15_000);
});
