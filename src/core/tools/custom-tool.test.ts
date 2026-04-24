import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupSessions } from "#modules/execution/repl-session.js";
import {
  getCustomToolCount,
  loadSavedTools,
  resetCustomTools,
  runCustomTool,
} from "./custom-tool.js";
import { executeTool, getAllTools } from "./index.js";

// Use a temp directory for persistence tests
const testDir = join(tmpdir(), `kota-custom-tool-test-${Date.now()}`);
const toolsDir = join(testDir, ".kota", "tools");

beforeAll(() => {
  mkdirSync(toolsDir, { recursive: true });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetCustomTools();
});

describe("runCustomTool", () => {
  describe("create action", () => {
    it("creates a session-only custom tool", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "greet_user",
        description: "Greets a user by name",
        parameters: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        code: 'print(f"Hello, {params[\'name\']}!")',
        language: "python",
      });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('Created custom tool "greet_user"');
      expect(result.content).toContain("session-only");
      expect(result.content).toContain("Parameters: name");
      expect(getCustomToolCount()).toBe(1);
    });

    it("registers tool in the global tool list", async () => {
      await runCustomTool({
        action: "create",
        name: "my_tool",
        description: "A test tool",
        code: "print('hi')",
      });

      const tools = getAllTools();
      expect(tools.some((t) => t.name === "my_tool")).toBe(true);
    });

    it("allows creating tool with no parameters", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "no_params",
        description: "No params tool",
        code: "print('done')",
      });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("No parameters");
    });

    it("allows replacing an existing custom tool", async () => {
      await runCustomTool({
        action: "create",
        name: "replaceable",
        description: "Version 1",
        code: "print('v1')",
      });

      const result = await runCustomTool({
        action: "create",
        name: "replaceable",
        description: "Version 2",
        code: "print('v2')",
      });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain('Created custom tool "replaceable"');
      expect(getCustomToolCount()).toBe(1);
    });

    it("defaults to python language", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "default_lang",
        description: "Default language",
        code: "print('python')",
      });

      expect(result.content).toContain("Language: python");
    });

    it("supports node language", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "node_tool",
        description: "Node tool",
        code: "console.log('node')",
        language: "node",
      });

      expect(result.content).toContain("Language: node");
    });

    // --- Validation errors ---

    it("rejects missing name", async () => {
      const result = await runCustomTool({
        action: "create",
        description: "No name",
        code: "print('x')",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("name is required");
    });

    it("rejects invalid name format", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "BadName",
        description: "Invalid",
        code: "print('x')",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("snake_case");
    });

    it("rejects short names", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "ab",
        description: "Too short",
        code: "print('x')",
      });
      expect(result.is_error).toBe(true);
    });

    it("rejects reserved names", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "shell",
        description: "Conflicts",
        code: "print('x')",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("conflicts with a project tool");
    });

    it("rejects missing description", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "no_desc",
        code: "print('x')",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("description is required");
    });

    it("rejects missing code", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "no_code",
        description: "No code",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("code is required");
    });

    it("rejects invalid language", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "bad_lang",
        description: "Bad language",
        code: "print('x')",
        language: "ruby",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("python");
    });

    it("rejects invalid parameters schema", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "bad_params",
        description: "Bad params",
        code: "print('x')",
        parameters: { type: "string" },
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("object");
    });

    it("rejects parameters without properties", async () => {
      const result = await runCustomTool({
        action: "create",
        name: "no_props",
        description: "No properties",
        code: "print('x')",
        parameters: { type: "object" },
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("properties");
    });

    it("enforces maximum tool count", async () => {
      // Create 20 tools
      for (let i = 0; i < 20; i++) {
        await runCustomTool({
          action: "create",
          name: `tool_${String(i).padStart(3, "0")}`,
          description: `Tool ${i}`,
          code: "print('x')",
        });
      }

      const result = await runCustomTool({
        action: "create",
        name: "one_too_many",
        description: "Over limit",
        code: "print('x')",
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("maximum");
    });
  });

  describe("list action", () => {
    it("shows empty message when no custom tools", async () => {
      const result = await runCustomTool({ action: "list" });
      expect(result.content).toContain("No custom tools defined");
    });

    it("lists created tools", async () => {
      await runCustomTool({
        action: "create",
        name: "tool_alpha",
        description: "Alpha tool",
        parameters: { type: "object", properties: { x: { type: "number" } } },
        code: "print(params['x'])",
      });
      await runCustomTool({
        action: "create",
        name: "tool_beta",
        description: "Beta tool",
        code: "print('beta')",
        language: "node",
      });

      const result = await runCustomTool({ action: "list" });
      expect(result.content).toContain("Custom tools (2)");
      expect(result.content).toContain("tool_alpha(x) [python]: Alpha tool");
      expect(result.content).toContain("tool_beta() [node]: Beta tool");
    });
  });

  describe("remove action", () => {
    it("removes a custom tool", async () => {
      await runCustomTool({
        action: "create",
        name: "removable",
        description: "To be removed",
        code: "print('x')",
      });
      expect(getCustomToolCount()).toBe(1);

      const result = await runCustomTool({ action: "remove", name: "removable" });
      expect(result.content).toContain('Removed custom tool "removable"');
      expect(getCustomToolCount()).toBe(0);
    });

    it("deregisters from global tool list", async () => {
      await runCustomTool({
        action: "create",
        name: "to_remove",
        description: "Remove me",
        code: "print('x')",
      });
      expect(getAllTools().some((t) => t.name === "to_remove")).toBe(true);

      await runCustomTool({ action: "remove", name: "to_remove" });
      expect(getAllTools().some((t) => t.name === "to_remove")).toBe(false);
    });

    it("errors when removing non-existent tool", async () => {
      const result = await runCustomTool({ action: "remove", name: "no_such_tool" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("no custom tool");
    });

    it("errors when name is missing", async () => {
      const result = await runCustomTool({ action: "remove" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("name is required");
    });
  });

  describe("unknown action", () => {
    it("returns error for invalid action", async () => {
      const result = await runCustomTool({ action: "invalid" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("Unknown action");
    });
  });
});

describe("persistence", () => {
  it("saves and loads tools from disk", () => {
    const cwd = process.cwd;
    process.cwd = () => testDir;

    try {
      // Save a tool file directly
      const def = {
        name: "saved_tool",
        description: "A persisted tool",
        parameters: { type: "object", properties: { msg: { type: "string" } } },
        code: "print(params['msg'])",
        language: "python",
      };
      writeFileSync(join(toolsDir, "saved_tool.json"), JSON.stringify(def));

      const count = loadSavedTools();
      expect(count).toBe(1);
      expect(getCustomToolCount()).toBe(1);
      expect(getAllTools().some((t) => t.name === "saved_tool")).toBe(true);
    } finally {
      process.cwd = cwd;
    }
  });

  it("skips already-loaded tools on second call", () => {
    const cwd = process.cwd;
    process.cwd = () => testDir;

    try {
      // First load should register the tool
      const first = loadSavedTools();
      expect(first).toBe(1);

      // Second load should skip it (already in customDefs)
      const second = loadSavedTools();
      expect(second).toBe(0);
    } finally {
      process.cwd = cwd;
    }
  });

  it("skips invalid tool files", () => {
    const cwd = process.cwd;
    process.cwd = () => testDir;

    // Reset first to clear previous loaded tools
    resetCustomTools();

    try {
      writeFileSync(join(toolsDir, "bad.json"), "not json");
      writeFileSync(join(toolsDir, "incomplete.json"), JSON.stringify({ name: "x" }));

      const count = loadSavedTools();
      // Should load saved_tool but skip bad.json and incomplete.json
      expect(count).toBe(1);
    } finally {
      process.cwd = cwd;
    }
  });

  it("returns 0 when .kota/tools/ does not exist", () => {
    const cwd = process.cwd;
    const nonexistent = join(tmpdir(), `kota-no-tools-${Date.now()}`);
    process.cwd = () => nonexistent;

    try {
      expect(loadSavedTools()).toBe(0);
    } finally {
      process.cwd = cwd;
    }
  });
});

describe("deregisterTool", () => {
  it("removes tool from global list", async () => {
    await runCustomTool({
      action: "create",
      name: "test_dereg",
      description: "Deregister test",
      code: "print('x')",
    });

    const before = getAllTools();
    expect(before.some((t) => t.name === "test_dereg")).toBe(true);

    await runCustomTool({ action: "remove", name: "test_dereg" });

    const after = getAllTools();
    expect(after.some((t) => t.name === "test_dereg")).toBe(false);
  });
});

describe("resetCustomTools", () => {
  it("clears all custom tools", async () => {
    await runCustomTool({
      action: "create",
      name: "reset_test_a",
      description: "A",
      code: "print('a')",
    });
    await runCustomTool({
      action: "create",
      name: "reset_test_b",
      description: "B",
      code: "print('b')",
    });

    expect(getCustomToolCount()).toBe(2);
    resetCustomTools();
    expect(getCustomToolCount()).toBe(0);
  });
});

describe("custom tool execution (integration)", () => {
  afterAll(() => {
    cleanupSessions();
  });

  it("executes a Python custom tool", async () => {
    await runCustomTool({
      action: "create",
      name: "add_numbers",
      description: "Add two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
      },
      code: "print(params['a'] + params['b'])",
      language: "python",
    });

    const result = await executeTool("add_numbers", { a: 3, b: 7 });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("10");
  });

  it("executes a Node.js custom tool", async () => {
    await runCustomTool({
      action: "create",
      name: "reverse_string",
      description: "Reverse a string",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      code: "console.log(params.text.split('').reverse().join(''))",
      language: "node",
    });

    const result = await executeTool("reverse_string", { text: "hello" });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("olleh");
  });

  it("handles errors in custom tool code gracefully", async () => {
    await runCustomTool({
      action: "create",
      name: "will_fail",
      description: "This will error",
      code: "raise ValueError('intentional error')",
      language: "python",
    });

    const result = await executeTool("will_fail", {});
    expect(result.content).toContain("ValueError");
    expect(result.content).toContain("intentional error");
  });

  it("passes complex parameters correctly", async () => {
    await runCustomTool({
      action: "create",
      name: "format_data",
      description: "Format structured data",
      parameters: {
        type: "object",
        properties: {
          items: { type: "array" },
          separator: { type: "string" },
        },
      },
      code: "print(params['separator'].join(str(x) for x in params['items']))",
      language: "python",
    });

    const result = await executeTool("format_data", {
      items: [1, 2, 3],
      separator: " | ",
    });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("1 | 2 | 3");
  });

  it("handles params with special characters", async () => {
    await runCustomTool({
      action: "create",
      name: "echo_special",
      description: "Echo text with special chars",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      code: "print(params['text'])",
      language: "python",
    });

    const result = await executeTool("echo_special", {
      text: "Hello 'world' \"test\" \n newline & special <chars>",
    });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("Hello 'world'");
  });
});
