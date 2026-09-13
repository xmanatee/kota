import { describe, expect, it, vi } from "vitest";
import { MCP_DRAFT_PROTOCOL_VERSION, McpClient, McpConnectionError } from "./client.js";

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
  it.each(["split", "bytewise", "completion", "short match at EOF"])("redacts fragmented stderr with bounded pending output: %s", async (variant) => {
    const terminal = captureTerminalStderr();
    const secret = "synthetic-🔑-credential";
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          reply(msg.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "stream-peer" } });
        } else if (msg.method === "tools/call") {
          const args = msg.params.arguments;
          if (args.end) process.stderr.end();
          else process.stderr.write(Buffer.from(args.bytes));
          setTimeout(() => reply(msg.id, { content: [{ type: "text", text: "ok" }] }), 30);
        } else if (msg.method === "shutdown") {
          process.stderr.end();
          reply(msg.id, {});
        } else if (msg.method === "exit") process.exit(0);
      });
    `;
    const client = new McpClient({ type: "stdio", command: "node", args: ["-e", server],
      env: { KOTA_MCP_STDIO_SECRET: secret, KOTA_MCP_SHORT_SECRET: "synthetic-" },
    }, "stream-peer");
    const write = (bytes: Uint8Array) => client.callTool("write", { bytes: [...bytes] });
    try {
      await client.connect();
      if (variant === "completion" || variant === "short match at EOF") {
        await write(Buffer.from(variant === "completion" ? "trailing synthe" : "trailing synthetic-"));
        expect(terminal.output()).toContain("trailing");
        expect(terminal.output()).not.toContain("synthe");
        await client.callTool("write", { end: true });
        await waitForAssertion(() => expect(terminal.output()).toContain(variant === "completion" ? "synthe" : "[redacted]"));
        if (variant === "short match at EOF") expect(terminal.output()).not.toContain("synthe");
      } else {
        const bytes = Buffer.from(secret);
        const split = Buffer.byteLength("synthetic-🔑");
        const chunks = variant === "bytewise"
          ? [...bytes].map((byte) => Buffer.from([byte]))
          : [bytes.subarray(0, split), bytes.subarray(split)];
        for (const [index, chunk] of chunks.entries()) {
          await write(chunk);
          if (index < chunks.length - 1) expect(terminal.output()).toBe("");
        }
        await waitForAssertion(() => expect(terminal.output()).toContain("[redacted]"));
        expect(terminal.output()).not.toContain("credential");
        expect(terminal.output()).not.toContain("🔑");
        await write(Buffer.from(`${secret}${secret} readable`));
        await waitForAssertion(() => expect(terminal.output()).toContain("[redacted][redacted] readable"));
        // A long line must publish while the stream is still open; only a possible
        // credential prefix may wait for later bytes.
        await write(Buffer.from(`${"z".repeat(100_000)} synthe`));
        await waitForAssertion(() => expect(terminal.output().match(/z/g)?.length).toBe(100_000));
        expect(terminal.output()).not.toContain("synthe");
        await client.close();
        await waitForAssertion(() => expect(terminal.output()).toContain("synthe"));
      }
      expect(terminal.output()).not.toContain(secret);
    } finally {
      await client.close();
      terminal.restore();
    }
  }, 10_000);

  it.each(["initial failure", "fallback failure", "fallback success"] as const)(
    "redacts terminal initialization failures while preserving negotiation: %s",
    async (variant) => {
      const secret = "synthetic-initialize-credential";
      const server = `
        const rl = require("readline").createInterface({ input: process.stdin });
        const secret = process.env.KOTA_MCP_STDIO_SECRET;
        const version = process.env.KOTA_MCP_VERSION_SECRET;
        const mode = ${JSON.stringify(variant)};
        let attempts = 0;
        function write(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            attempts++;
            if (attempts === 1 && mode !== "initial failure") {
              write({ jsonrpc: "2.0", id: msg.id, error: {
                code: -32602, message: "Unsupported protocol version " + secret,
                data: { supportedVersions: [version], credential: secret },
              }});
            } else if (mode === "fallback success" && msg.params.protocolVersion === version) {
              write({ jsonrpc: "2.0", id: msg.id, result: {
                protocolVersion: version, capabilities: {}, serverInfo: { name: "fallback-peer" },
              }});
            } else {
              write({ jsonrpc: "2.0", id: msg.id, error: {
                code: -32000, message: (attempts === 1 ? "initial" : "fallback") + " denied " + secret,
                data: { credential: secret },
              }});
            }
          } else if (msg.method === "shutdown") {
            write({ jsonrpc: "2.0", id: msg.id, result: {} });
          }
        });
      `;
      const client = new McpClient({
        type: "stdio", command: "node", args: ["-e", server],
        env: { KOTA_MCP_STDIO_SECRET: secret, KOTA_MCP_VERSION_SECRET: MCP_DRAFT_PROTOCOL_VERSION },
      }, `peer-${secret}`);
      try {
        if (variant === "fallback success") {
          await client.connect();
          expect(client.isConnected()).toBe(true);
          expect(client.getProtocolVersion()).toBe(MCP_DRAFT_PROTOCOL_VERSION);
        } else {
          const error = await client.connect().catch((caught: unknown) => caught);
          if (!(error instanceof Error)) throw new Error("Expected initialization failure");
          expect(error.message).toContain(`${variant === "initial failure" ? "initial" : "fallback"} denied [redacted]`);
          expect(error).toBeInstanceOf(McpConnectionError);
          expect(error).toMatchObject({ serverName: "peer-[redacted]", method: "initialize" });
          expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
          expect(client.isConnected()).toBe(false);
        }
      } finally {
        await client.close();
      }
    },
  );

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
            serverInfo: { name: "peer-" + process.env.KOTA_MCP_STDIO_SECRET },
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
      expect(client.getName()).toBe(`peer-${secret}`);
      await expect(client.connect()).rejects.toThrow('server "peer-[redacted]" is already connected');
      await client.close();
      await expect(client.callTool("work", {})).rejects.toThrow('server "peer-[redacted]" is not connected');
      await expect(client.connect()).rejects.toThrow('server "peer-[redacted]" is closed');
    } finally {
      terminal.restore();
      await client.close();
    }
  }, 10_000);
});
