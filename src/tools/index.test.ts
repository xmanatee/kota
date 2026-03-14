import { describe, it, expect } from "vitest";
import { allTools, executeTool } from "./index.js";

describe("allTools", () => {
  it("contains 18 tool definitions", () => {
    expect(allTools).toHaveLength(18);
  });

  it("has unique names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each tool has name, description, and input_schema", () => {
    for (const tool of allTools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("contains the expected tool names", () => {
    const names = new Set(allTools.map((t) => t.name));
    const expected = new Set([
      "shell", "file_read", "file_write", "file_edit", "multi_edit",
      "grep", "glob", "todo", "repo_map", "delegate", "web_fetch",
      "memory", "web_search", "ask_user", "http_request", "process",
      "code_exec", "find_replace",
    ]);
    expect(names).toEqual(expected);
  });
});

describe("executeTool", () => {
  it("returns error for unknown tool", async () => {
    const result = await executeTool("nonexistent_tool", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toBe("Unknown tool: nonexistent_tool");
  });
});
