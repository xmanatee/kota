import { describe, expect, it } from "vitest";
import { McpManager } from "./manager.js";

describe("McpManager result provenance", () => {
  it("returns provenance for remote MCP tools and operations", async () => {
    const manager = new McpManager();
    const server = `
      const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "remote-test" },
          }}) + "\\n");
        } else if (msg.method === "tools/list") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {
            tools: [{ name: "lookup", inputSchema: { type: "object" } }],
          }}) + "\\n");
        } else if (msg.method === "shutdown") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;

    try {
      expect(manager.getToolResultContentProvenance("mcp__remote__lookup")).toBeUndefined();

      await manager.initialize({
        mcpServers: { remote: { command: "node", args: ["-e", server] } },
      });

      expect(manager.getToolResultContentProvenance("mcp__remote__lookup")).toEqual({
        kind: "external-mcp",
        serverName: "remote",
        source: "tool",
        name: "lookup",
        declarationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(manager.getToolResultContentProvenance("mcp_resources__remote__read")).toEqual({
        kind: "external-mcp",
        serverName: "remote",
        source: "operation",
        name: "resources/read",
      });
      expect(manager.getToolResultContentProvenance("mcp__remote__missing")).toBeUndefined();
    } finally {
      await manager.close();
    }
  }, 10_000);
});
