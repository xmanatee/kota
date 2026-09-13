import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import { getDefaultConfig } from "#core/tools/guardrails.js";
import {
  analyzeRequest,
  extractPaths,
  extractSearchTerms,
  formatContextHint,
  type RequestAnalysis,
  type RequestPathContext,
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

  it("extracts standalone filenames with code modules", () => {
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

describe("request metadata boundary", () => {
  let root: string;
  let context: RequestPathContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "request-boundary-"));
    const scopeRoot = join(root, "scope");
    mkdirSync(scopeRoot);
    mkdirSync(join(root, "scope-sibling"));
    mkdirSync(join(scopeRoot, "src"));
    writeFileSync(join(scopeRoot, "src", "allowed.ts"), "a".repeat(2048));
    writeFileSync(join(root, "scope-sibling", "outside.ts"), "x".repeat(2048));
    symlinkSync(join(root, "scope-sibling"), join(scopeRoot, "escape"));
    symlinkSync(join(scopeRoot, "src"), join(scopeRoot, "alias"));
    context = { scopeRoot, guardrailsConfig: getDefaultConfig() };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("retains authorized file, directory, and internal symlink hints", () => {
    expect(resolveExistingPaths(["src/allowed.ts", "src", "alias/allowed.ts"], context))
      .toEqual([
        { path: "src/allowed.ts", type: "file", sizeKB: 2, estimatedLines: 46 },
        { path: "src", type: "dir", sizeKB: expect.any(Number) },
        { path: "alias/allowed.ts", type: "file", sizeKB: 2, estimatedLines: 46 },
      ]);
    symlinkSync(context.scopeRoot, join(root, "scope-alias"));
    expect(resolveExistingPaths(["src/allowed.ts"], { ...context, scopeRoot: join(root, "scope-alias") }))
      .toHaveLength(1);
  });

  it("omits sibling-prefix and symlink escapes from automatically formatted context", () => {
    const analysis = analyzeRequest(
      "Please inspect ../scope-sibling/outside.ts ./escape/outside.ts and ./src/allowed.ts",
      context,
      new ProviderRegistry(),
    );
    expect(analysis?.paths).toEqual([
      { path: "./src/allowed.ts", type: "file", sizeKB: 2, estimatedLines: 46 },
    ]);
    const hint = formatContextHint(analysis!);
    expect(hint).toContain("./src/allowed.ts (~46 lines, 2KB)");
    expect(hint).not.toContain("outside.ts");
    expect(resolveExistingPaths([
      join(root, "scope-sibling", "outside.ts"),
      join(context.scopeRoot, "..", "scope-sibling", "outside.ts"),
      "./escape",
    ], context)).toEqual([]);
  });

  it("omits protected paths and their in-scope aliases", () => {
    mkdirSync(join(context.scopeRoot, ".kota"));
    writeFileSync(join(context.scopeRoot, ".kota", "secrets.json"), "synthetic");
    symlinkSync(join(context.scopeRoot, ".kota", "secrets.json"), join(context.scopeRoot, "alias.json"));
    expect(resolveExistingPaths([".kota/secrets.json", "alias.json"], context)).toEqual([]);
  });

  it.each(["deny", "confirm", "queue"] as const)("does not preload reads requiring %s", (policy) => {
    context.guardrailsConfig.toolOverrides = { file_read: policy };
    expect(resolveExistingPaths(["src/allowed.ts"], context)).toEqual([]);
    context.guardrailsConfig = { policies: { safe: policy, moderate: "allow", dangerous: "confirm" } };
    expect(resolveExistingPaths(["src/allowed.ts"], context)).toEqual([]);
  });

  it("skips missing and broken links and caps authorized results", () => {
    symlinkSync(join(root, "missing"), join(context.scopeRoot, "broken"));
    expect(resolveExistingPaths(["missing.ts", "broken"], context)).toEqual([]);
    expect(resolveExistingPaths(Array.from({ length: 10 }, () => "src/allowed.ts"), context)).toHaveLength(5);
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
      conversations: [],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("src/foo.ts");
    expect(hint).toContain("~89 lines");
    expect(hint).toContain("4KB");
    expect(hint).toContain("[Pre-loaded context:");
  });

  it("formats directories", () => {
    const analysis: RequestAnalysis = {
      paths: [{ path: "src/core/tools", type: "dir", sizeKB: 0 }],
      memories: [],
      conversations: [],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("src/core/tools (dir)");
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
      conversations: [],
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
      conversations: [],
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
      conversations: [],
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
      conversations: [],
    };
    const hint = formatContextHint(analysis);
    expect(hint).toContain("first memory");
    expect(hint).toContain("second memory");
  });
});
