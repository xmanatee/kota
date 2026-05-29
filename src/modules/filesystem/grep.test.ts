import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatCountOutput, runGrep } from "./grep.js";

const TEST_DIR = join(process.cwd(), ".test-grep");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "hello.ts"), "const x = 42;\nconst y = 99;\nfunction hello() {}");
  writeFileSync(join(TEST_DIR, "world.py"), "def world():\n    return 42\n# comment");
  mkdirSync(join(TEST_DIR, "sub"), { recursive: true });
  writeFileSync(join(TEST_DIR, "sub", "nested.ts"), "import { hello } from '#modules/hello';\n");
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

  it("rejects string max_results without executing shell metacharacters", async () => {
    const probeDir = mkdtempSync(join(tmpdir(), "kota-grep-max-results-"));
    const marker = join(probeDir, "injected");
    try {
      const result = await runGrep({
        pattern: "42",
        path: TEST_DIR,
        max_results: `1; touch ${marker} #`,
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("max_results must be a finite integer");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });

  it("rejects string context_lines without executing shell metacharacters", async () => {
    const probeDir = mkdtempSync(join(tmpdir(), "kota-grep-context-lines-"));
    const marker = join(probeDir, "injected");
    try {
      const result = await runGrep({
        pattern: "42",
        path: TEST_DIR,
        context_lines: `1; touch ${marker} #`,
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("context_lines must be a finite integer");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });

  it("rejects non-integer and out-of-range numeric options", async () => {
    const invalidInputs = [
      { max_results: 0 },
      { max_results: 1.5 },
      { max_results: 10_001 },
      { context_lines: -1 },
      { context_lines: 1.5 },
      { context_lines: 101 },
    ];

    for (const invalidInput of invalidInputs) {
      const result = await runGrep({
        pattern: "42",
        path: TEST_DIR,
        ...invalidInput,
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("must be a finite integer");
    }
  });

  it("denies direct searches of the daemon control credential file", async () => {
    const result = await runGrep({
      pattern: "token",
      path: ".kota/daemon-control.json",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("protected project runtime credential");
  });

  it("denies direct searches of project secrets and env files", async () => {
    for (const path of [".kota/secrets.json", ".env", ".env.local"]) {
      const result = await runGrep({
        pattern: "token",
        path,
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("protected project runtime credential");
    }
  });

  it("excludes cased .kota credential aliases from recursive searches", async () => {
    const originalCwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), "kota-grep-protected-"));
    try {
      mkdirSync(join(projectDir, ".KOTA"), { recursive: true });
      writeFileSync(join(projectDir, ".KOTA", "daemon-control.json"), '{"token":"secret-token"}\n');
      writeFileSync(join(projectDir, ".KOTA", "secrets.json"), '{"API_KEY":"secret-token"}\n');
      process.chdir(projectDir);

      const result = await runGrep({ pattern: "secret-token", path: ".KOTA" });

      expect(result.is_error).toBeUndefined();
      expect(result.content).toBe("No matches found.");
    } finally {
      process.chdir(originalCwd);
      rmSync(projectDir, { recursive: true, force: true });
    }
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

describe("grep: files_only mode", () => {
  it("returns only file paths, no line content", async () => {
    const result = await runGrep({ pattern: "42", path: TEST_DIR, files_only: true });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("hello.ts");
    expect(result.content).toContain("world.py");
    // Should NOT have line numbers or content
    expect(result.content).not.toMatch(/:\d+:/);
  });

  it("returns 'No matches found' when nothing matches", async () => {
    const result = await runGrep({ pattern: "zzzznotfound", path: TEST_DIR, files_only: true });
    expect(result.content).toBe("No matches found.");
  });
});

describe("grep: count_only mode", () => {
  it("returns match counts per file with total", async () => {
    const result = await runGrep({ pattern: "42", path: TEST_DIR, count_only: true });
    expect(result.is_error).toBeUndefined();
    // Should contain file:count format
    expect(result.content).toMatch(/:\d+$/m);
    expect(result.content).toContain("Total:");
    expect(result.content).toContain("matches in");
  });

  it("returns 'No matches found' when nothing matches", async () => {
    const result = await runGrep({ pattern: "zzzznotfound", path: TEST_DIR, count_only: true });
    expect(result.content).toBe("No matches found.");
  });
});

describe("grep: files_only + file_glob filter", () => {
  it("returns only matching files filtered by glob", async () => {
    const result = await runGrep({
      pattern: "42",
      path: TEST_DIR,
      files_only: true,
      file_glob: "*.py",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("world.py");
    expect(result.content).not.toContain("hello.ts");
  });

  it("returns no matches when glob excludes all matching files", async () => {
    const result = await runGrep({
      pattern: "42",
      path: TEST_DIR,
      files_only: true,
      file_glob: "*.md",
    });
    expect(result.content).toBe("No matches found.");
  });
});

describe("grep: count_only + file_glob filter", () => {
  it("returns counts only for files matching glob", async () => {
    const result = await runGrep({
      pattern: "42",
      path: TEST_DIR,
      count_only: true,
      file_glob: "*.py",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("world.py");
    expect(result.content).not.toContain("hello.ts");
    expect(result.content).toContain("Total:");
  });
});

describe("grep: invalid regex handling", () => {
  it("returns error for invalid regex in default mode", async () => {
    const result = await runGrep({ pattern: "[invalid", path: TEST_DIR });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Search error");
  });

  it("returns error for invalid regex in files_only mode", async () => {
    const result = await runGrep({ pattern: "[invalid", path: TEST_DIR, files_only: true });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Search error");
  });

  it("returns error for invalid regex in count_only mode", async () => {
    const result = await runGrep({ pattern: "[invalid", path: TEST_DIR, count_only: true });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Search error");
  });
});

describe("formatCountOutput", () => {
  it("sums counts and filters zero-count entries", () => {
    const raw = "src/a.ts:5\nsrc/b.ts:0\nsrc/c.ts:3";
    const out = formatCountOutput(raw);
    expect(out).toContain("src/a.ts:5");
    expect(out).not.toContain("src/b.ts:0");
    expect(out).toContain("src/c.ts:3");
    expect(out).toContain("Total: 8 matches in 2 files");
  });

  it("returns no matches for all-zero input", () => {
    expect(formatCountOutput("src/a.ts:0\nsrc/b.ts:0")).toBe("No matches found.");
  });

  it("handles empty input", () => {
    expect(formatCountOutput("")).toBe("No matches found.");
  });
});
