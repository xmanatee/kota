import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordRead } from "./file-tracker.js";
import { runFileEdit } from "./modules/filesystem/file-edit.js";
import { runFileRead } from "./modules/filesystem/file-read.js";

/**
 * Cross-module integration: file-edit × lint × file-tracker.
 * No mocks — exercises the real lint-gated edit pipeline.
 */
describe("file-edit × lint integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kota-edit-int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("valid JS edit passes lint and modifies file", async () => {
    const path = join(dir, "test.js");
    writeFileSync(path, "const x = 1;\n");
    recordRead(path);

    const result = await runFileEdit({ path, old_string: "const x = 1;", new_string: "const x = 2;" });
    const content = typeof result === "string" ? result : result.content;

    expect(content).not.toMatch(/revert/i);
    expect(readFileSync(path, "utf-8")).toContain("const x = 2;");
  });

  it("syntax-error JS edit is reverted by lint", async () => {
    const path = join(dir, "test.js");
    writeFileSync(path, "const x = 1;\n");
    recordRead(path);

    const result = await runFileEdit({ path, old_string: "const x = 1;", new_string: "const x = {;" });
    const content = typeof result === "string" ? result : result.content;
    const isError = typeof result === "object" && result.is_error;

    expect(isError || content.match(/revert|syntax|error/i)).toBeTruthy();
    expect(readFileSync(path, "utf-8")).toBe("const x = 1;\n");
  });

  it("valid JSON edit passes lint", async () => {
    const path = join(dir, "data.json");
    writeFileSync(path, '{"name": "old"}\n');
    recordRead(path);

    const result = await runFileEdit({ path, old_string: '"old"', new_string: '"new"' });
    const content = typeof result === "string" ? result : result.content;

    expect(content).not.toMatch(/revert/i);
    expect(readFileSync(path, "utf-8")).toContain('"new"');
  });

  it("invalid JSON edit is reverted by lint", async () => {
    const path = join(dir, "data.json");
    writeFileSync(path, '{"name": "test"}\n');
    recordRead(path);

    const result = await runFileEdit({ path, old_string: '"test"}', new_string: '"test",}' });
    const content = typeof result === "string" ? result : result.content;

    expect(
      (typeof result === "object" && result.is_error) ||
      content.match(/revert|syntax|error|parse/i),
    ).toBeTruthy();
    expect(readFileSync(path, "utf-8")).toBe('{"name": "test"}\n');
  });

  it("lint revert error includes enough detail for agent self-correction", async () => {
    const path = join(dir, "broken.js");
    writeFileSync(path, "function f() { return 1; }\n");
    recordRead(path);

    const result = await runFileEdit({
      path,
      old_string: "return 1;",
      new_string: "return {;",
    });
    const content = typeof result === "string" ? result : result.content;

    // Error should be substantial — not a bare "error" with no guidance
    expect(content.length).toBeGreaterThan(20);
    expect(readFileSync(path, "utf-8")).toContain("return 1;");
  });

  it("whitespace-tolerant match still passes lint gate", async () => {
    const path = join(dir, "ws.js");
    writeFileSync(path, "    const longVariableName = 1;\n");
    recordRead(path);

    const result = await runFileEdit({
      path,
      old_string: "const longVariableName = 1;",
      new_string: "const longVariableName = 2;",
    });
    const content = typeof result === "string" ? result : result.content;

    // Whitespace-tolerant match should succeed and pass lint
    expect(readFileSync(path, "utf-8")).toContain("longVariableName = 2;");
    expect(content).not.toMatch(/revert/i);
  });
});

/**
 * Cross-module: file-edit × path-resolver × file-tracker (error recovery paths).
 * Tests that error messages from non-existent files, stale files, and fuzzy matches
 * flow correctly through the module boundaries and provide actionable output.
 */
describe("file-edit × path-resolver error recovery", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kota-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("file_edit on non-existent path returns is_error with path-resolver message", async () => {
    const result = await runFileEdit({
      path: join(dir, "nonexistent.yaml"),
      old_string: "timeout: 30",
      new_string: "timeout: 60",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("file not found");
    expect(result.content).toContain("nonexistent.yaml");
  });

  it("file_read on non-existent path returns is_error with path-resolver message", async () => {
    const result = await runFileRead({ path: join(dir, "missing.yml") });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("file not found");
    expect(result.content).toContain("missing.yml");
    // path-resolver suggestAlternatives runs (glob from cwd) — format is correct
    // even if no suggestions found in tmp dir, the base error message is actionable
  });

  it("file_edit stale file warning flows through on old_string not found", async () => {
    const path = join(dir, "stale.js");
    writeFileSync(path, "const a = 1;\n");
    recordRead(path);

    // Externally modify the file to make the tracked mtime stale
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(path, "const a = 999;\n");

    const result = await runFileEdit({
      path,
      old_string: "const a = 1;",
      new_string: "const a = 2;",
    });

    expect(result.is_error).toBe(true);
    // Should contain both the stale warning AND the not-found error
    expect(result.content).toMatch(/modified since you last read/i);
    expect(result.content).toMatch(/not found/i);
  });

  it("file_edit fuzzy match shows similar region with line numbers", async () => {
    const path = join(dir, "fuzzy.js");
    const code = [
      "function greet(name) {",
      '  const msg = "Hello, " + name;',
      "  console.log(msg);",
      "  return msg;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, code);
    recordRead(path);

    const result = await runFileEdit({
      path,
      // Close but not exact — different quote style
      old_string: "const msg = 'Hello, ' + name;",
      new_string: "const msg = 'Hi, ' + name;",
    });

    expect(result.is_error).toBe(true);
    // Fuzzy match should show the similar region with >>> markers and line numbers
    expect(result.content).toMatch(/similar/i);
    expect(result.content).toMatch(/>>>/);
    // Should guide the agent to re-read
    expect(result.content).toMatch(/re-read|whitespace|exact/i);
  });

  it("whitespace-tolerant edit that breaks syntax is reverted", async () => {
    const path = join(dir, "ws-revert.json");
    writeFileSync(path, '  { "enabled": true }\n');
    recordRead(path);

    const result = await runFileEdit({
      path,
      // No leading whitespace — triggers whitespace-tolerant match
      old_string: '{ "enabled": true }',
      // Replacement has invalid JSON syntax
      new_string: '{ "enabled": true, }',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/revert|syntax/i);
    // File should be restored to original
    expect(readFileSync(path, "utf-8")).toBe('  { "enabled": true }\n');
  });
});
