import { describe, expect, it } from "vitest";
import {
  smartErrorTruncate,
  extractTscErrors,
  extractTestFailures,
  extractLintErrors,
  extractGenericErrors,
} from "./shell-diagnostics.js";

// Helper: pad output to exceed the 8K threshold
function pad(core: string, size = 9000): string {
  const filler = "info: building module X... ok\n".repeat(Math.ceil(size / 30));
  return filler.slice(0, size - core.length) + core;
}

describe("smartErrorTruncate", () => {
  it("returns short output unchanged", () => {
    const short = "error: something broke\nexit 1";
    expect(smartErrorTruncate(short)).toBe(short);
  });

  it("extracts tsc errors from long output", () => {
    const errors =
      'src/foo.ts(12,5): error TS2322: Type "string" not assignable to "number".\n' +
      "src/bar.ts(7,1): error TS1005: ')' expected.\n";
    const output = pad(errors);
    const result = smartErrorTruncate(output);
    expect(result).toContain("TypeScript errors (2)");
    expect(result).toContain("TS2322");
    expect(result).toContain("TS1005");
    expect(result).toContain("[Extracted 2 diagnostic(s)");
  });

  it("falls back to head+tail for unrecognized long output", () => {
    const output = "x".repeat(25_000);
    const result = smartErrorTruncate(output);
    expect(result).toContain("chars omitted");
    expect(result.length).toBeLessThan(output.length);
  });

  it("returns unrecognized output as-is when under limit", () => {
    const output = "x".repeat(15_000);
    const result = smartErrorTruncate(output, 20_000);
    expect(result).toBe(output);
  });
});

describe("extractTscErrors", () => {
  it("extracts parenthesized format", () => {
    const output =
      'src/a.ts(1,1): error TS2322: Type mismatch\nsrc/b.ts(5,3): error TS2304: Cannot find name "x"';
    const result = extractTscErrors(output);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.text).toContain("TS2322");
    expect(result!.text).toContain("TS2304");
  });

  it("extracts colon format", () => {
    const output = "src/a.ts:1:1 - error TS2322: Type mismatch";
    const result = extractTscErrors(output);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
  });

  it("deduplicates identical errors", () => {
    const line = "src/a.ts(1,1): error TS2322: Dupe\n";
    const output = line + line + line;
    const result = extractTscErrors(output);
    expect(result!.count).toBe(1);
  });

  it("returns null for non-tsc output", () => {
    expect(extractTscErrors("all good\nno errors")).toBeNull();
  });
});

describe("extractTestFailures", () => {
  it("extracts vitest-style failures", () => {
    const output =
      " ✓ src/a.test.ts (5 tests)\n" +
      " × src/b.test.ts > should work\n" +
      "   AssertionError: expected 1 to be 2\n" +
      "     - Expected: 2\n" +
      "     + Received: 1\n" +
      "\n" +
      " Tests: 1 failed | 5 passed\n";
    const result = extractTestFailures(output);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Test failures");
    expect(result!.text).toContain("×");
    expect(result!.text).toContain("1 failed");
  });

  it("extracts jest-style failures", () => {
    const output =
      "PASS src/a.test.js\n" +
      "FAIL src/b.test.js\n" +
      "  ● MyClass > should handle edge case\n" +
      "    Expected: 42\n" +
      "    Received: 43\n" +
      "\n" +
      "Tests: 1 failed, 5 passed\n";
    const result = extractTestFailures(output);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("FAIL");
    expect(result!.text).toContain("●");
  });

  it("captures summary lines", () => {
    const output =
      "lots of output\n" +
      " ✗ broken test\n" +
      "   Error: oops\n" +
      "\n" +
      "Test Files  1 failed | 9 passed\n" +
      "Tests  2 failed | 48 passed\n";
    const result = extractTestFailures(output);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("2 failed | 48 passed");
  });

  it("returns null for non-test output", () => {
    expect(extractTestFailures("building... done\nall good")).toBeNull();
  });
});

describe("extractLintErrors", () => {
  it("extracts eslint-style errors", () => {
    const output = "src/a.ts:5:10: error no-unused-vars: 'x' is declared but never used";
    const result = extractLintErrors(output);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.text).toContain("no-unused-vars");
  });

  it("extracts biome markers", () => {
    const output = "  × lint/noUnusedVariables: variable is not used\n  × lint/noExplicitAny: avoid";
    const result = extractLintErrors(output);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
  });

  it("prefers errors over warnings", () => {
    const output =
      "a.ts:1:1: warning prefer-const: use const\n" + "b.ts:2:2: error no-undef: 'x' not defined";
    const result = extractLintErrors(output);
    expect(result).not.toBeNull();
    // Should show error, not warning
    expect(result!.text).toContain("no-undef");
  });

  it("returns null for clean output", () => {
    expect(extractLintErrors("All files pass")).toBeNull();
  });
});

describe("extractGenericErrors", () => {
  it("extracts Error: lines with context", () => {
    const lines = ["line 1", "line 2", "Error: something broke", "  at foo.ts:5", "line 5"];
    const output = lines.join("\n");
    const result = extractGenericErrors(output);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.text).toContain("Error: something broke");
    expect(result!.text).toContain("line 2"); // context before
    expect(result!.text).toContain("at foo.ts:5"); // context after
  });

  it("extracts multiple error regions", () => {
    const output = [
      "info: step 1",
      "Error: first problem",
      "detail 1",
      "info: step 2",
      "info: step 3",
      "info: step 4",
      "Error: second problem",
      "detail 2",
    ].join("\n");
    const result = extractGenericErrors(output);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.text).toContain("first problem");
    expect(result!.text).toContain("second problem");
  });

  it("matches command not found", () => {
    const result = extractGenericErrors("sh: foo: command not found");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("command not found");
  });

  it("matches Permission denied", () => {
    const result = extractGenericErrors("bash: /usr/bin/x: Permission denied");
    expect(result).not.toBeNull();
  });

  it("matches FAILED", () => {
    const result = extractGenericErrors("Build step FAILED");
    expect(result).not.toBeNull();
  });

  it("returns null when no errors found", () => {
    expect(extractGenericErrors("all good\ndone\nfinished")).toBeNull();
  });
});
