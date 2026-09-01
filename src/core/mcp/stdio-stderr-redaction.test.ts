import { describe, expect, it, vi } from "vitest";
import { McpClient } from "./client.js";

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

function captureTerminalStderr(): { output: () => string; restore: () => void } {
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

describe("MCP stdio stderr diagnostics", () => {
  it("redacts configured env values echoed through stderr diagnostics", async () => {
    const terminal = captureTerminalStderr();
    const secret = "stdio-stderr-secret-3358a37f";
    const server = `
      process.stderr.write("boot leaked " + process.env.KOTA_MCP_STDIO_SECRET + "\\n");
      const rl = require("readline").createInterface({ input: process.stdin });
      function write(message) {
        process.stdout.write(JSON.stringify(message) + "\\n");
      }
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          write({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05", capabilities: {},
            serverInfo: { name: "stdio-stderr-secret-fixture" },
          }});
        } else if (msg.method === "tools/list") {
          write({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } });
        } else if (msg.method === "shutdown") {
          write({ jsonrpc: "2.0", id: msg.id, result: {} });
        }
      });
    `;
    const client = new McpClient({
      type: "stdio",
      command: "node",
      args: ["-e", server],
      env: { KOTA_MCP_STDIO_SECRET: secret },
    }, "secret");

    try {
      await client.connect();

      await waitForAssertion(() => {
        expect(terminal.output()).toContain("boot leaked [redacted]");
      });
      expect(terminal.output()).not.toContain(secret);
    } finally {
      terminal.restore();
      await client.close();
    }
  }, 10_000);
});
