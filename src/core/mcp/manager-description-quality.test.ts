import { describe, expect, it } from "vitest";
import type { McpToolSchema } from "./client.js";
import {
  FakeMcpManagerClient,
  managerWithClients,
  settleManagerRefresh,
} from "./manager-test-support.js";
import {
  remoteMcpToolDescriptionQualityReportsFromManager,
} from "./tool-description-quality.js";

const weakTool = {
  name: "lookup",
  description: "Tool to do stuff",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
} satisfies McpToolSchema;

describe("MCP manager description-quality diagnostics", () => {
  it("derives diagnostics from live manager declarations without blocking routing", async () => {
    const remote = new FakeMcpManagerClient("Remote display");
    remote.tools = [weakTool];
    const { manager } = managerWithClients({ remote });
    await manager.initialize({ mcpServers: { remote: { command: "peer" } } });

    const [report] = remoteMcpToolDescriptionQualityReportsFromManager(manager);
    expect(report).toMatchObject({
      serverConfigName: "remote",
      serverDisplayName: "Remote display",
      toolName: "mcp__remote__lookup",
      declarationFingerprint: manager.getToolDeclarationFingerprint("mcp__remote__lookup"),
    });
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("description-generic");
    expect((await manager.executeTool("mcp__remote__lookup", {})).content).toBe("ok");
    await manager.close();
  });

  it("recomputes quality reports from the refreshed declaration", async () => {
    const remote = new FakeMcpManagerClient("Remote display");
    remote.tools = [weakTool];
    const { manager } = managerWithClients({ remote });
    await manager.initialize({ mcpServers: { remote: { command: "peer" } } });
    const before = manager.getToolDeclarationFingerprint("mcp__remote__lookup");

    const { description: _description, ...refreshedTool } = weakTool;
    remote.tools = [refreshedTool];
    remote.emitToolListChanged();
    await settleManagerRefresh();

    const [report] = remoteMcpToolDescriptionQualityReportsFromManager(manager);
    expect(report.declarationFingerprint).not.toBe(before);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("description-missing");
    await manager.close();
  });
});
