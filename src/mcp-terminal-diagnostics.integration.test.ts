import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpClient } from "#core/mcp/client.js";
import { mockClientHttpFetch } from "#core/mcp/client-http-test-helpers.js";
import { McpManager } from "#core/mcp/manager.js";
import {
  initProviderRegistry,
  RENDERING_PROVIDER_TOKEN,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { createRenderingProvider } from "#modules/rendering/rendering-provider.js";

// Catches MCP publication routes bypassing the common diagnostic sanitizer,
// while composing the real client, subprocess transport and rendering provider.
const controls = "\x1b]0;spoofed\x07\x1b[2J\x9b31m\x9d0;spoofed\x9c\u202e\u2066";
const secret = "synthetic-terminal-credential";
const remoteName = `remote${controls}-${secret}`;

describe.each(["fallback", "provider"] as const)("MCP terminal diagnostics (%s)", (mode) => {
  let chunks: string[];
  let ttyDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    chunks = [];
    resetProviderRegistry();
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    // Force trusted renderer styling even under a non-TTY test runner.
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("KOTA_RENDERER_THEME", "default");
    ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
    if (mode === "provider") {
      initProviderRegistry().register(RENDERING_PROVIDER_TOKEN, "test", createRenderingProvider());
    }
  });

  afterEach(() => {
    resetProviderRegistry();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (ttyDescriptor) Object.defineProperty(process.stderr, "isTTY", ttyDescriptor);
    else Reflect.deleteProperty(process.stderr, "isTTY");
  });

  it("sanitizes real stdio stderr and peer labels while preserving redaction and protocol identity", async () => {
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(id, result) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
      }
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          write(msg.id, { protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: ${JSON.stringify(remoteName)} } });
        } else if (msg.method === "tools/list") {
          process.stderr.write(${JSON.stringify(`peer${controls} error ${secret}\nnext line\n`)});
          write(msg.id, { tools: [] });
        } else if (msg.method === "shutdown") {
          write(msg.id, {});
        }
      });
    `;
    const client = new McpClient({
      type: "stdio", command: process.execPath, args: ["-e", server],
      env: { KOTA_MCP_TEST_SECRET: secret },
    }, "configured-peer");
    try {
      await client.connect();
      expect(client.getName()).toBe(remoteName);
      await expect(client.listTools()).resolves.toEqual([]);
      await vi.waitFor(() => expect(chunks.join("")).toContain("next line"));
      expect(chunks.join("")).toBe("[mcp:remote-[redacted]] peer error [redacted]\nnext line\n");
    } finally {
      await client.close();
    }
  });

  it("keeps JSON-RPC connection errors safe and retains trusted renderer styling", async () => {
    mockClientHttpFetch((request) => new Response(JSON.stringify({
      jsonrpc: "2.0", id: request.body.id,
      error: { code: -32000, message: `peer${controls} denied ${secret}` },
    }), { status: 500, headers: { "content-type": "application/json" } }));
    const manager = new McpManager();
    try {
      await manager.initialize({ mcpServers: {
        [`configured${controls}`]: { type: "http", url: "https://mcp.example.test/mcp", headers: { Authorization: `Bearer ${secret}` } },
      } });
      expect(manager.getServerCount()).toBe(0);
      const output = chunks.join("");
      // Application SGR is allowed; peer OSC, CSI, C1 and bidi are not.
      expect(output.includes("\x1b[31m")).toBe(mode === "provider");
      const plain = output.replaceAll("\x1b[31m", "").replaceAll("\x1b[0m", "");
      expect(plain).toContain("peer denied [redacted]");
      expect(plain).toContain('server "configured"');
      expect(plain).not.toContain(secret);
      expect(plain).not.toContain("spoofed");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Security oracle rejects terminal controls in published text.
      expect(plain).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e\u2066]/);
    } finally {
      await manager.close();
    }
  });
});
