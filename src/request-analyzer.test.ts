import { describe, expect, it } from "vitest";
import {
  extractPaths,
  extractSearchTerms,
  formatContextHint,
  type RequestAnalysis,
  resolveExistingPaths,
} from "./request-analyzer.js";

describe("extractPaths", () => {
  it("extracts relative paths with ./ prefix", () => {
    expect(extractPaths("look at ./src/foo.ts")).toContain("./src/foo.ts");
  });

  it("extracts parent-relative paths", () => {
    expect(extractPaths("check ../config.json")).toContain("../config.json");
  });

  it("extracts paths under common source directories", () => {
    expect(extractPaths("edit src/utils/helper.ts")).toContain(
      "src/utils/helper.ts",
    );
    expect(extractPaths("the bug is in lib/core.js")).toContain("lib/core.js");
  });

  it("extracts standalone filenames with code extensions", () => {
    expect(extractPaths("update package.json")).toContain("package.json");
    expect(extractPaths("check README.md")).toContain("README.md");
    expect(extractPaths("fix tsconfig.json")).toContain("tsconfig.json");
  });

  it("ignores URLs", () => {
    const paths = extractPaths(
      "fetch from https://api.example.com/data.json ok",
    );
    expect(paths).not.toContain("https://api.example.com/data.json");
    expect(paths).not.toContain("api.example.com/data.json");
  });

  it("handles paths in backticks", () => {
    expect(extractPaths("look at `src/foo.ts` now")).toContain("src/foo.ts");
  });

  it("handles paths in quotes", () => {
    expect(extractPaths('edit "src/bar.ts" please')).toContain("src/bar.ts");
  });

  it("returns empty for messages without paths", () => {
    expect(extractPaths("hello world how are you")).toEqual([]);
  });

  it("deduplicates paths", () => {
    const paths = extractPaths("compare src/foo.ts with src/foo.ts again");
    const count = paths.filter((p) => p === "src/foo.ts").length;
    expect(count).toBe(1);
  });

  it("extracts multiple paths", () => {
    const paths = extractPaths(
      "compare src/a.ts and src/b.ts and lib/c.js",
    );
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain("lib/c.js");
  });

  it("strips trailing punctuation from paths", () => {
    const paths = extractPaths("check `src/foo.ts`)");
    expect(paths).toContain("src/foo.ts");
  });
});

describe("resolveExistingPaths", () => {
  it("finds files that exist in cwd", () => {
    // package.json should exist in the project root
    const cwd = process.cwd();
    const result = resolveExistingPaths(["package.json"], cwd);
    expect(result.length).toBe(1);
    expect(result[0].path).toBe("package.json");
    expect(result[0].type).toBe("file");
    expect(result[0].sizeKB).toBeGreaterThanOrEqual(0);
    expect(result[0].estimatedLines).toBeGreaterThan(0);
  });

  it("finds directories that exist in cwd", () => {
    const cwd = process.cwd();
    const result = resolveExistingPaths(["src"], cwd);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("dir");
  });

  it("skips paths that do not exist", () => {
    const cwd = process.cwd();
    const result = resolveExistingPaths(
      ["nonexistent-file-xyz.ts"],
      cwd,
    );
    expect(result).toEqual([]);
  });

  it("rejects paths outside cwd", () => {
    const cwd = process.cwd();
    const result = resolveExistingPaths(["../../etc/passwd"], cwd);
    expect(result).toEqual([]);
  });

  it("caps results at MAX_PATHS", () => {
    const cwd = process.cwd();
    // Create many valid paths (they all resolve to package.json)
    const many = Array.from({ length: 10 }, () => "package.json");
    const result = resolveExistingPaths(many, cwd);
    // Dedup happens at extraction level, but cap still applies
    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe("extractSearchTerms", () => {
  it("extracts meaningful terms", () => {
    const terms = extractSearchTerms(
      "research authentication patterns for JWT tokens",
    );
    expect(terms).toContain("authentication");
    expect(terms).toContain("patterns");
    expect(terms).toContain("jwt");
    expect(terms).toContain("tokens");
  });

  it("filters stop words", () => {
    const terms = extractSearchTerms(
      "the quick brown fox jumps over the lazy dog",
    );
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("also");
    expect(terms).toContain("quick");
    expect(terms).toContain("brown");
    expect(terms).toContain("fox");
  });

  it("removes code blocks", () => {
    const terms = extractSearchTerms(
      "check this ```const secretVar = 'password'``` function",
    );
    expect(terms).not.toContain("secretvar");
    expect(terms).not.toContain("password");
    expect(terms).toContain("function");
  });

  it("removes URLs", () => {
    const terms = extractSearchTerms(
      "see https://example.com/long/path for details",
    );
    expect(terms).not.toContain("example");
    expect(terms).toContain("details");
  });

  it("returns empty for very short input", () => {
    const terms = extractSearchTerms("hi");
    expect(terms).toEqual([]);
  });

  it("deduplicates terms", () => {
    const terms = extractSearchTerms("react react react component component");
    expect(terms.filter((t) => t === "react").length).toBe(1);
    expect(terms.filter((t) => t === "component").length).toBe(1);
  });

  it("limits output to 10 terms", () => {
    const terms = extractSearchTerms(
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november",
    );
    expect(terms.length).toBeLessThanOrEqual(10);
  });
});

describe("formatContextHint", () => {
  it("formats file paths", () => {
    const analysis: RequestAnalysis = {
      paths: [
        { path: "src/foo.ts", type: "file", sizeKB: 4, estimatedLines: 89 },
      ],
      memories: [],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("src/foo.ts");
    expect(hint).toContain("~89 lines");
    expect(hint).toContain("4KB");
    expect(hint).toContain("[Pre-loaded context:");
  });

  it("formats directories", () => {
    const analysis: RequestAnalysis = {
      paths: [{ path: "src/tools", type: "dir", sizeKB: 0 }],
      memories: [],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("src/tools (dir)");
  });

  it("formats memories with tags", () => {
    const analysis: RequestAnalysis = {
      paths: [],
      memories: [
        {
          id: "abc",
          content: "user prefers TypeScript",
          tags: ["preference"],
          created: "2025-03-01",
        },
      ],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("user prefers TypeScript");
    expect(hint).toContain("[preference]");
  });

  it("formats both paths and memories", () => {
    const analysis: RequestAnalysis = {
      paths: [
        { path: "src/bar.ts", type: "file", sizeKB: 2, estimatedLines: 45 },
      ],
      memories: [
        {
          id: "def",
          content: "project uses vitest",
          tags: ["project"],
          created: "2025-03-01",
        },
      ],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("src/bar.ts");
    expect(hint).toContain("project uses vitest");
  });

  it("truncates long memory content", () => {
    const longContent = "a".repeat(200);
    const analysis: RequestAnalysis = {
      paths: [],
      memories: [
        { id: "xyz", content: longContent, tags: [], created: "2025-03-01" },
      ],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("…");
    expect(hint.length).toBeLessThan(longContent.length + 100);
  });

  it("handles multiple memories", () => {
    const analysis: RequestAnalysis = {
      paths: [],
      memories: [
        {
          id: "m1",
          content: "first memory",
          tags: [],
          created: "2025-03-01",
        },
        {
          id: "m2",
          content: "second memory",
          tags: ["tag"],
          created: "2025-03-01",
        },
      ],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("first memory");
    expect(hint).toContain("second memory");
  });
});
