import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFileEdit } from "./tools/file-edit.js";
import { recordRead } from "./file-tracker.js";

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
