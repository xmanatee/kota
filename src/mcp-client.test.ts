import { describe, it, expect } from "vitest";
import { McpClient } from "./mcp-client.js";

describe("McpClient", () => {
  it("starts disconnected", () => {
    const client = new McpClient("echo", ["hello"], {}, "test-server");
    expect(client.isConnected()).toBe(false);
    expect(client.getName()).toBe("test-server");
  });

  it("uses command as default name", () => {
    const client = new McpClient("my-command");
    expect(client.getName()).toBe("my-command");
  });

  it("reports disconnected after close", async () => {
    const client = new McpClient("echo", [], {}, "test");
    await client.close();
    expect(client.isConnected()).toBe(false);
  });

  it("connect fails gracefully for non-existent command", async () => {
    const client = new McpClient(
      "__nonexistent_command_that_does_not_exist__",
      [],
      {},
      "bad-server",
    );
    await expect(client.connect()).rejects.toThrow();
  });

  it("connect times out for non-MCP process", async () => {
    // `cat` will never send a JSON-RPC response, so connect should time out
    const client = new McpClient("sleep", ["30"], {}, "stuck-server");
    await expect(client.connect()).rejects.toThrow(/timed out/);
  }, 15_000);
});
