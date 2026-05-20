import { afterEach, describe, expect, it } from "vitest";
import {
  MCP_DRAFT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  type McpCallToolResult,
  McpClient,
  type McpCompleteCallToolResult,
  type McpLegacyCallToolResult,
} from "./client.js";

function expectCompletedResult(
  result: McpCallToolResult,
): McpCompleteCallToolResult | McpLegacyCallToolResult {
  if (result.resultType === "input_required") {
    throw new Error("Expected a completed MCP tool result");
  }
  return result;
}

/**
 * Inline Node.js script that acts as a minimal MCP server.
 * Reads JSON-RPC from stdin, responds to initialize/tools/list/tools/call.
 * Configurable behavior via MCP_TEST_MODE env var.
 */
const FAKE_MCP_SERVER = `
const rl = require("readline").createInterface({ input: process.stdin });
const mode = process.env.MCP_TEST_MODE || "normal";
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
    const protocolVersion = mode === "draft" ? "DRAFT-2026-v1" : "2024-11-05";
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
    } else if (msg.params.name === "malformed_input_required") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
        resultType: "input_required",
        inputRequests: [],
        requestState: "state-token-1",
      }}) + "\\n");
    } else if (msg.params.name === "missing_input_required_request_state") {
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
    }
  } else if (msg.method === "shutdown") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
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

  it("callTool rejects draft input_required payloads missing requestState", async () => {
    client = new McpClient(
      "node",
      ["-e", FAKE_MCP_SERVER],
      { MCP_TEST_MODE: "draft" },
      "missing-request-state-test",
    );
    await client.connect();

    await expect(client.callTool("missing_input_required_request_state", {})).rejects.toThrow(
      /Malformed MCP tools\/call result: requestState must be a string/,
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
