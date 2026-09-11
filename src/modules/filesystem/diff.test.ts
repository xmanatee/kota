import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { printEditDiff, printWriteSummary } from "./diff.js";

let output: string;
beforeEach(() => {
  output = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { output += String(chunk); return true; });
});
afterEach(() => { vi.restoreAllMocks(); });

it.each([
  ["first", "FIRST", "@@ -1,1 +1,1 @@", " second"],
  ["second\nthird", "TWO\nTHREE\nFOUR", "@@ -2,2 +2,3 @@", " first"],
  ["third", "LAST", "@@ -3,1 +3,1 @@", " second"],
])("renders positioned diff for %s", (oldText, newText, header, context) => {
  printEditDiff("source.ts", "first\nsecond\nthird", oldText, newText);
  expect(output).toContain("--- a/source.ts");
  expect(output).toContain(header);
  expect(output).toContain(context);
  for (const line of oldText.split("\n")) expect(output).toContain(`-${line}`);
  for (const line of newText.split("\n")) expect(output).toContain(`+${line}`);
});

it("summarizes large replacements and whole-file writes", () => {
  const oldText = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
  printEditDiff("large.ts", oldText, oldText, oldText.toUpperCase());
  expect(output).toContain("large.ts:1 — replaced 25 lines with 25 lines");
  expect(output).not.toContain("---");
  output = "";
  printWriteSummary("written.ts", 5, 3);
  expect(output).toContain("written.ts: 5 → 3 lines");
});
