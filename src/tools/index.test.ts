import { afterEach, describe, expect, it } from "vitest";
import { getAllTools, clearCustomTools, deregisterModuleTools, executeTool, getRegisteredTools, registerTool } from "./index.js";

const makeTool = (name: string) => ({
  name,
  description: `Test tool: ${name}`,
  input_schema: { type: "object" as const, properties: {} },
});

describe("getAllTools", () => {
  it("contains 19 built-in tool definitions (memory + schedule moved to modules)", () => {
    expect(getAllTools()).toHaveLength(19);
  });

  it("has unique names", () => {
    const names = getAllTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each tool has name, description, and input_schema", () => {
    for (const tool of getAllTools()) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("contains the expected tool names", () => {
    const names = new Set(getAllTools().map((t) => t.name));
    const expected = new Set([
      "shell", "file_read", "file_write", "file_edit", "multi_edit",
      "grep", "glob", "todo", "repo_map", "delegate", "web_fetch",
      "web_search", "ask_user", "http_request", "process",
      "code_exec", "find_replace", "notebook", "files_overview",
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

describe("registerTool", () => {
  afterEach(() => clearCustomTools());

  it("adds custom tool to registry and makes it executable", async () => {
    const before = getAllTools().length;
    registerTool(makeTool("custom_greet"), async (input) => ({
      content: `Hello, ${input.name ?? "world"}!`,
    }));
    expect(getAllTools()).toHaveLength(before + 1);
    expect(getAllTools().find((t) => t.name === "custom_greet")).toBeDefined();
    const result = await executeTool("custom_greet", { name: "Kim" });
    expect(result.content).toBe("Hello, Kim!");
    expect(result.is_error).toBeUndefined();
  });

  it("rejects duplicate built-in tool name", () => {
    expect(() =>
      registerTool(makeTool("shell"), async () => ({ content: "" })),
    ).toThrow("Tool already registered: shell");
  });

  it("rejects duplicate custom tool name", () => {
    registerTool(makeTool("my_tool"), async () => ({ content: "" }));
    expect(() =>
      registerTool(makeTool("my_tool"), async () => ({ content: "" })),
    ).toThrow("Tool already registered: my_tool");
  });

  it("getRegisteredTools returns only custom tools", () => {
    registerTool(makeTool("extra_a"), async () => ({ content: "a" }));
    registerTool(makeTool("extra_b"), async () => ({ content: "b" }));
    const custom = getRegisteredTools();
    expect(custom).toHaveLength(2);
    expect(custom.map((t) => t.name).sort()).toEqual(["extra_a", "extra_b"]);
  });

  it("clearCustomTools removes custom tools without affecting built-ins", () => {
    registerTool(makeTool("temp_tool"), async () => ({ content: "" }));
    expect(getAllTools().find((t) => t.name === "temp_tool")).toBeDefined();
    clearCustomTools();
    expect(getAllTools().find((t) => t.name === "temp_tool")).toBeUndefined();
    expect(getAllTools()).toHaveLength(19);
    expect(getRegisteredTools()).toHaveLength(0);
  });

  it("cleared custom tool is no longer executable", async () => {
    registerTool(makeTool("ephemeral"), async () => ({ content: "hi" }));
    clearCustomTools();
    const result = await executeTool("ephemeral", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toBe("Unknown tool: ephemeral");
  });
});

describe("deregisterModuleTools", () => {
  afterEach(() => clearCustomTools());

  it("removes only tools belonging to the specified module", async () => {
    registerTool(makeTool("mod_a_tool"), async () => ({ content: "a" }), "mod-a");
    registerTool(makeTool("mod_b_tool"), async () => ({ content: "b" }), "mod-b");

    deregisterModuleTools("mod-a");

    const ra = await executeTool("mod_a_tool", {});
    expect(ra.is_error).toBe(true);

    const rb = await executeTool("mod_b_tool", {});
    expect(rb.content).toBe("b");
  });

  it("is a no-op for unknown module name", () => {
    const before = getAllTools().length;
    deregisterModuleTools("nonexistent");
    expect(getAllTools().length).toBe(before);
  });

  it("allows re-registration after deregister", async () => {
    registerTool(makeTool("reuse_tool"), async () => ({ content: "v1" }), "mod-x");
    deregisterModuleTools("mod-x");

    registerTool(makeTool("reuse_tool"), async () => ({ content: "v2" }), "mod-x");
    const r = await executeTool("reuse_tool", {});
    expect(r.content).toBe("v2");
  });
});
