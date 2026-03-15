import { afterEach, describe, expect, it } from "vitest";
import { McpClient } from "./mcp-client.js";

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
      { name: "echo", description: "Echoes input", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
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
          { type: "image", data: "abc123" },
          { type: "text", text: "line2" },
        ],
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
    expect(result.content).toBe("Echo: hello world");
    expect(result.isError).toBeUndefined();
  }, 10_000);

  it("callTool surfaces JSON-RPC errors", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "err-test");
    await client.connect();

    await expect(client.callTool("fail", {})).rejects.toThrow(
      /MCP error -32000.*intentional error/,
    );
  }, 10_000);

  it("callTool extracts only text content, ignores non-text", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "mixed-test");
    await client.connect();

    const result = await client.callTool("mixed", {});
    expect(result.content).toBe("line1\nline2");
  }, 10_000);

  it("callTool returns fallback for empty content", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "empty-test");
    await client.connect();

    const result = await client.callTool("empty", {});
    expect(result.content).toBe("(no output)");
  }, 10_000);

  it("callTool preserves isError flag", async () => {
    client = new McpClient("node", ["-e", FAKE_MCP_SERVER], {}, "iserr-test");
    await client.connect();

    const result = await client.callTool("is_error", {});
    expect(result.content).toBe("partial failure");
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
