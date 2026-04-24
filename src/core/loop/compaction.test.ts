import { describe, expect, it } from "vitest";
import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import { extractWorkingState } from "./compaction.js";

type Message = KotaMessage;

function toolUse(name: string, input: Record<string, unknown>, id = "t1"): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  };
}

function toolResult(content: string, id = "t1", is_error = false): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error }],
  };
}

describe("extractWorkingState", () => {
  it("returns empty state for no messages", () => {
    const state = extractWorkingState([]);
    expect(state.filesModified).toEqual([]);
    expect(state.commandsRun).toEqual([]);
    expect(state.errors).toEqual([]);
    expect(state.toolCalls).toBe(0);
  });

  it("ignores string-content messages", () => {
    const state = extractWorkingState([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    expect(state.toolCalls).toBe(0);
  });

  it("extracts file_edit paths", () => {
    const state = extractWorkingState([
      toolUse("file_edit", { file_path: "src/foo.ts", old_string: "a", new_string: "b" }),
    ]);
    expect(state.filesModified).toEqual(["src/foo.ts"]);
    expect(state.toolCalls).toBe(1);
  });

  it("extracts file_write paths", () => {
    const state = extractWorkingState([
      toolUse("file_write", { path: "src/new.ts", content: "hello" }),
    ]);
    expect(state.filesModified).toEqual(["src/new.ts"]);
  });

  it("deduplicates files", () => {
    const state = extractWorkingState([
      toolUse("file_edit", { file_path: "a.ts" }, "t1"),
      toolUse("file_edit", { file_path: "a.ts" }, "t2"),
      toolUse("file_edit", { file_path: "b.ts" }, "t3"),
    ]);
    expect(state.filesModified).toEqual(["a.ts", "b.ts"]);
    expect(state.toolCalls).toBe(3);
  });

  it("extracts multi_edit file paths", () => {
    const state = extractWorkingState([
      toolUse("multi_edit", {
        edits: [{ file_path: "x.ts" }, { file_path: "y.ts" }, { file_path: "x.ts" }],
      }),
    ]);
    expect(state.filesModified).toEqual(["x.ts", "y.ts"]);
  });

  it("extracts shell commands", () => {
    const state = extractWorkingState([
      toolUse("shell", { command: "npm test" }, "t1"),
      toolUse("shell", { command: "npm run build" }, "t2"),
    ]);
    expect(state.commandsRun).toEqual(["npm test", "npm run build"]);
  });

  it("extracts process start commands with [bg] prefix", () => {
    const state = extractWorkingState([
      toolUse("process", { action: "start", command: "npm test" }, "t1"),
      toolUse("shell", { command: "npm run build" }, "t2"),
    ]);
    expect(state.commandsRun).toEqual(["[bg] npm test", "npm run build"]);
  });

  it("ignores process output/signal/list actions", () => {
    const state = extractWorkingState([
      toolUse("process", { action: "output", process_id: "p1" }, "t1"),
      toolUse("process", { action: "signal", process_id: "p1", signal: "SIGTERM" }, "t2"),
      toolUse("process", { action: "list" }, "t3"),
    ]);
    expect(state.commandsRun).toEqual([]);
  });

  it("deduplicates shell commands", () => {
    const state = extractWorkingState([
      toolUse("shell", { command: "npm test" }, "t1"),
      toolUse("shell", { command: "npm test" }, "t2"),
    ]);
    expect(state.commandsRun).toEqual(["npm test"]);
  });

  it("truncates long commands to 120 chars", () => {
    const longCmd = "x".repeat(200);
    const state = extractWorkingState([toolUse("shell", { command: longCmd })]);
    expect(state.commandsRun[0].length).toBe(123); // 120 + "..."
    expect(state.commandsRun[0].endsWith("...")).toBe(true);
  });

  it("keeps last 15 commands", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(toolUse("shell", { command: `cmd-${i}` }, `t${i}`));
    }
    const state = extractWorkingState(messages);
    expect(state.commandsRun.length).toBe(15);
    expect(state.commandsRun[0]).toBe("cmd-5");
    expect(state.commandsRun[14]).toBe("cmd-19");
  });

  it("extracts errors from tool_result with is_error", () => {
    const state = extractWorkingState([
      toolResult("File not found: foo.ts", "t1", true),
      toolResult("Success", "t2", false),
    ]);
    expect(state.errors).toEqual(["File not found: foo.ts"]);
  });

  it("truncates long errors to 200 chars", () => {
    const longErr = "e".repeat(300);
    const state = extractWorkingState([toolResult(longErr, "t1", true)]);
    expect(state.errors[0].length).toBe(203); // 200 + "..."
  });

  it("keeps last 5 errors", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push(toolResult(`error-${i}`, `t${i}`, true));
    }
    const state = extractWorkingState(messages);
    expect(state.errors.length).toBe(5);
    expect(state.errors[0]).toBe("error-3");
    expect(state.errors[4]).toBe("error-7");
  });

  it("handles mixed message types in a real conversation", () => {
    const messages: Message[] = [
      { role: "user", content: "Fix the auth module" },
      toolUse("file_read", { file_path: "src/auth.ts" }, "t1"),
      toolResult("export function login() { ... }", "t1"),
      toolUse("file_edit", { file_path: "src/auth.ts" }, "t2"),
      toolResult("Edit applied", "t2"),
      toolUse("shell", { command: "npm test" }, "t3"),
      toolResult("Tests failed: 2 errors", "t3", true),
      toolUse("file_edit", { file_path: "src/auth.ts" }, "t4"),
      toolResult("Edit applied", "t4"),
      toolUse("shell", { command: "npm test" }, "t5"),
      toolResult("All tests pass", "t5"),
    ];
    const state = extractWorkingState(messages);
    expect(state.filesModified).toEqual(["src/auth.ts"]);
    expect(state.commandsRun).toEqual(["npm test"]);
    expect(state.errors).toEqual(["Tests failed: 2 errors"]);
    expect(state.toolCalls).toBe(5); // file_read + 2 file_edit + 2 shell
  });
});
