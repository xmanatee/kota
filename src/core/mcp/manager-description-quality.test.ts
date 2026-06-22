import { describe, expect, it } from "vitest";
import type { McpToolSchema } from "./client.js";
import { McpManager } from "./manager.js";
import {
  remoteMcpToolDescriptionQualityReports,
  remoteMcpToolDescriptionQualityReportsFromManager,
} from "./tool-description-quality.js";

async function waitFor(assertion: () => void, timeoutMs = 2_000): Promise<void> {
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

function refreshServerScript(
  initialTools: object[],
  refreshedResultExpression: string,
): string {
  return `
    const rl = require("readline").createInterface({ input: process.stdin });
    const initialTools = ${JSON.stringify(initialTools)};
    let listCount = 0;
    function write(message) {
      process.stdout.write(JSON.stringify(message) + "\\n");
    }
    function notifyToolListChanged() {
      setTimeout(() => write({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: {},
      }), 0);
    }
    rl.on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === "initialize") {
        write({ jsonrpc: "2.0", id: msg.id, result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "remote-display" },
        }});
      } else if (msg.method === "tools/list") {
        listCount += 1;
        write({
          jsonrpc: "2.0",
          id: msg.id,
          result: listCount === 1
            ? { tools: initialTools }
            : ${refreshedResultExpression},
        });
      } else if (msg.method === "tools/call") {
        notifyToolListChanged();
        write({ jsonrpc: "2.0", id: msg.id, result: {
          content: [{ type: "text", text: msg.params.name + " route" }],
          structuredContent: { answer: msg.params.name + " route" },
        }});
      } else if (msg.method === "shutdown") {
        write({ jsonrpc: "2.0", id: msg.id, result: {} });
      }
    });
  `;
}

describe("MCP manager description-quality diagnostics", () => {
  it("records diagnostics for weak remote tools without blocking registration or execution", async () => {
    const manager = new McpManager();
    const noDescriptionTool = {
      name: "no_description",
      inputSchema: { type: "object", properties: {} },
    } satisfies McpToolSchema;
    const genericTool = {
      name: "generic",
      description: "Tool to do stuff",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, idempotentHint: true },
    } satisfies McpToolSchema;
    const destructiveTool = {
      name: "delete_record",
      description: "Delete remote record by `id` and returns the deleted record id.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    } satisfies McpToolSchema;

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript(
                [noDescriptionTool, genericTool, destructiveTool],
                `{ tools: ${JSON.stringify([noDescriptionTool, genericTool, destructiveTool])} }`,
              ),
            ],
          },
        },
      });

      expect(manager.getTools().map((tool) => tool.name).sort()).toEqual([
        "mcp__remote__delete_record",
        "mcp__remote__generic",
        "mcp__remote__no_description",
      ]);
      const reports = remoteMcpToolDescriptionQualityReports({
        serverConfigName: "remote",
        serverDisplayName: "remote-display",
        tasksSupported: false,
        tools: [noDescriptionTool, genericTool],
      });
      const noDescription = reports.find((report) => report.toolName === "mcp__remote__no_description");
      const generic = reports.find((report) => report.toolName === "mcp__remote__generic");
      expect(noDescription?.declarationFingerprint).toBe(
        manager.getToolDeclarationFingerprint("mcp__remote__no_description"),
      );
      expect(noDescription?.diagnostics.map((diagnostic) => diagnostic.code)).toContain("description-missing");
      expect(generic?.diagnostics.map((diagnostic) => diagnostic.code)).toContain("description-generic");
      const liveNoDescription = remoteMcpToolDescriptionQualityReportsFromManager(manager)
        .find((report) => report.toolName === "mcp__remote__no_description");
      expect(liveNoDescription?.diagnostics.map((diagnostic) => diagnostic.code)).toContain("description-missing");
      const liveDestructive = remoteMcpToolDescriptionQualityReportsFromManager(manager)
        .find((report) => report.toolName === "mcp__remote__delete_record");
      expect(liveDestructive?.serverDisplayName).toBe("remote-display");
      expect(liveDestructive?.declarationFingerprint).toBe(
        manager.getToolDeclarationFingerprint("mcp__remote__delete_record"),
      );
      const liveDestructiveCodes = liveDestructive?.diagnostics.map((diagnostic) => diagnostic.code);
      expect(liveDestructiveCodes).toContain("negative-guidance-missing");
      expect(liveDestructiveCodes).not.toContain("effect-boundary-missing");
      expect((await manager.executeTool("mcp__remote__generic", {})).content).toBe("generic route");
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("refreshes declaration fingerprints independently from description-quality diagnostics", async () => {
    const manager = new McpManager();
    const weakTool = {
      name: "lookup",
      description: "Tool to do stuff",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    } satisfies McpToolSchema;
    const schemaRefreshedTool = {
      ...weakTool,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    } satisfies McpToolSchema;

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript(
                [weakTool],
                `{ tools: ${JSON.stringify([schemaRefreshedTool])} }`,
              ),
            ],
          },
        },
      });

      const before = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
      const beforeReport = remoteMcpToolDescriptionQualityReports({
        serverConfigName: "remote",
        serverDisplayName: "remote-display",
        tasksSupported: false,
        tools: [weakTool],
      }).find((report) => report.toolName === "mcp__remote__lookup");
      const beforeCodes = beforeReport?.diagnostics.map((diagnostic) => diagnostic.code);
      expect(beforeReport?.declarationFingerprint).toBe(before);
      await manager.executeTool("mcp__remote__lookup", {});

      await waitFor(() => {
        expect(manager.getToolDeclarationDriftDiagnostics()).toHaveLength(1);
      });
      const after = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
      const afterReport = remoteMcpToolDescriptionQualityReports({
        serverConfigName: "remote",
        serverDisplayName: "remote-display",
        tasksSupported: false,
        tools: [schemaRefreshedTool],
      }).find((report) => report.toolName === "mcp__remote__lookup");
      expect(after).toMatch(/^[a-f0-9]{64}$/);
      expect(after).not.toBe(before);
      expect(manager.getToolDeclarationDriftDiagnostics()[0].changedFacets).toEqual(["inputSchema"]);
      expect(afterReport?.declarationFingerprint).toBe(after);
      expect(afterReport?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(beforeCodes);
    } finally {
      await manager.close();
    }
  }, 10_000);
});
