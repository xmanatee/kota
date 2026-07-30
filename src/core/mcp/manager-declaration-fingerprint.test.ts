import { describe, expect, it, vi } from "vitest";
import type { McpToolSchema } from "./client.js";
import { McpManager } from "./manager.js";
import type { McpToolEntry } from "./remote-task-entry-resolution.js";

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

const baseTool: McpToolSchema = {
  name: "lookup",
  description: "Looks up a record",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

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

describe("MCP tool declaration fingerprints", () => {
  it("stores current fingerprints and records bounded same-tool drift diagnostics", async () => {
    const secretDescription = "changed declaration should not be printed";
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    const refreshedTool = {
      ...baseTool,
      description: secretDescription,
    };

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript(
                [baseTool],
                `{ tools: ${JSON.stringify([refreshedTool])} }`,
              ),
            ],
          },
        },
      });

      const before = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
      expect(before).toMatch(/^[a-f0-9]{64}$/);
      await manager.executeTool("mcp__remote__lookup", {});

      await waitFor(() => {
        expect(manager.getToolDeclarationDriftDiagnostics()).toHaveLength(1);
      });
      const [diagnostic] = manager.getToolDeclarationDriftDiagnostics();
      const after = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
      expect(after).toMatch(/^[a-f0-9]{64}$/);
      expect(after).not.toBe(before);
      expect(diagnostic).toEqual({
        serverConfigName: "remote",
        serverDisplayName: "remote-display",
        toolName: "lookup",
        previousFingerprint: before,
        currentFingerprint: after,
        changedFacets: ["description"],
      });
      expect(stderr.output()).toContain(`"${diagnostic.toolName}"`);
      expect(stderr.output()).toContain(before!.slice(0, 12));
      expect(stderr.output()).toContain(after!.slice(0, 12));
      expect(stderr.output()).not.toContain(secretDescription);

      const boundExecution = await manager.executeToolWithDeclarationFingerprint(
        "mcp__remote__lookup",
        {},
        before!,
      );
      expect(boundExecution).toEqual({
        ok: false,
        reason: "declaration_mismatch",
      });
    } finally {
      stderr.restore();
      await manager.close();
    }
  }, 10_000);

  it("keeps the same fingerprint and emits no diagnostic on unchanged refresh", async () => {
    const manager = new McpManager();
    const reorderedTool = {
      ...baseTool,
      inputSchema: {
        required: ["query"],
        properties: {
          limit: { type: "number" },
          query: { description: "Search query", type: "string" },
        },
        type: "object",
      },
    };

    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript(
                [baseTool],
                `{ tools: ${JSON.stringify([reorderedTool])} }`,
              ),
            ],
          },
        },
      });

      const before = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
      await manager.executeTool("mcp__remote__lookup", {});

      await waitFor(() => {
        expect(manager.getToolDeclarationFingerprint("mcp__remote__lookup")).toBe(before);
      });
      expect(manager.getToolDeclarationDriftDiagnostics()).toEqual([]);
      const boundExecution = await manager.executeToolWithDeclarationFingerprint(
        "mcp__remote__lookup",
        {},
        before!,
      );
      expect(boundExecution).toMatchObject({
        ok: true,
        result: { content: "lookup route" },
      });
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("dispatches through the entry captured during fingerprint validation", async () => {
    const manager = new McpManager();
    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript([baseTool], `{ tools: ${JSON.stringify([baseTool])} }`),
            ],
          },
        },
      });

      const name = "mcp__remote__lookup";
      const expectedFingerprint = manager.getToolDeclarationFingerprint(name);
      expect(expectedFingerprint).toMatch(/^[a-f0-9]{64}$/);
      const state = manager as unknown as { toolMap: Map<string, McpToolEntry> };
      const checkedMap = state.toolMap;
      const checkedEntry = checkedMap.get(name);
      if (!checkedEntry) throw new Error("expected checked MCP entry");
      const replacementEntry: McpToolEntry = {
        ...checkedEntry,
        originalName: "replacement",
        declaration: {
          ...checkedEntry.declaration,
          fingerprint: "f".repeat(64),
        },
      };
      vi.spyOn(checkedEntry.client, "callTool").mockImplementation(async (toolName) => ({
        resultType: "complete",
        protocolVersion: "2024-11-05",
        content: [],
        blocks: [],
        text: `${toolName} route`,
        structuredContent: { answer: `${toolName} route` },
      }));
      vi.spyOn(checkedMap, "get").mockImplementationOnce(() => {
        state.toolMap = new Map([[name, replacementEntry]]);
        return checkedEntry;
      });

      const execution = await manager.executeToolWithDeclarationFingerprint(
        name,
        {},
        expectedFingerprint!,
      );

      expect(execution).toMatchObject({
        ok: true,
        result: { content: "lookup route" },
      });
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("refreshes added and removed tools without false drift diagnostics", async () => {
    const manager = new McpManager();
    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript(
                [{ name: "old_tool", inputSchema: { type: "object" } }],
                `{ tools: [{ name: "new_tool", inputSchema: { type: "object" } }] }`,
              ),
            ],
          },
        },
      });

      expect(manager.getTools().map((tool) => tool.name)).toEqual([
        "mcp__remote__old_tool",
      ]);
      const before = manager.getToolDeclarationFingerprint("mcp__remote__old_tool");
      expect(before).toMatch(/^[a-f0-9]{64}$/);
      await manager.executeTool("mcp__remote__old_tool", {});

      await waitFor(() => {
        expect(manager.getTools().map((tool) => tool.name)).toEqual([
          "mcp__remote__new_tool",
        ]);
      });
      expect(manager.getToolDeclarationDriftDiagnostics()).toEqual([]);
      const boundExecution = await manager.executeToolWithDeclarationFingerprint(
        "mcp__remote__old_tool",
        {},
        before!,
      );
      expect(boundExecution).toEqual({
        ok: false,
        reason: "tool_missing",
      });
      expect((await manager.executeTool("mcp__remote__old_tool", {})).is_error).toBe(true);
      expect((await manager.executeTool("mcp__remote__new_tool", {})).content).toBe(
        "new_tool route",
      );
    } finally {
      await manager.close();
    }
  }, 10_000);

  it("keeps last-known-good fingerprints when a refreshed tools/list is malformed", async () => {
    const manager = new McpManager();
    const stderr = captureTerminalStderr();
    try {
      await manager.initialize({
        mcpServers: {
          remote: {
            command: "node",
            args: [
              "-e",
              refreshServerScript(
                [baseTool],
                `{ tools: [{ name: 123, inputSchema: { type: "object" } }] }`,
              ),
            ],
          },
        },
      });

      const before = manager.getToolDeclarationFingerprint("mcp__remote__lookup");
      await manager.executeTool("mcp__remote__lookup", {});

      await waitFor(() => {
        expect(stderr.output()).toContain("tool refresh failed; keeping previous registry");
      });
      expect(manager.getToolDeclarationFingerprint("mcp__remote__lookup")).toBe(before);
      expect(manager.getToolDeclarationDriftDiagnostics()).toEqual([]);
      expect((await manager.executeTool("mcp__remote__lookup", {})).content).toBe(
        "lookup route",
      );
    } finally {
      stderr.restore();
      await manager.close();
    }
  }, 10_000);
});
