import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFindReplace } from "./extensions/filesystem/find-replace.js";
import { runMultiEdit } from "./extensions/filesystem/multi-edit.js";

/**
 * Cross-module integration: multi-edit × lint × file-tracker × diff.
 * Tests atomic rollback behavior when lint rejects mid-batch edits.
 */
describe("multi-edit × lint × file-tracker integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kota-me-int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("all valid edits succeed and modify files", async () => {
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "const x = 1;\n");
    writeFileSync(b, "const y = 2;\n");

    const result = await runMultiEdit({
      edits: [
        { path: a, old_string: "const x = 1;", new_string: "const x = 10;" },
        { path: b, old_string: "const y = 2;", new_string: "const y = 20;" },
      ],
    });

    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("2 edit(s)");
    expect(readFileSync(a, "utf-8")).toContain("const x = 10;");
    expect(readFileSync(b, "utf-8")).toContain("const y = 20;");
  });

  it("lint failure on second edit reverts ALL edits atomically", async () => {
    const a = join(dir, "ok.js");
    const b = join(dir, "bad.js");
    writeFileSync(a, "const x = 1;\n");
    writeFileSync(b, "const y = 2;\n");

    const result = await runMultiEdit({
      edits: [
        { path: a, old_string: "const x = 1;", new_string: "const x = 10;" },
        // This introduces a syntax error — lint should reject
        { path: b, old_string: "const y = 2;", new_string: "const y = {;" },
      ],
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/syntax error/i);
    expect(result.content).toContain("All edits reverted");
    // Both files should be reverted to original
    expect(readFileSync(a, "utf-8")).toBe("const x = 1;\n");
    expect(readFileSync(b, "utf-8")).toBe("const y = 2;\n");
  });

  it("old_string not found mid-batch reverts prior edits", async () => {
    const f = join(dir, "combo.js");
    writeFileSync(f, "const a = 1;\nconst b = 2;\n");

    const result = await runMultiEdit({
      edits: [
        { path: f, old_string: "const a = 1;", new_string: "const a = 10;" },
        { path: f, old_string: "const c = 3;", new_string: "const c = 30;" },
      ],
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/not found/i);
    // File should be fully reverted
    expect(readFileSync(f, "utf-8")).toBe("const a = 1;\nconst b = 2;\n");
  });

  it("ambiguous match mid-batch reverts prior edits", async () => {
    const f = join(dir, "dup.js");
    writeFileSync(f, "let x = 1;\nlet x = 1;\n");

    const result = await runMultiEdit({
      edits: [
        { path: f, old_string: "let x = 1;", new_string: "let x = 2;" },
      ],
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/appears 2 times/i);
    expect(readFileSync(f, "utf-8")).toBe("let x = 1;\nlet x = 1;\n");
  });
});

/**
 * Cross-module integration: find-replace × lint × file-tracker.
 * Tests atomic rollback across multiple files when lint rejects.
 */
describe("find-replace × lint × file-tracker integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kota-fr-int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("valid replacement across multiple files succeeds", async () => {
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, 'const name = "old";\n');
    writeFileSync(b, 'const name = "old";\n');

    const result = await runFindReplace({
      pattern: '"old"',
      replacement: '"new"',
      files: join(dir, "*.js"),
    });

    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("2 file(s)");
    expect(readFileSync(a, "utf-8")).toContain('"new"');
    expect(readFileSync(b, "utf-8")).toContain('"new"');
  });

  it("lint failure on second file reverts ALL files", async () => {
    // a.js gets a valid replacement, b.json gets an invalid one
    const a = join(dir, "a.js");
    const b = join(dir, "b.json");
    writeFileSync(a, 'const v = "old";\n');
    writeFileSync(b, '{"key": "old"}\n');

    // This replacement is valid JS but creates invalid JSON (trailing comma)
    const result = await runFindReplace({
      pattern: '"old"',
      replacement: '"new",',
      files: join(dir, "*"),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/syntax error/i);
    expect(result.content).toContain("reverted");
    // Both files should be restored
    expect(readFileSync(a, "utf-8")).toBe('const v = "old";\n');
    expect(readFileSync(b, "utf-8")).toBe('{"key": "old"}\n');
  });

  it("dry run does not modify files", async () => {
    const f = join(dir, "dry.js");
    writeFileSync(f, "const x = 1;\n");

    const result = await runFindReplace({
      pattern: "const x = 1",
      replacement: "const x = 2",
      files: join(dir, "*.js"),
      dry_run: true,
    });

    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("Dry run");
    expect(readFileSync(f, "utf-8")).toBe("const x = 1;\n");
  });
});
