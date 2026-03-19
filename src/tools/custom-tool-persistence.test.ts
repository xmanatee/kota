import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getToolPath,
  getToolsDir,
  MAX_CUSTOM_TOOLS,
  normalizeSchema,
  RESERVED_NAMES,
  saveToDisk,
  TOOL_NAME_RE,
  validateName,
} from "./custom-tool-persistence.js";

describe("validateName", () => {
  it("returns null for a valid name", () => {
    expect(validateName("my_tool")).toBeNull();
  });

  it("returns error for empty string", () => {
    expect(validateName("")).toMatch(/required/);
  });

  it("accepts minimum-length valid name (3 chars)", () => {
    expect(validateName("abc")).toBeNull();
  });

  it("rejects two-character name", () => {
    expect(validateName("ab")).not.toBeNull();
  });

  it("accepts 50-character name", () => {
    // TOOL_NAME_RE: ^[a-z][a-z0-9_]{1,48}[a-z0-9]$ → total 3-50 chars
    const name = `${"a".repeat(49)}b`; // 50 chars
    expect(validateName(name)).toBeNull();
  });

  it("rejects 51-character name", () => {
    const name = `${"a".repeat(50)}b`; // 51 chars
    expect(validateName(name)).not.toBeNull();
  });

  it("rejects names starting with digit", () => {
    expect(validateName("1_bad")).not.toBeNull();
  });

  it("rejects names with uppercase letters", () => {
    expect(validateName("MyTool")).not.toBeNull();
  });

  it("rejects names with hyphens", () => {
    expect(validateName("my-tool")).not.toBeNull();
  });

  it("rejects names ending with underscore", () => {
    expect(validateName("my_tool_")).not.toBeNull();
  });

  it("accepts names with digits in the middle", () => {
    expect(validateName("my_tool_2")).toBeNull();
  });

  it("rejects all reserved names", () => {
    for (const name of RESERVED_NAMES) {
      const result = validateName(name);
      expect(result, `Expected "${name}" to be rejected`).not.toBeNull();
      expect(result).toMatch(/conflicts with a built-in tool/);
    }
  });

  it("returns snake_case guidance in error message for invalid format", () => {
    const result = validateName("BadName");
    expect(result).toMatch(/snake_case/);
  });
});

describe("normalizeSchema", () => {
  it("returns default empty schema for undefined input", () => {
    expect(normalizeSchema(undefined)).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("passes through a valid schema", () => {
    const schema = {
      type: "object",
      properties: { x: { type: "number" } },
    };
    expect(normalizeSchema(schema)).toBe(schema);
  });

  it("returns error string for array input", () => {
    const result = normalizeSchema([] as unknown as Record<string, unknown>);
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/JSON Schema object/);
  });

  it("returns error string for non-object type", () => {
    const result = normalizeSchema({ type: "string" });
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/"object"/);
  });

  it("returns error string when properties is missing", () => {
    const result = normalizeSchema({ type: "object" });
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/properties/);
  });

  it("returns error string when properties is null", () => {
    const result = normalizeSchema({ type: "object", properties: null });
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/properties/);
  });

  it("returns error string when properties is a string", () => {
    const result = normalizeSchema({ type: "object", properties: "bad" });
    expect(typeof result).toBe("string");
    expect(result as string).toMatch(/properties/);
  });

  it("passes schema with extra fields through unchanged", () => {
    const schema = {
      type: "object",
      properties: {},
      required: ["x"],
      additionalProperties: false,
    };
    expect(normalizeSchema(schema)).toBe(schema);
  });
});

describe("TOOL_NAME_RE", () => {
  it("matches valid snake_case names", () => {
    expect(TOOL_NAME_RE.test("abc")).toBe(true);
    expect(TOOL_NAME_RE.test("my_tool")).toBe(true);
    expect(TOOL_NAME_RE.test("tool_2")).toBe(true);
  });

  it("rejects invalid patterns", () => {
    expect(TOOL_NAME_RE.test("AB")).toBe(false);
    expect(TOOL_NAME_RE.test("_start")).toBe(false);
    expect(TOOL_NAME_RE.test("end_")).toBe(false);
    expect(TOOL_NAME_RE.test("1start")).toBe(false);
  });
});

describe("MAX_CUSTOM_TOOLS", () => {
  it("is 20", () => {
    expect(MAX_CUSTOM_TOOLS).toBe(20);
  });
});

describe("getToolsDir / getToolPath", () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    process.cwd = () => "/tmp/test-kota-project";
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("getToolsDir returns .kota/tools under cwd", () => {
    expect(getToolsDir()).toBe("/tmp/test-kota-project/.kota/tools");
  });

  it("getToolPath returns .json file under tools dir", () => {
    expect(getToolPath("my_tool")).toBe(
      "/tmp/test-kota-project/.kota/tools/my_tool.json",
    );
  });

  it("getToolPath uses the tool name verbatim", () => {
    expect(getToolPath("alpha_beta_2")).toContain("alpha_beta_2.json");
  });
});

describe("saveToDisk", () => {
  const testRoot = join(tmpdir(), `kota-persistence-test-${Date.now()}`);
  const originalCwd = process.cwd;

  beforeEach(() => {
    mkdirSync(testRoot, { recursive: true });
    process.cwd = () => testRoot;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("creates the tools directory if it does not exist", () => {
    saveToDisk({
      name: "my_tool",
      description: "A test tool",
      parameters: { type: "object", properties: {} },
      code: "print('hi')",
      language: "python",
      timeoutMs: 30000,
    });
    expect(existsSync(join(testRoot, ".kota", "tools"))).toBe(true);
  });

  it("writes a valid JSON file with the tool definition", () => {
    const def = {
      name: "save_test",
      description: "Save test tool",
      parameters: { type: "object", properties: { x: { type: "string" } } },
      code: "print(params['x'])",
      language: "python" as const,
      timeoutMs: 5000,
    };
    saveToDisk(def);

    const filePath = join(testRoot, ".kota", "tools", "save_test.json");
    expect(existsSync(filePath)).toBe(true);

    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    expect(saved.name).toBe("save_test");
    expect(saved.description).toBe("Save test tool");
    expect(saved.code).toBe("print(params['x'])");
    expect(saved.language).toBe("python");
    expect(saved.parameters).toEqual(def.parameters);
  });

  it("does not persist timeoutMs in the saved file", () => {
    saveToDisk({
      name: "no_timeout",
      description: "No timeout",
      parameters: { type: "object", properties: {} },
      code: "print('x')",
      language: "node",
      timeoutMs: 99999,
    });

    const filePath = join(testRoot, ".kota", "tools", "no_timeout.json");
    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    expect(saved.timeoutMs).toBeUndefined();
  });

  it("overwrites an existing tool file", () => {
    const base = {
      name: "overwrite_me",
      description: "v1",
      parameters: { type: "object", properties: {} },
      code: "print('v1')",
      language: "python" as const,
      timeoutMs: 5000,
    };
    saveToDisk(base);
    saveToDisk({ ...base, description: "v2", code: "print('v2')" });

    const filePath = join(testRoot, ".kota", "tools", "overwrite_me.json");
    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    expect(saved.description).toBe("v2");
    expect(saved.code).toBe("print('v2')");
  });
});
