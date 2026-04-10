/**
 * Cross-module integration tests: delegate-format × verify-tracker
 *
 * Tests the format contract between assembleDelegateResult (delegate-format)
 * and processToolResults (verify-tracker). The verify-tracker parses delegate
 * result strings to extract modified files — if the format changes in either
 * module, these tests catch the mismatch.
 *
 * Also tests find_replace → verify-tracker, which was previously untested.
 */
import { describe, expect, it } from "vitest";
import {
  assembleDelegateResult,
  type DelegateMetadata,
} from "./core/tools/delegate-format.js";
import {
  processToolResults,
  type ToolCallRecord,
  type ToolResultRecord,
  VerifyTracker,
} from "./verify-tracker.js";

function makeMeta(overrides: Partial<DelegateMetadata> = {}): DelegateMetadata {
  return {
    mode: "execute",
    turnsUsed: 3,
    turnsMax: 15,
    toolsUsed: ["file_edit", "shell"],
    completionReason: "done",
    urlsFetched: [],
    searchQueries: [],
    ...overrides,
  };
}

function delegateResult(
  content: string,
): { calls: ToolCallRecord[]; results: ToolResultRecord[] } {
  return {
    calls: [{ name: "delegate", id: "d1", input: { mode: "execute", task: "fix bug" } }],
    results: [{ tool_use_id: "d1", content }],
  };
}

describe("delegate-format × verify-tracker (cross-module format contract)", () => {
  it("assembleDelegateResult modified files are parsed by processToolResults", () => {
    const files = new Set(["src/api.ts", "src/utils.ts", "tests/api.test.ts"]);
    const result = assembleDelegateResult("Fixed the API handler.", makeMeta(), files, []);

    const tracker = new VerifyTracker();
    const { calls, results } = delegateResult(result.content);
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(3);
    expect(tracker.getState()).toContain("src/api.ts");
    expect(tracker.getState()).toContain("src/utils.ts");
    expect(tracker.getState()).toContain("tests/api.test.ts");
  });

  it("no modified files → verify-tracker stays empty", () => {
    const result = assembleDelegateResult("Explored the codebase.", makeMeta({ mode: "explore" }), new Set(), []);

    const tracker = new VerifyTracker();
    const { calls, results } = delegateResult(result.content);
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });

  it("circuit_break completion still tracks modified files", () => {
    const files = new Set(["src/broken.ts"]);
    const result = assembleDelegateResult("Partial fix applied.", makeMeta({ completionReason: "circuit_break" }), files, []);

    const tracker = new VerifyTracker();
    const { calls, results } = delegateResult(result.content);
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/broken.ts");
  });

  it("context_overflow completion still tracks modified files", () => {
    const files = new Set(["src/large.ts", "src/config.ts"]);
    const result = assembleDelegateResult("Ran out of context.", makeMeta({ completionReason: "context_overflow" }), files, []);

    const tracker = new VerifyTracker();
    const { calls, results } = delegateResult(result.content);
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(2);
  });

  it("file paths with spaces and special chars are tracked", () => {
    const files = new Set(["src/my component.tsx", "src/utils (v2).ts"]);
    const result = assembleDelegateResult("Done.", makeMeta(), files, []);

    const tracker = new VerifyTracker();
    const { calls, results } = delegateResult(result.content);
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/my component.tsx");
    expect(tracker.getState()).toContain("src/utils (v2).ts");
  });
});

describe("find_replace × verify-tracker (cross-module)", () => {
  it("find_replace result with replacements is tracked", () => {
    const tracker = new VerifyTracker();
    const calls: ToolCallRecord[] = [
      { name: "find_replace", id: "fr1", input: { pattern: "oldName", replacement: "newName", glob: "**/*.ts" } },
    ];
    const results: ToolResultRecord[] = [
      {
        tool_use_id: "fr1",
        content: [
          "Replaced 5 matches across 2 files:",
          "  src/api.ts: 3 replacements",
          "  src/helpers.ts: 2 replacements",
        ].join("\n"),
      },
    ];
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/api.ts");
    expect(tracker.getState()).toContain("src/helpers.ts");
  });

  it("find_replace with no matches does not track", () => {
    const tracker = new VerifyTracker();
    const calls: ToolCallRecord[] = [
      { name: "find_replace", id: "fr1", input: { pattern: "nonexistent", replacement: "x" } },
    ];
    const results: ToolResultRecord[] = [
      { tool_use_id: "fr1", content: "No matches found for pattern: nonexistent" },
    ];
    processToolResults(tracker, calls, results);

    expect(tracker.getUnverifiedCount()).toBe(0);
  });
});

describe("mixed delegate + direct edits + verify (full scenario)", () => {
  it("delegate edits + direct file_edit + shell verify clears all", () => {
    const tracker = new VerifyTracker([{ label: "test", command: "npm test" }]);

    // Step 1: delegate makes edits
    const files = new Set(["src/delegated.ts"]);
    const delegateOutput = assembleDelegateResult("Fixed via delegation.", makeMeta(), files, []);
    processToolResults(
      tracker,
      [{ name: "delegate", id: "d1", input: { mode: "execute", task: "fix" } }],
      [{ tool_use_id: "d1", content: delegateOutput.content }],
    );
    expect(tracker.getUnverifiedCount()).toBe(1);

    // Step 2: direct file_edit in main loop
    processToolResults(
      tracker,
      [{ name: "file_edit", id: "e1", input: { path: "src/direct.ts" } }],
      [{ tool_use_id: "e1", content: "Edited src/direct.ts" }],
    );
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/delegated.ts");
    expect(tracker.getState()).toContain("src/direct.ts");

    // Step 3: shell verification clears all
    processToolResults(
      tracker,
      [{ name: "shell", id: "s1", input: { command: "npm test" } }],
      [{ tool_use_id: "s1", content: "All tests passed" }],
    );
    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });
});
