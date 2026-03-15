/**
 * Cross-module tests for the shell error pipeline.
 *
 * When a shell command fails, the output flows through:
 *   smartErrorTruncate (shell-diagnostics) → enrichWithSourceContext (error-context)
 *
 * These tests verify the composition: file:line references must survive
 * truncation so enrichment can find and annotate them with source code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { smartErrorTruncate } from "./shell-diagnostics.js";
import {
  enrichWithSourceContext,
  extractFileReferences,
} from "./error-context.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), `kota-pipeline-${process.pid}`);
const SRC = join(TMP, "src");
const FILE_A = join(SRC, "example.ts");

const SOURCE_CONTENT = [
  'import { readFile } from "node:fs";',
  "",
  "function processData(input: string): number {",
  "  const result = parseInt(input);",
  "  return result;",
  "}",
  "",
  "export const value = processData(42);", // line 8
  "",
  "console.log(value);",
].join("\n");

beforeAll(() => {
  mkdirSync(SRC, { recursive: true });
  writeFileSync(FILE_A, SOURCE_CONTENT);
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Generate padding lines to push output above truncation thresholds. */
function padding(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `    at internal (node:internal/modules/run_main:${i}:12)`,
  ).join("\n");
}

describe("shell error pipeline (cross-module: shell-diagnostics → error-context)", () => {
  describe("file:line references survive smartErrorTruncate", () => {
    it("preserves TS paren-style refs in short output", () => {
      const output = `${FILE_A}(8,38): error TS2345: Argument of type 'number' is not assignable.`;

      const truncated = smartErrorTruncate(output);
      const refs = extractFileReferences(truncated);

      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0]).toEqual({ path: FILE_A, line: 8 });
    });

    it("preserves TS refs when output is padded with noise", () => {
      const tsError = `${FILE_A}(8,38): error TS2345: Argument of type 'number' is not assignable.`;
      const output = tsError + "\n" + padding(800);

      const truncated = smartErrorTruncate(output);
      const refs = extractFileReferences(truncated);

      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0].path).toBe(FILE_A);
    });

    it("preserves Node.js stack trace refs", () => {
      const output = [
        "Error: Connection refused",
        `    at connect (${FILE_A}:4:15)`,
        "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      ].join("\n");

      const truncated = smartErrorTruncate(output);
      const refs = extractFileReferences(truncated);

      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0]).toEqual({ path: FILE_A, line: 4 });
    });
  });

  describe("full pipeline: smartErrorTruncate → enrichWithSourceContext", () => {
    it("enriches TS error with source context from real file", () => {
      const output = `${FILE_A}(8,38): error TS2345: Argument of type 'number' is not assignable.`;

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).toContain("error TS2345");
      expect(enriched).toContain("--- Referenced source ---");
      expect(enriched).toContain("processData(42)");
    });

    it("enriches long output after truncation", () => {
      const tsError = `${FILE_A}(8,38): error TS2345: Argument of type 'number'.`;
      const output = tsError + "\n" + padding(800);

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).toContain("error TS2345");
      expect(enriched).toContain("--- Referenced source ---");
      expect(enriched).toContain("processData(42)");
    });

    it("passes non-diagnostic output through without enrichment", () => {
      const output =
        "npm WARN deprecated some-package@1.0.0: no longer maintained\nfinished in 3.2s";

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).not.toContain("--- Referenced source ---");
      expect(enriched).toContain("npm WARN");
    });
  });

  describe("multi-file and multi-format references", () => {
    const FILE_B = join(SRC, "helper.ts");

    beforeAll(() => {
      writeFileSync(
        FILE_B,
        [
          "export function add(a: number, b: number) {",
          "  return a + b;",
          "}",
        ].join("\n"),
      );
    });

    it("enriches errors referencing two different files", () => {
      const output = [
        `${FILE_A}(3,10): error TS2345: Argument of type 'string'.`,
        `${FILE_B}(1,17): error TS2304: Cannot find name 'number'.`,
      ].join("\n");

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      // Both files should be referenced in enrichment
      expect(enriched).toContain("--- Referenced source ---");
      expect(enriched).toContain("example.ts:3");
      expect(enriched).toContain("helper.ts:1");
      expect(enriched).toContain("processData"); // line 3 of example.ts
      expect(enriched).toContain("add"); // line 1 of helper.ts
    });

    it("handles Python traceback format through pipeline", () => {
      // Python pattern only matches .py files
      const pyFile = join(SRC, "helper.py");
      writeFileSync(pyFile, "def greet(name):\n    return f'Hello {name}'\n\ngreet(42)\n");

      const output = [
        "Traceback (most recent call last):",
        `  File "${pyFile}", line 4, in <module>`,
        "    greet(42)",
        "TypeError: expected str, got int",
      ].join("\n");

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).toContain("--- Referenced source ---");
      const refs = extractFileReferences(enriched);
      expect(refs.some((r) => r.path === pyFile && r.line === 4)).toBe(true);
    });

    it("handles ESLint-style colon-separated errors through pipeline", () => {
      const output = `${FILE_A}:8:20: error no-unused-vars: 'value' is defined but never used`;

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).toContain("--- Referenced source ---");
      expect(enriched).toContain("processData(42)"); // line 8
    });

    it("deduplicates nearby refs — two errors on adjacent lines yield one context block", () => {
      const output = [
        `${FILE_A}(4,5): error TS2345: First error.`,
        `${FILE_A}(5,5): error TS2322: Second error.`,
      ].join("\n");

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).toContain("--- Referenced source ---");
      // Should only have one context block for FILE_A (dedup within 10 lines)
      const contextBlocks = enriched.split("--- Referenced source ---")[1];
      const fileHeaders = contextBlocks
        .split("\n")
        .filter((l) => l.includes("example.ts:"));
      expect(fileHeaders).toHaveLength(1);
    });

    it("handles mixed TS errors + stack trace in long output", () => {
      const errors = [
        `${FILE_A}(8,38): error TS2345: Argument of type 'number'.`,
        padding(500),
        `Error: Runtime failure`,
        `    at handler (${FILE_B}:2:10)`,
      ].join("\n");

      const truncated = smartErrorTruncate(errors);
      const enriched = enrichWithSourceContext(truncated);

      expect(enriched).toContain("--- Referenced source ---");
      // TS error extracted by extractTscErrors should preserve FILE_A ref
      const refs = extractFileReferences(enriched);
      expect(refs.some((r) => r.path === FILE_A)).toBe(true);
    });

    it("preserves lint refs in long output through extractLintErrors", () => {
      const lintLines = Array.from(
        { length: 30 },
        (_, i) => `${FILE_A}:${i + 1}:1: error no-console: Unexpected console statement`,
      );
      const output = lintLines.join("\n") + "\n" + padding(500);

      const truncated = smartErrorTruncate(output);
      const enriched = enrichWithSourceContext(truncated);

      // extractLintErrors should fire, refs should survive
      expect(enriched).toContain("Lint issues");
      expect(enriched).toContain("--- Referenced source ---");
    });
  });
});
