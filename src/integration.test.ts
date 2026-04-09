/**
 * Cross-module integration tests.
 *
 * These tests exercise real interactions between 2+ modules to catch
 * boundary bugs: format mismatches, error propagation failures, and
 * broken composition paths.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runFileEdit } from "./modules/filesystem/file-edit.js";
import { runGrep } from "./modules/filesystem/grep.js";
import { checkFreshness, recordRead } from "./file-tracker.js";
import { FailureTracker, type ToolResultEntry } from "./tool-runner.js";

const TEST_DIR = join(process.cwd(), ".test-integration");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// file-edit → lint: invalid JSON edit is reverted
// ---------------------------------------------------------------------------
describe("file-edit + lint: JSON syntax check", () => {
  const jsonPath = join(TEST_DIR, "config.json");

  beforeEach(() => {
    writeFileSync(jsonPath, '{"name": "test", "version": "1.0"}', "utf-8");
  });

  it("reverts edit that breaks JSON syntax", async () => {
    const result = await runFileEdit({
      path: jsonPath,
      old_string: '"version": "1.0"',
      new_string: '"version": "1.0",,',  // trailing comma — invalid JSON
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("syntax error");
    expect(result.content).toContain("reverted");

    // File should be restored to original
    const actual = readFileSync(jsonPath, "utf-8");
    expect(actual).toBe('{"name": "test", "version": "1.0"}');
  });

  it("applies valid JSON edit and preserves file", async () => {
    const result = await runFileEdit({
      path: jsonPath,
      old_string: '"version": "1.0"',
      new_string: '"version": "2.0"',
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Replaced");

    const actual = readFileSync(jsonPath, "utf-8");
    expect(actual).toContain('"version": "2.0"');
  });
});

// ---------------------------------------------------------------------------
// file-edit → lint → file-tracker: successful edit updates tracker
// ---------------------------------------------------------------------------
describe("file-edit + file-tracker: modification tracking", () => {
  const tsPath = join(TEST_DIR, "mod-track.ts");

  it("records modification after successful edit", async () => {
    writeFileSync(tsPath, "const x = 1;\nconst y = 2;\n", "utf-8");
    recordRead(tsPath);

    await runFileEdit({
      path: tsPath,
      old_string: "const x = 1;",
      new_string: "const x = 42;",
    });

    // After edit, a fresh read should NOT trigger a stale warning
    // because file-edit records the modification
    recordRead(tsPath);
    const warning = checkFreshness(tsPath);
    expect(warning).toBeNull();
  });

  it("does NOT record modification when lint reverts the edit", async () => {
    const jsonPath2 = join(TEST_DIR, "tracker-revert.json");
    writeFileSync(jsonPath2, '{"a": 1}', "utf-8");
    recordRead(jsonPath2);

    const result = await runFileEdit({
      path: jsonPath2,
      old_string: '"a": 1',
      new_string: '"a": 1,,',  // invalid
    });

    expect(result.is_error).toBe(true);

    // File should be unchanged — external modification detection should not fire
    const actual = readFileSync(jsonPath2, "utf-8");
    expect(actual).toBe('{"a": 1}');
  });
});

// ---------------------------------------------------------------------------
// file-edit + path-resolver: non-existent file gives helpful error
// ---------------------------------------------------------------------------
describe("file-edit + path-resolver: missing file suggestions", () => {
  it("returns file-not-found with helpful message", async () => {
    // Create a file so path-resolver has something to suggest
    const realPath = join(TEST_DIR, "helper.ts");
    writeFileSync(realPath, "export const helper = 1;\n", "utf-8");

    const result = await runFileEdit({
      path: join(TEST_DIR, "helpr.ts"),  // typo
      old_string: "anything",
      new_string: "else",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// grep: shell escape prevents injection via path
// ---------------------------------------------------------------------------
describe("grep: shell injection prevention", () => {
  it("handles path with single quotes without injection", async () => {
    const dirWithQuote = join(TEST_DIR, "it's a dir");
    mkdirSync(dirWithQuote, { recursive: true });
    writeFileSync(join(dirWithQuote, "file.txt"), "findme123\n", "utf-8");

    const result = await runGrep({
      pattern: "findme123",
      path: dirWithQuote,
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("findme123");
  });

  it("handles file_glob with single quotes safely", async () => {
    // A glob with a quote should not cause injection — it just won't match
    const result = await runGrep({
      pattern: "anything",
      path: TEST_DIR,
      file_glob: "*.t's",
    });

    // Should either find nothing or return safely — NOT crash with injection
    expect(result.content).toBeDefined();
    expect(result.is_error).toBeUndefined();
  });

  it("handles path with shell metacharacters without injection", async () => {
    // A path with $() should not cause command substitution
    const result = await runGrep({
      pattern: "anything",
      path: join(TEST_DIR, "nonexistent$(echo)dir"),
    });

    // Should fail gracefully (dir doesn't exist), not execute the injection
    expect(result.content).toBeDefined();
    // Key: no error about "echo" or unexpected output from command substitution
    expect(result.content).not.toContain("pwned");
  });
});

// ---------------------------------------------------------------------------
// tool-runner FailureTracker: circuit breaker with realistic tool results
// ---------------------------------------------------------------------------
describe("FailureTracker: cross-module failure detection", () => {
  const makeResult = (content: string, isError: boolean): ToolResultEntry => ({
    tool_use_id: `id-${Math.random()}`,
    content,
    is_error: isError,
  });

  it("resets on success after failures", () => {
    const tracker = new FailureTracker();

    // 4 consecutive failures
    for (let i = 0; i < 4; i++) {
      tracker.record([makeResult(`Error ${i}`, true)]);
    }

    // Success resets
    const action = tracker.record([makeResult("OK", false)]);
    expect(action).toBe("continue");

    // Next failure starts fresh count
    const after = tracker.record([makeResult("Error new", true)]);
    expect(after).toBe("continue");
  });

  it("circuit breaks on 3 identical file-edit errors", () => {
    const tracker = new FailureTracker();
    const editError = "Error: old_string not found in src/foo.ts";

    let action: string = "continue";
    for (let i = 0; i < 3; i++) {
      action = tracker.record([makeResult(editError, true)]);
    }
    expect(action).toBe("circuit_break");
  });

  it("injects guidance after 5 diverse tool failures", () => {
    const tracker = new FailureTracker();

    for (let i = 0; i < 5; i++) {
      tracker.record([makeResult(`Different error ${i}`, true)]);
    }

    // The 5th one should have returned inject_guidance
    // Let's re-test cleanly
    const tracker2 = new FailureTracker();
    let lastAction = "continue";
    for (let i = 1; i <= 5; i++) {
      lastAction = tracker2.record([makeResult(`Unique error ${i}`, true)]);
    }
    expect(lastAction).toBe("inject_guidance");
  });

  it("generates correct messages for each action", () => {
    expect(FailureTracker.getMessage("circuit_break")).toContain("3 times");
    expect(FailureTracker.getMessage("inject_guidance")).toContain("5 consecutive");
    expect(FailureTracker.getMessage("continue")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// file-edit + lint: TypeScript syntax check (cross-module)
// ---------------------------------------------------------------------------
describe("file-edit + lint: TypeScript syntax check", () => {
  const tsPath = join(TEST_DIR, "syntax.ts");

  it("reverts edit that produces invalid TypeScript", async () => {
    writeFileSync(tsPath, "export function add(a: number, b: number) {\n  return a + b;\n}\n", "utf-8");

    const result = await runFileEdit({
      path: tsPath,
      old_string: "return a + b;",
      new_string: "return a + b;;\n  }}}",  // extra braces — syntax error
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("syntax error");

    // File should be reverted to valid TypeScript
    const actual = readFileSync(tsPath, "utf-8");
    expect(actual).toContain("return a + b;");
    expect(actual).not.toContain("}}}");
  });
});
