import { describe, expect, it } from "vitest";
import { detectVerifyCommands, isVerifyCommand, processToolResults, VerifyTracker } from "./verify-tracker.js";

describe("VerifyTracker", () => {
  it("starts with empty state", () => {
    const tracker = new VerifyTracker();
    expect(tracker.getState()).toBe("");
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("tracks edited files", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/foo.ts");
  });

  it("tracks multiple edited files", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/bar.ts");
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/foo.ts");
    expect(tracker.getState()).toContain("src/bar.ts");
  });

  it("deduplicates same file edited multiple times", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/foo.ts");
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("ignores empty paths", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("");
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("clears on verification shell command", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/bar.ts");
    tracker.checkShellCommand("npm test");
    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });

  it("does not clear on non-verify shell commands", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.checkShellCommand("git status");
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("shows available verify commands when provided", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
      { label: "typecheck", command: "npm run typecheck" },
    ]);
    tracker.recordEdit("src/foo.ts");
    const state = tracker.getState();
    expect(state).toContain("`npm test`");
    expect(state).toContain("`npm run typecheck`");
  });

  it("limits displayed commands to 3", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
      { label: "typecheck", command: "npm run typecheck" },
      { label: "lint", command: "npm run lint" },
      { label: "build", command: "npm run build" },
    ]);
    tracker.recordEdit("src/foo.ts");
    const state = tracker.getState();
    expect(state).not.toContain("`npm run build`");
  });

  it("shows nudge after 3 ticks without verification", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.tick();
    tracker.tick();
    expect(tracker.getState()).not.toContain("Consider verifying");
    tracker.tick();
    expect(tracker.getState()).toContain("Consider verifying");
  });

  it("does not tick when no edits are pending", () => {
    const tracker = new VerifyTracker();
    tracker.tick();
    tracker.tick();
    tracker.tick();
    // No edits, so no nudge even after many ticks
    expect(tracker.getState()).toBe("");
  });

  it("resets turn counter on verification", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.tick();
    tracker.tick();
    tracker.tick();
    expect(tracker.getState()).toContain("Consider verifying");
    tracker.checkShellCommand("npm test");
    expect(tracker.getState()).toBe("");
    // New edit should not immediately nudge
    tracker.recordEdit("src/bar.ts");
    tracker.tick();
    expect(tracker.getState()).not.toContain("Consider verifying");
  });

  it("limits displayed files to 10 and shows total count", () => {
    const tracker = new VerifyTracker();
    for (let i = 0; i < 15; i++) {
      tracker.recordEdit(`src/file-${i}.ts`);
    }
    expect(tracker.getUnverifiedCount()).toBe(15);
    const state = tracker.getState();
    const matches = state.match(/src\/file-/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeLessThanOrEqual(10);
    expect(state).toContain("(15 total)");
  });

  it("does not show total count when 10 or fewer files", () => {
    const tracker = new VerifyTracker();
    for (let i = 0; i < 10; i++) {
      tracker.recordEdit(`src/file-${i}.ts`);
    }
    const state = tracker.getState();
    expect(state).not.toContain("total");
  });
});

describe("isVerifyCommand", () => {
  it("recognizes npm commands", () => {
    expect(isVerifyCommand("npm test")).toBe(true);
    expect(isVerifyCommand("npm run typecheck")).toBe(true);
    expect(isVerifyCommand("npm run lint")).toBe(true);
    expect(isVerifyCommand("npm run build")).toBe(true);
    expect(isVerifyCommand("npm run check")).toBe(true);
  });

  it("recognizes pnpm commands", () => {
    expect(isVerifyCommand("pnpm test")).toBe(true);
    expect(isVerifyCommand("pnpm run typecheck")).toBe(true);
    expect(isVerifyCommand("pnpm lint")).toBe(true);
  });

  it("recognizes yarn commands", () => {
    expect(isVerifyCommand("yarn test")).toBe(true);
    expect(isVerifyCommand("yarn run lint")).toBe(true);
  });

  it("recognizes cargo commands", () => {
    expect(isVerifyCommand("cargo test")).toBe(true);
    expect(isVerifyCommand("cargo check")).toBe(true);
    expect(isVerifyCommand("cargo clippy")).toBe(true);
    expect(isVerifyCommand("cargo build")).toBe(true);
  });

  it("recognizes python commands", () => {
    expect(isVerifyCommand("pytest")).toBe(true);
    expect(isVerifyCommand("pytest tests/")).toBe(true);
    expect(isVerifyCommand("python -m pytest tests/")).toBe(true);
  });

  it("recognizes go commands", () => {
    expect(isVerifyCommand("go test ./...")).toBe(true);
    expect(isVerifyCommand("go vet")).toBe(true);
    expect(isVerifyCommand("go build")).toBe(true);
  });

  it("recognizes make commands", () => {
    expect(isVerifyCommand("make test")).toBe(true);
    expect(isVerifyCommand("make build")).toBe(true);
    expect(isVerifyCommand("make lint")).toBe(true);
  });

  it("recognizes standalone tools", () => {
    expect(isVerifyCommand("tsc --noEmit")).toBe(true);
    expect(isVerifyCommand("vitest run")).toBe(true);
    expect(isVerifyCommand("jest")).toBe(true);
    expect(isVerifyCommand("biome check .")).toBe(true);
    expect(isVerifyCommand("eslint src/")).toBe(true);
  });

  it("rejects non-verify commands", () => {
    expect(isVerifyCommand("git status")).toBe(false);
    expect(isVerifyCommand("ls -la")).toBe(false);
    expect(isVerifyCommand("cat foo.txt")).toBe(false);
    expect(isVerifyCommand("npm install")).toBe(false);
    expect(isVerifyCommand("cd src")).toBe(false);
    expect(isVerifyCommand("echo hello")).toBe(false);
    expect(isVerifyCommand("node script.js")).toBe(false);
  });

  it("recognizes verify commands in compound shell commands", () => {
    expect(isVerifyCommand("cd src && npm test")).toBe(true);
    expect(isVerifyCommand("npm test && npm run lint")).toBe(true);
    expect(isVerifyCommand("npm test | tee log.txt")).toBe(true);
  });

  it("recognizes bun commands", () => {
    expect(isVerifyCommand("bun test")).toBe(true);
    expect(isVerifyCommand("bun run lint")).toBe(true);
    expect(isVerifyCommand("bun run build")).toBe(true);
    expect(isVerifyCommand("bun run typecheck")).toBe(true);
  });

  it("recognizes deno commands", () => {
    expect(isVerifyCommand("deno test")).toBe(true);
    expect(isVerifyCommand("deno lint")).toBe(true);
    expect(isVerifyCommand("deno check src/main.ts")).toBe(true);
  });

  it("recognizes npx-prefixed tools", () => {
    expect(isVerifyCommand("npx vitest run")).toBe(true);
    expect(isVerifyCommand("npx tsc --noEmit")).toBe(true);
    expect(isVerifyCommand("npx jest")).toBe(true);
    expect(isVerifyCommand("npx biome check .")).toBe(true);
  });

  it("rejects empty command", () => {
    expect(isVerifyCommand("")).toBe(false);
  });
});

describe("processToolResults", () => {
  it("tracks file_edit and file_write paths", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "file_edit", id: "1", input: { path: "src/foo.ts" } },
      { name: "file_write", id: "2", input: { path: "src/bar.ts" } },
    ], [
      { tool_use_id: "1", content: "OK" },
      { tool_use_id: "2", content: "OK" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(2);
    const state = tracker.getState();
    expect(state).toContain("src/foo.ts");
    expect(state).toContain("src/bar.ts");
  });

  it("tracks multi_edit file paths", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "multi_edit", id: "1", input: {
        edits: [
          { file_path: "src/a.ts", old_string: "x", new_string: "y" },
          { file_path: "src/b.ts", old_string: "a", new_string: "b" },
        ],
      } },
    ], [
      { tool_use_id: "1", content: "OK" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(2);
  });

  it("parses find_replace result content for edited paths", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "find_replace", id: "1", input: { pattern: "foo", replacement: "bar", glob: "*.ts" } },
    ], [
      { tool_use_id: "1", content: "find_replace completed:\n  src/main.ts: 3 replacement(s)\n  src/util.ts: 1 replacement(s)" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/main.ts");
    expect(tracker.getState()).toContain("src/util.ts");
  });

  it("parses delegate modified files section", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "delegate", id: "1", input: { mode: "execute", task: "fix bug" } },
    ], [
      { tool_use_id: "1", content: "Task completed.\n--- Modified files\n  - src/fix.ts\n  - src/test.ts" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/fix.ts");
    expect(tracker.getState()).toContain("src/test.ts");
  });

  it("checks shell commands for verification and clears edits", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "shell", id: "1", input: { command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "all tests passed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("skips tracking when result is an error", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "file_edit", id: "1", input: { path: "src/foo.ts" } },
    ], [
      { tool_use_id: "1", content: "Error: string not found", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("advances turn counter via tick", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    // Each processToolResults call ticks once
    processToolResults(tracker, [], []);
    processToolResults(tracker, [], []);
    processToolResults(tracker, [], []);
    expect(tracker.getState()).toContain("Consider verifying");
  });

  it("does NOT clear edits when shell verify command fails", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "shell", id: "1", input: { command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "FAIL src/foo.test.ts\n2 tests failed", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/foo.ts");
  });

  it("does NOT clear edits when shell verify command has no result", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "shell", id: "1", input: { command: "npm test" } },
    ], []);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("does NOT clear edits when shell verify command timed out", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "shell", id: "1", input: { command: "npm run typecheck" } },
    ], [
      { tool_use_id: "1", content: "Command timed out after 30000ms", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("clears edits only when shell verify command succeeds", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/bar.ts");
    processToolResults(tracker, [
      { name: "shell", id: "1", input: { command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "All 42 tests passed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("tracks edits and clears on verify in same turn", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "file_edit", id: "1", input: { path: "src/foo.ts" } },
      { name: "shell", id: "2", input: { command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "OK" },
      { tool_use_id: "2", content: "All tests passed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("keeps edits when verify fails in same turn as edits", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "file_edit", id: "1", input: { path: "src/foo.ts" } },
      { name: "shell", id: "2", input: { command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "OK" },
      { tool_use_id: "2", content: "FAIL: 3 tests failed", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/foo.ts");
  });

  it("non-verify shell commands do not clear edits regardless of success", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "shell", id: "1", input: { command: "git status" } },
    ], [
      { tool_use_id: "1", content: "On branch main" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("does not track find_replace files when result is error", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "find_replace", id: "1", input: { pattern: "foo", replacement: "bar", files: "*.ts" } },
    ], [
      { tool_use_id: "1", content: "Syntax error in src/main.ts after replacement:\nAll changes reverted.", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("does not track delegate files when result is error", () => {
    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "delegate", id: "1", input: { mode: "execute", task: "fix bug" } },
    ], [
      { tool_use_id: "1", content: "Error: context overflow\n--- Modified files\n  - src/fix.ts", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("clears edits when process start runs verify command that exits cleanly", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "start", command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "Started background process p1\nCommand: npm test\nPID: 12345\nStatus: exited (code 0)\n\nInitial output:\nall tests passed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("does NOT clear edits when process start verify command is still running", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "start", command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "Started background process p1\nCommand: npm test\nPID: 12345\nStatus: running\n\n(no output yet)" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("does NOT clear edits when process start verify command exits with error", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "start", command: "npm test" } },
    ], [
      { tool_use_id: "1", content: "Started background process p1\nCommand: npm test\nPID: 12345\nStatus: exited (code 1)\n\nInitial output:\n2 tests failed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("does NOT clear edits when process start runs non-verify command", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "start", command: "node server.js" } },
    ], [
      { tool_use_id: "1", content: "Started background process p1\nCommand: node server.js\nPID: 12345\nStatus: exited (code 0)\n\nInitial output:\nlistening on 3000" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("clears edits when process output shows verify command exited cleanly", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/bar.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "output", process_id: "p1", lines: 50 } },
    ], [
      { tool_use_id: "1", content: "Process p1 [exited (code 0)]\nCommand: npm test\nBuffer: 42/500 lines\n\nall 15 tests passed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("does NOT clear edits when process output shows verify command still running", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "output", process_id: "p1", lines: 50 } },
    ], [
      { tool_use_id: "1", content: "Process p1 [running (2m15s)]\nCommand: npm test\nBuffer: 100/500 lines\n\nrunning tests..." },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("does NOT clear edits when process output shows non-verify command", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "output", process_id: "p1", lines: 50 } },
    ], [
      { tool_use_id: "1", content: "Process p1 [exited (code 0)]\nCommand: node server.js\nBuffer: 10/500 lines\n\nlistening on 3000" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("does NOT clear edits when process result is an error", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "output", process_id: "p1" } },
    ], [
      { tool_use_id: "1", content: "Error: unknown process \"p1\". Available: (none)", is_error: true },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("process list action does not affect verification state", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    processToolResults(tracker, [
      { name: "process", id: "1", input: { action: "list" } },
    ], [
      { tool_use_id: "1", content: "p1 [exited (code 0)] npm test\n  last: all tests passed" },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(1);
  });
});

describe("cross-module: assembleDelegateResult → processToolResults", () => {
  // Import from delegate-format to test the actual output format
  // that processToolResults must parse in production.

  it("parses realistic delegate result with modified files and metadata", async () => {
    const { assembleDelegateResult } = await import("#core/tools/delegate-format.js");
    const meta = {
      mode: "execute",
      turnsUsed: 5,
      turnsMax: 15,
      toolsUsed: ["file_edit", "file_write"],
      completionReason: "done" as const,
      urlsFetched: [],
      searchQueries: [],
    };
    const modifiedFiles = new Set(["src/auth.ts", "src/validator.ts"]);
    const result = assembleDelegateResult("Refactoring complete.", meta, modifiedFiles, []);

    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "delegate", id: "d1", input: { mode: "execute", task: "refactor auth" } },
    ], [
      { tool_use_id: "d1", content: result.content },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/auth.ts");
    expect(tracker.getState()).toContain("src/validator.ts");
  });

  it("parses delegate result with sources section without false positives", async () => {
    const { assembleDelegateResult } = await import("#core/tools/delegate-format.js");
    const meta = {
      mode: "execute",
      turnsUsed: 8,
      turnsMax: 15,
      toolsUsed: ["file_edit", "web_fetch"],
      completionReason: "done" as const,
      urlsFetched: ["https://docs.example.com/api"],
      searchQueries: ["react 19 features"],
    };
    const modifiedFiles = new Set(["src/api.ts"]);
    const result = assembleDelegateResult("Updated API client.", meta, modifiedFiles, []);

    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "delegate", id: "d2", input: { mode: "execute", task: "update api" } },
    ], [
      { tool_use_id: "d2", content: result.content },
    ]);
    // Should only pick up modified files, not source URLs
    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/api.ts");
    expect(tracker.getState()).not.toContain("docs.example.com");
  });

  it("does not track files when delegate has no modifications", async () => {
    const { assembleDelegateResult } = await import("#core/tools/delegate-format.js");
    const meta = {
      mode: "explore",
      turnsUsed: 3,
      turnsMax: 10,
      toolsUsed: ["file_read", "grep"],
      completionReason: "done" as const,
      urlsFetched: [],
      searchQueries: [],
    };
    const result = assembleDelegateResult("Found 3 usages of the function.", meta, new Set(), []);

    const tracker = new VerifyTracker();
    processToolResults(tracker, [
      { name: "delegate", id: "d3", input: { mode: "explore", task: "find usages" } },
    ], [
      { tool_use_id: "d3", content: result.content },
    ]);
    expect(tracker.getUnverifiedCount()).toBe(0);
  });
});

describe("detectVerifyCommands", () => {
  it("returns empty array for nonexistent directory", () => {
    const commands = detectVerifyCommands("/nonexistent/path/xyz");
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBe(0);
  });

  it("detects commands from current project", () => {
    // This test runs against the actual kota project which has test, typecheck, build
    const commands = detectVerifyCommands(process.cwd());
    expect(commands.length).toBeGreaterThan(0);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain("test");
    expect(labels).toContain("typecheck");
    expect(labels).toContain("build");
  });

  it("detects correct package manager for current project", () => {
    const commands = detectVerifyCommands(process.cwd());
    const testCmd = commands.find((c) => c.label === "test");
    expect(testCmd).toBeDefined();
    expect(testCmd!.command).toBe("pnpm test");
  });

  it("defaults to process.cwd when no dir given", () => {
    const commands = detectVerifyCommands();
    expect(commands.length).toBeGreaterThan(0);
  });
});
