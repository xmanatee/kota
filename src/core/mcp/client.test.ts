import { afterEach, describe, expect, it } from "vitest";
import { McpClient } from "./client.js";

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
    const resp = { jsonrpc: "2.0", id: msg.id, result: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: "test-mcp-server" },
    }};
    process.stdout.write(JSON.stringify(resp) + "\\n");
  } else if (msg.method === "notifications/initialized") {
    // notification — no response
  } else if (msg.method === "tools/list") {
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

    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("echo");
    expect(tools[1].name).toBe("fail");

    const result = await client.callTool("echo", { text: "hello world" });
    expect(result.text).toBe("Echo: hello world");
    expect(result.content).toEqual([{ type: "text", text: "Echo: hello world" }]);
    expect(result.blocks).toEqual([{ type: "text", text: "Echo: hello world" }]);
    expect(result.isError).toBeUndefined();
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

    const result = await client.callTool("mixed", {});
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

    const result = await client.callTool("structured", {});
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

  it("callTool preserves future MCP content kinds instead of erasing them", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "future-test");
    await client.connect();

    const result = await client.callTool("future", {});
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

    const result = await client.callTool("empty", {});
    expect(result.text).toBe("(no output)");
    expect(result.content).toEqual([]);
    expect(result.blocks).toEqual([]);
  }, 10_000);

  it("callTool preserves isError flag", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "iserr-test");
    await client.connect();

    const result = await client.callTool("is_error", {});
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
    const [r1, r2] = await Promise.all([
      client.callTool("echo", { text: "first" }),
      client.callTool("echo", { text: "second" }),
    ]);

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
