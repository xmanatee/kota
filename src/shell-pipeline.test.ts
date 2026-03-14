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
});
