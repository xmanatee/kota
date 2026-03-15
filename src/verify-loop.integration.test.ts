import { beforeEach, describe, expect, it } from "vitest";
import {
  enableGroup,
  getActiveToolNames,
  getEnabledGroups,
  resetGroups,
} from "./tool-groups.js";
import {
  processToolResults,
  type ToolCallRecord,
  type ToolResultRecord,
  VerifyTracker,
} from "./verify-tracker.js";

/**
 * Cross-module integration tests:
 * 1. verify-tracker × tool-runner result format (processToolResults with realistic data)
 * 2. tool-groups state management (reset between sessions)
 */

describe("verify-tracker × loop integration", () => {
  it("file_edit + shell verify clears tracker through processToolResults", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
    ]);

    // Simulate: agent edits a file
    const editCalls: ToolCallRecord[] = [
      { name: "file_edit", id: "tc1", input: { path: "src/app.ts", old_string: "a", new_string: "b" } },
    ];
    const editResults: ToolResultRecord[] = [
      { tool_use_id: "tc1", content: "Edited src/app.ts" },
    ];
    processToolResults(tracker, editCalls, editResults);
    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/app.ts");

    // Simulate: agent runs npm test
    const verifyCalls: ToolCallRecord[] = [
      { name: "shell", id: "tc2", input: { command: "npm test" } },
    ];
    const verifyResults: ToolResultRecord[] = [
      { tool_use_id: "tc2", content: "All tests passed" },
    ];
    processToolResults(tracker, verifyCalls, verifyResults);
    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });

  it("multi_edit records all edited files", () => {
    const tracker = new VerifyTracker();
    const calls: ToolCallRecord[] = [
      {
        name: "multi_edit",
        id: "tc1",
        input: {
          edits: [
            { file_path: "src/a.ts", old_string: "x", new_string: "y" },
            { file_path: "src/b.ts", old_string: "x", new_string: "y" },
          ],
        },
      },
    ];
    const results: ToolResultRecord[] = [
      { tool_use_id: "tc1", content: "Applied 2 edits" },
    ];
    processToolResults(tracker, calls, results);
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/a.ts");
    expect(tracker.getState()).toContain("src/b.ts");
  });

  it("escalates nudge after 3 unverified turns", () => {
    const tracker = new VerifyTracker([
      { label: "build", command: "npm run build" },
    ]);
    tracker.recordEdit("src/foo.ts");

    // Simulate 3 turns of non-verify tool calls
    for (let i = 0; i < 3; i++) {
      processToolResults(
        tracker,
        [{ name: "file_read", id: `r${i}`, input: { path: "README.md" } }],
        [{ tool_use_id: `r${i}`, content: "contents" }],
      );
    }

    const state = tracker.getState();
    expect(state).toContain("Unverified edits");
    expect(state).toContain("npm run build");
    expect(state).toContain("Consider verifying");
  });

  it("errored tool calls do not register as edits", () => {
    const tracker = new VerifyTracker();
    const calls: ToolCallRecord[] = [
      { name: "file_edit", id: "tc1", input: { path: "src/fail.ts" } },
    ];
    const results: ToolResultRecord[] = [
      { tool_use_id: "tc1", content: "old_string not found", is_error: true },
    ];
    processToolResults(tracker, calls, results);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("delegate execute results track modified files", () => {
    const tracker = new VerifyTracker();
    const calls: ToolCallRecord[] = [
      { name: "delegate", id: "tc1", input: { mode: "execute", task: "refactor" } },
    ];
    const results: ToolResultRecord[] = [
      {
        tool_use_id: "tc1",
        content: [
          "Refactored the module successfully.",
          "",
          "--- Modified files ---",
          "  - src/utils.ts",
          "  - src/helpers.ts",
        ].join("\n"),
      },
    ];
    processToolResults(tracker, calls, results);
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/utils.ts");
    expect(tracker.getState()).toContain("src/helpers.ts");
  });
});

describe("tool-groups state reset on session close", () => {
  beforeEach(() => {
    resetGroups();
  });

  it("resetGroups clears all enabled groups", () => {
    enableGroup("web");
    enableGroup("code");
    expect(getEnabledGroups()).toContain("web");
    expect(getEnabledGroups()).toContain("code");

    resetGroups();
    expect(getEnabledGroups()).toEqual([]);
  });

  it("tool names revert to core-only after reset", () => {
    enableGroup("web");
    expect(getActiveToolNames().has("web_search")).toBe(true);

    resetGroups();
    expect(getActiveToolNames().has("web_search")).toBe(false);
    // Core tools remain
    expect(getActiveToolNames().has("shell")).toBe(true);
    expect(getActiveToolNames().has("file_read")).toBe(true);
  });

  it("groups can be re-enabled after reset", () => {
    enableGroup("code");
    resetGroups();
    expect(getActiveToolNames().has("code_exec")).toBe(false);

    enableGroup("code");
    expect(getActiveToolNames().has("code_exec")).toBe(true);
  });
});
