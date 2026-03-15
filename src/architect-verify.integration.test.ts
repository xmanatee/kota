import { describe, expect, it } from "vitest";
import type { EditorResult } from "./architect.js";
import type { ArchitectStepResult } from "./architect-runner.js";
import { VerifyTracker } from "./verify-tracker.js";

describe("architect × verify-tracker integration", () => {
  it("EditorResult includes modifiedFiles for consumption by ArchitectStepResult", () => {
    const editorResult: EditorResult = {
      text: "Done editing",
      modifiedFiles: ["src/foo.ts", "src/bar.ts"],
    };
    const stepResult: ArchitectStepResult = {
      lastResult: editorResult.text,
      summary: "plan executed",
      modifiedFiles: editorResult.modifiedFiles,
    };
    expect(stepResult.modifiedFiles).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("VerifyTracker records architect modified files and produces nudge", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
    ]);
    const architectResult: ArchitectStepResult = {
      lastResult: "refactored utils",
      summary: "plan executed",
      modifiedFiles: ["src/utils.ts", "src/helpers.ts"],
    };
    for (const f of architectResult.modifiedFiles) tracker.recordEdit(f);

    expect(tracker.getUnverifiedCount()).toBe(2);
    const state = tracker.getState();
    expect(state).toContain("src/utils.ts");
    expect(state).toContain("src/helpers.ts");
    expect(state).toContain("npm test");
  });

  it("verification clears architect-originated edits", () => {
    const tracker = new VerifyTracker([]);
    for (const f of ["a.ts", "b.ts"]) tracker.recordEdit(f);
    expect(tracker.getUnverifiedCount()).toBe(2);

    tracker.checkShellCommand("npm test");
    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });

  it("escalation triggers after 3 turns of unverified architect edits", () => {
    const tracker = new VerifyTracker([]);
    tracker.recordEdit("src/refactored.ts");

    // Simulate 3 turns without verification
    tracker.tick();
    tracker.tick();
    tracker.tick();

    const state = tracker.getState();
    expect(state).toContain("Consider verifying");
  });

  it("empty modifiedFiles produces no nudge", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
    ]);
    const architectResult: ArchitectStepResult = {
      lastResult: "no changes needed",
      summary: "plan: nothing to do",
      modifiedFiles: [],
    };
    for (const f of architectResult.modifiedFiles) tracker.recordEdit(f);
    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });
});
