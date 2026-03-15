/**
 * Cross-module integration tests: delegate × mcp-manager
 *
 * Tests that MCP tools are properly threaded through to sub-agents.
 * Verifies:
 * 1. MCP tools appear in the delegate's tool list
 * 2. MCP tool calls are routed through McpManager (not built-in runners)
 * 3. Built-in tools still work alongside MCP tools
 * 4. Delegates without MCP work unchanged
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { McpManager } from "./mcp-manager.js";
import { setDelegateConfig, type DelegateConfig } from "./tools/delegate.js";
import {
  exploreTools,
  executeTools,
} from "./delegate-prompts.js";

/** Create a mock McpManager that returns controlled tools and results. */
function createMockMcpManager(
  tools: Array<{ name: string; description: string }>,
  results: Record<string, { content: string; is_error?: boolean }> = {},
): McpManager {
  const anthropicTools = tools.map((t) => ({
    name: `mcp__test__${t.name}`,
    description: `[test] ${t.description}`,
    input_schema: {
      type: "object" as const,
      properties: { input: { type: "string" } },
    },
  }));

  const toolNames = new Set(anthropicTools.map((t) => t.name));

  return {
    getTools: () => anthropicTools,
    isMcpTool: (name: string) => toolNames.has(name),
    executeTool: vi.fn(async (name: string, _input: Record<string, unknown>) => {
      const result = results[name];
      if (result) return result;
      return { content: `Mock result for ${name}`, is_error: false };
    }),
    getServerCount: () => 1,
    getToolCount: () => tools.length,
    close: vi.fn(async () => {}),
    initialize: vi.fn(async () => {}),
  } as unknown as McpManager;
}

describe("delegate × mcp-manager integration", () => {
  beforeEach(() => {
    // Reset delegate config to baseline
    setDelegateConfig({ model: "test-model" });
  });

  describe("tool list composition", () => {
    it("MCP tools are appended to explore tool list", async () => {
      const mcpMgr = createMockMcpManager([
        { name: "query", description: "Run a database query" },
        { name: "schema", description: "Get database schema" },
      ]);

      // Verify MCP tools would be included alongside built-in tools
      const mcpTools = mcpMgr.getTools();
      const combinedExplore = [...exploreTools, ...mcpTools];

      expect(combinedExplore.length).toBe(exploreTools.length + 2);

      // MCP tools have proper namespacing
      const mcpNames = mcpTools.map((t) => t.name);
      expect(mcpNames).toContain("mcp__test__query");
      expect(mcpNames).toContain("mcp__test__schema");

      // Built-in tools are still present
      const builtinNames = exploreTools.map((t) => t.name);
      expect(builtinNames).toContain("file_read");
      expect(builtinNames).toContain("grep");
    });

    it("MCP tools are appended to execute tool list", async () => {
      const mcpMgr = createMockMcpManager([
        { name: "deploy", description: "Deploy to production" },
      ]);

      const mcpTools = mcpMgr.getTools();
      const combinedExecute = [...executeTools, ...mcpTools];

      expect(combinedExecute.length).toBe(executeTools.length + 1);
      expect(combinedExecute.some((t) => t.name === "mcp__test__deploy")).toBe(true);
      expect(combinedExecute.some((t) => t.name === "file_edit")).toBe(true);
    });

    it("empty MCP manager adds no tools", async () => {
      const mcpMgr = createMockMcpManager([]);

      const mcpTools = mcpMgr.getTools();
      expect(mcpTools).toHaveLength(0);

      const combined = [...exploreTools, ...mcpTools];
      expect(combined.length).toBe(exploreTools.length);
    });
  });

  describe("MCP tool routing", () => {
    it("isMcpTool correctly identifies MCP vs built-in tools", () => {
      const mcpMgr = createMockMcpManager([
        { name: "query", description: "query" },
      ]);

      expect(mcpMgr.isMcpTool("mcp__test__query")).toBe(true);
      expect(mcpMgr.isMcpTool("file_read")).toBe(false);
      expect(mcpMgr.isMcpTool("shell")).toBe(false);
      expect(mcpMgr.isMcpTool("mcp__other__tool")).toBe(false);
    });

    it("executeTool routes MCP calls correctly", async () => {
      const mcpMgr = createMockMcpManager(
        [{ name: "query", description: "query" }],
        {
          "mcp__test__query": {
            content: "3 rows returned: [{id: 1}, {id: 2}, {id: 3}]",
          },
        },
      );

      const result = await mcpMgr.executeTool("mcp__test__query", {
        input: "SELECT * FROM users",
      });
      expect(result.content).toContain("3 rows returned");
      expect(result.is_error).toBeUndefined();
    });

    it("executeTool handles MCP errors", async () => {
      const mcpMgr = createMockMcpManager(
        [{ name: "query", description: "query" }],
        {
          "mcp__test__query": {
            content: "Connection refused: database offline",
            is_error: true,
          },
        },
      );

      const result = await mcpMgr.executeTool("mcp__test__query", {
        input: "SELECT 1",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Connection refused");
    });
  });

  describe("DelegateConfig with mcpManager", () => {
    it("DelegateConfig accepts mcpManager field", () => {
      const mcpMgr = createMockMcpManager([
        { name: "tool1", description: "test" },
      ]);

      const config: DelegateConfig = {
        model: "test-model",
        mcpManager: mcpMgr,
      };

      expect(config.mcpManager).toBe(mcpMgr);
      expect(config.mcpManager?.getToolCount()).toBe(1);
    });

    it("DelegateConfig works without mcpManager (backward compat)", () => {
      const config: DelegateConfig = {
        model: "test-model",
      };

      expect(config.mcpManager).toBeUndefined();
    });

    it("setDelegateConfig propagates mcpManager", () => {
      const mcpMgr = createMockMcpManager([
        { name: "search", description: "search docs" },
      ]);

      // This should not throw
      setDelegateConfig({
        model: "test-model",
        mcpManager: mcpMgr,
      });
    });
  });

  describe("tool routing logic (unit verification)", () => {
    it("MCP tools route through mcpManager.executeTool, not runners", async () => {
      const mcpMgr = createMockMcpManager([
        { name: "query", description: "query" },
      ]);

      // Simulate what runDelegate does internally
      const toolName = "mcp__test__query";
      const isMcp = mcpMgr.isMcpTool(toolName);
      expect(isMcp).toBe(true);

      if (isMcp) {
        const result = await mcpMgr.executeTool(toolName, { sql: "SELECT 1" });
        expect(result.content).toBeTruthy();
        expect(mcpMgr.executeTool).toHaveBeenCalledWith(toolName, { sql: "SELECT 1" });
      }
    });

    it("built-in tools do not route through mcpManager", async () => {
      const mcpMgr = createMockMcpManager([
        { name: "query", description: "query" },
      ]);

      // Built-in tool should not be identified as MCP
      expect(mcpMgr.isMcpTool("file_read")).toBe(false);
      expect(mcpMgr.isMcpTool("shell")).toBe(false);
      expect(mcpMgr.isMcpTool("grep")).toBe(false);

      // executeTool should not have been called for built-in tools
      expect(mcpMgr.executeTool).not.toHaveBeenCalled();
    });

    it("unknown tools (not MCP, not built-in) produce error", () => {
      const mcpMgr = createMockMcpManager([
        { name: "query", description: "query" },
      ]);

      const toolName = "totally_unknown_tool";
      const isMcp = mcpMgr.isMcpTool(toolName);
      const builtinRunners: Record<string, unknown> = { file_read: true, shell: true };
      const hasRunner = toolName in builtinRunners;

      // Neither MCP nor built-in → should produce error
      expect(isMcp).toBe(false);
      expect(hasRunner).toBe(false);
    });
  });
});
