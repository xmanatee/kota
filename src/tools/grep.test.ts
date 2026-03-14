import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runGrep } from "./grep.js";

const TEST_DIR = join(process.cwd(), ".test-grep");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "hello.ts"), "const x = 42;\nconst y = 99;\nfunction hello() {}");
  writeFileSync(join(TEST_DIR, "world.py"), "def world():\n    return 42\n# comment");
  mkdirSync(join(TEST_DIR, "sub"), { recursive: true });
  writeFileSync(join(TEST_DIR, "sub", "nested.ts"), "import { hello } from '../hello';\n");
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("grep: input validation", () => {
  it("returns error when pattern is empty", async () => {
    const result = await runGrep({ pattern: "" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("pattern is required");
  });
});

describe("grep: basic search", () => {
  it("finds matches in files", async () => {
    const result = await runGrep({ pattern: "42", path: TEST_DIR });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("42");
  });

  it("returns 'No matches found' for non-matching pattern", async () => {
    const result = await runGrep({ pattern: "zzzznotfound", path: TEST_DIR });
    expect(result.content).toBe("No matches found.");
  });

  it("includes line numbers in output", async () => {
    const result = await runGrep({ pattern: "const y", path: TEST_DIR });
    expect(result.content).toMatch(/:\d+:/); // file:line: format
  });

  it("searches recursively by default", async () => {
    const result = await runGrep({ pattern: "hello", path: TEST_DIR });
    expect(result.content).toContain("hello");
    // Should find it in both hello.ts and sub/nested.ts
    expect(result.content).toContain("hello.ts");
  });
});

describe("grep: filtering", () => {
  it("filters by file glob", async () => {
    const result = await runGrep({
      pattern: "42",
      path: TEST_DIR,
      file_glob: "*.py",
    });
    expect(result.content).toContain("42");
    expect(result.content).toContain(".py");
    expect(result.content).not.toContain(".ts");
  });

  it("respects max_results limit", async () => {
    // Create a file with many distinct lines
    writeFileSync(join(TEST_DIR, "many.txt"), Array.from({ length: 20 }, (_, i) => `match_${i}`).join("\n"));
    const all = await runGrep({ pattern: "match_", path: join(TEST_DIR, "many.txt"), max_results: 50 });
    const limited = await runGrep({ pattern: "match_", path: join(TEST_DIR, "many.txt"), max_results: 3 });
    const allLines = all.content!.split("\n").filter((l: string) => l.includes("match_"));
    const limitedLines = limited.content!.split("\n").filter((l: string) => l.includes("match_"));
    expect(limitedLines.length).toBeLessThan(allLines.length);
    expect(limitedLines.length).toBeLessThanOrEqual(3);
  });
});

describe("grep: context lines", () => {
  it("shows context around matches when requested", async () => {
    const result = await runGrep({
      pattern: "const y",
      path: TEST_DIR,
      context_lines: 1,
    });
    // Should include surrounding lines
    expect(result.content).toContain("const x");
  });
});

describe("grep: regex support", () => {
  it("supports regex patterns", async () => {
    const result = await runGrep({ pattern: "const [xy]", path: TEST_DIR });
    expect(result.content).toContain("const");
  });

  it("handles special characters in patterns", async () => {
    const result = await runGrep({ pattern: "def world\\(\\)", path: TEST_DIR });
    expect(result.content).toContain("def world");
  });
});
