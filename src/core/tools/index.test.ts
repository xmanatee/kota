import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { riskFromEffect } from "./effect.js";
import { clearCustomTools, deregisterModuleTools, executeTool, getAllTools, getCoreRegistrations, getRegisteredTools, registerTool } from "./index.js";

const makeTool = (name: string) => ({
  name,
  description: `Test tool: ${name}`,
  input_schema: { type: "object" as const, properties: {} },
});

describe("getAllTools", () => {
  it("contains built-in tool definitions", () => {
    expect(getAllTools()).toHaveLength(10);
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
    // Filesystem tools (file_read, file_write, file_edit, multi_edit, grep, glob,
    // file_watch, find_replace, files_overview) are now in the filesystem module.
    // Execution tools (shell, process, code_exec, computer_use, screenshot) are now
    // in the execution module.
    // git is now in the git module.
    // read_document is now in the read-document module.
    // System tools (clipboard, view_image, env_info, sqlite, notify) are now in the system module.
    // repo_map is now in the filesystem module.
    const expected = new Set([
      "agent_status", "approval",
      "todo", "delegate",
      "ask_user", "ask_owner", "confirm",
      "custom_tool", "checkpoint", "module_factory",
    ]);
    expect(names).toEqual(expected);
  });
});

describe("getCoreRegistrations", () => {
  it("returns all core tool registrations", () => {
    const regs = getCoreRegistrations();
    expect(regs).toHaveLength(10);
  });

  it("each registration has tool, runner, and effect", () => {
    for (const reg of getCoreRegistrations()) {
      expect(reg.tool).toBeDefined();
      expect(typeof reg.tool.name).toBe("string");
      expect(typeof reg.runner).toBe("function");
      expect(reg.effect).toBeDefined();
      expect(["read", "write", "destructive"]).toContain(reg.effect.kind);
      expect(["safe", "moderate", "dangerous"]).toContain(riskFromEffect(reg.effect));
    }
  });

  it("registration names match getAllTools names", () => {
    const regNames = new Set(getCoreRegistrations().map((r) => r.tool.name));
    const toolNames = new Set(getAllTools().map((t) => t.name));
    // getAllTools has all core registrations (may also include custom tools)
    for (const name of regNames) {
      expect(toolNames.has(name)).toBe(true);
    }
  });

  it("safe tools have read-only or coordination semantics", () => {
    const safeNames = getCoreRegistrations()
      .filter((r) => riskFromEffect(r.effect) === "safe")
      .map((r) => r.tool.name)
      .sort();
    expect(safeNames).toContain("ask_user");
    // web, filesystem, and execution tools are now in modules, not in core registrations
    expect(safeNames).not.toContain("shell");
    expect(safeNames).not.toContain("screenshot");
    expect(safeNames).not.toContain("file_read");
    expect(safeNames).not.toContain("grep");
    expect(safeNames).not.toContain("glob");
    expect(safeNames).not.toContain("web_search");
    expect(safeNames).not.toContain("web_fetch");
  });

  it("grouped tools have valid group names", () => {
    const validGroups = new Set(["web", "code", "advanced_editing", "management", "gui", "orchestration"]);
    for (const reg of getCoreRegistrations()) {
      if (reg.group) {
        expect(validGroups.has(reg.group)).toBe(true);
      }
    }
  });

  it("core tools (no group) include essential tools", () => {
    const coreNames = getCoreRegistrations()
      .filter((r) => !r.group)
      .map((r) => r.tool.name);
    // shell is now in the execution module, not in core
    expect(coreNames).not.toContain("shell");
    // file_read is now in the filesystem module, not in core
    expect(coreNames).not.toContain("file_read");
    expect(coreNames).toContain("delegate");
    expect(coreNames).toContain("ask_user");
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
      registerTool(makeTool("delegate"), async () => ({ content: "" })),
    ).toThrow("Tool already registered: delegate");
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
    expect(getAllTools()).toHaveLength(10);
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

describe("child_process isolation", () => {
  // Tools that intentionally run real commands in isolated temp dirs (integration tests)
  const INTEGRATION_ALLOWLIST = new Set(["git", "sqlite", "shell", "grep", "file-read", "file-read-formats", "code-exec", "process", "process-core", "env-probes", "runtime-check"]);

  it("every tool using execFileSync/execSync has a test that mocks child_process", () => {
    const toolsDir = new URL(".", import.meta.url).pathname;
    const sources = readdirSync(toolsDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts");

    const violations: string[] = [];

    for (const src of sources) {
      const content = readFileSync(join(toolsDir, src), "utf-8");
      const importsChildProcess =
        content.includes("from \"node:child_process\"") ||
        content.includes("from 'node:child_process'");

      if (!importsChildProcess) continue;

      const baseName = src.replace(".ts", "");
      if (INTEGRATION_ALLOWLIST.has(baseName)) continue;

      const testFile = src.replace(".ts", ".test.ts");
      const testPath = join(toolsDir, testFile);
      let testContent: string;
      try {
        testContent = readFileSync(testPath, "utf-8");
      } catch {
        violations.push(`${src}: imports child_process but has no test file (${testFile})`);
        continue;
      }

      if (!testContent.includes('vi.mock("node:child_process"')) {
        violations.push(`${src}: imports child_process but ${testFile} does not mock it`);
      }
    }

    expect(violations).toEqual([]);
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
