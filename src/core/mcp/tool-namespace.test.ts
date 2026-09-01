import { describe, expect, it } from "vitest";
import { namespaceTool, parseToolName } from "./manager.js";
import {
  FakeMcpManagerClient,
  managerWithClients,
  settleManagerRefresh,
} from "./manager-test-support.js";

describe("MCP tool namespacing", () => {
  it("creates and parses injective namespaced tool names", () => {
    expect(namespaceTool("sqlite", "query")).toBe("mcp__sqlite__query");
    expect(namespaceTool("my-server", "run_query")).toBe("mcp__my-server__run_query");
    expect(parseToolName("mcp__sqlite__query")).toEqual({ server: "sqlite", tool: "query" });
    expect(parseToolName("shell")).toBeNull();
    expect(parseToolName("mcp__")).toBeNull();
    expect(parseToolName("mcp__server__tool__with__parts")).toEqual({
      server: "server",
      tool: "tool__with__parts",
    });
  });

  it("rejects server suffixes that would collide with tool prefixes", () => {
    expect(() => namespaceTool("a_", "b")).toThrow(
      'server config name "a_": namespaced MCP server config names cannot end with "_"',
    );
    expect(namespaceTool("a", "_b")).toBe("mcp__a___b");
  });

  it("rejects invalid server namespaces before client construction", async () => {
    const { manager, factoryCalls } = managerWithClients({});
    await manager.initialize({
      mcpServers: { "a__b": { command: "peer" }, "a_": { command: "peer" } },
    });

    expect(factoryCalls).toEqual([]);
    expect(manager.getTools()).toEqual([]);
  });

  it("rejects ambiguous and duplicate remote tool names before publication", async () => {
    const ambiguous = new FakeMcpManagerClient("ambiguous");
    ambiguous.tools = [{ name: "b__c", inputSchema: { type: "object", properties: {} } }];
    const duplicate = new FakeMcpManagerClient("duplicate");
    duplicate.tools = [
      { name: "query", inputSchema: { type: "object", properties: {} } },
      { name: "query", inputSchema: { type: "object", properties: {} } },
    ];
    const { manager } = managerWithClients({ ambiguous, duplicate });

    await manager.initialize({
      mcpServers: {
        ambiguous: { command: "peer" },
        duplicate: { command: "peer" },
      },
    });

    expect(manager.getServerCount()).toBe(0);
    expect(manager.getTools()).toEqual([]);
    expect(ambiguous.closeCount).toBe(1);
    expect(duplicate.closeCount).toBe(1);
  });

  it("preserves an unambiguous tool when a sibling server name is invalid", async () => {
    const a = new FakeMcpManagerClient("a");
    a.tools = [{ name: "_b", inputSchema: { type: "object", properties: {} } }];
    const { manager } = managerWithClients({ a });

    await manager.initialize({
      mcpServers: { "a_": { command: "peer" }, a: { command: "peer" } },
    });

    expect(manager.getTools().map((entry) => entry.name)).toEqual(["mcp__a___b"]);
    await manager.close();
  });

  it("keeps the previous route when a refresh contains an ambiguous name", async () => {
    const remote = new FakeMcpManagerClient("remote");
    remote.tools = [{ name: "stable", inputSchema: { type: "object", properties: {} } }];
    const { manager } = managerWithClients({ remote });
    await manager.initialize({ mcpServers: { remote: { command: "peer" } } });

    remote.tools = [{ name: "shadow__route", inputSchema: { type: "object", properties: {} } }];
    remote.emitToolListChanged();
    await settleManagerRefresh();

    expect(manager.getTools().map((entry) => entry.name)).toEqual(["mcp__remote__stable"]);
    await manager.close();
  });
});
