import { describe, expect, it } from "vitest";
import { err, ok, type ToolResultEntry } from "./runner-test-support.js";
import { extractApprovalContext, FailureTracker } from "./tool-runner.js";

describe("FailureTracker", () => {
  it("returns continue on success", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(ok())).toBe("continue");
  });

  it("returns continue on first few failures", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(err("a"))).toBe("continue");
    expect(tracker.record(err("b"))).toBe("continue");
  });

  it("resets on success after failures", () => {
    const tracker = new FailureTracker();
    tracker.record(err("a"));
    tracker.record(err("b"));
    tracker.record(ok());
    for (let i = 0; i < 4; i++) {
      expect(tracker.record(err(`new-${i}`))).toBe("continue");
    }
  });

  it("circuit breaks after 3 identical failures", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(err("same error"))).toBe("continue");
    expect(tracker.record(err("same error"))).toBe("continue");
    expect(tracker.record(err("same error"))).toBe("circuit_break");
  });

  it("does not circuit break if errors differ", () => {
    const tracker = new FailureTracker();
    tracker.record(err("error A"));
    tracker.record(err("error B"));
    tracker.record(err("error C"));
    expect(tracker.record(err("error D"))).toBe("continue");
  });

  it("injects guidance after 5 diverse consecutive failures", () => {
    const tracker = new FailureTracker();
    expect(tracker.record(err("a"))).toBe("continue");
    expect(tracker.record(err("b"))).toBe("continue");
    expect(tracker.record(err("c"))).toBe("continue");
    expect(tracker.record(err("d"))).toBe("continue");
    expect(tracker.record(err("e"))).toBe("inject_guidance");
  });

  it("resets consecutive count after guidance injection", () => {
    const tracker = new FailureTracker();
    for (let i = 0; i < 5; i++) tracker.record(err(`err-${i}`));
    expect(tracker.record(err("f"))).toBe("continue");
  });

  it("handles mixed success/failure results — any error counts as failure", () => {
    const tracker = new FailureTracker();
    const mixed: ToolResultEntry[] = [
      { tool_use_id: "t1", content: "ok" },
      { tool_use_id: "t2", content: "bad", is_error: true },
    ];
    expect(tracker.record(mixed)).toBe("continue");
  });

  it("handles empty results as success (no errors)", () => {
    const tracker = new FailureTracker();
    tracker.record(err("a"));
    tracker.record(err("b"));
    tracker.record([]);
    expect(tracker.record(err("c"))).toBe("continue");
  });

  it("getMessage returns correct strings", () => {
    expect(FailureTracker.getMessage("circuit_break")).toContain("3 times");
    expect(FailureTracker.getMessage("inject_guidance")).toContain(
      "5 consecutive",
    );
    expect(FailureTracker.getMessage("continue")).toBe("");
  });

  it("identical signature uses concatenated error content", () => {
    const tracker = new FailureTracker();
    const twoErrors: ToolResultEntry[] = [
      { tool_use_id: "t1", content: "err1", is_error: true },
      { tool_use_id: "t2", content: "err2", is_error: true },
    ];
    tracker.record(twoErrors);
    tracker.record(twoErrors);
    expect(tracker.record(twoErrors)).toBe("circuit_break");
  });
});


describe("extractApprovalContext", () => {
  it("returns undefined for empty messages", () => {
    expect(extractApprovalContext([])).toBeUndefined();
  });

  it("returns undefined when all messages have no text", () => {
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "x", content: "result" }],
      },
    ];
    expect(extractApprovalContext(messages)).toBeUndefined();
  });

  it("extracts text from string content messages", () => {
    const messages = [
      { role: "user" as const, content: "What is the weather?" },
      { role: "assistant" as const, content: "I will check the weather for you." },
    ];
    const ctx = extractApprovalContext(messages);
    expect(ctx).toContain("User: What is the weather?");
    expect(ctx).toContain("Assistant: I will check the weather for you.");
  });

  it("extracts text blocks from array content", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Processing your request" },
          { type: "tool_use" as const, id: "t1", name: "shell", input: {} },
        ],
      },
    ];
    const ctx = extractApprovalContext(messages);
    expect(ctx).toContain("Processing your request");
  });

  it("respects turns limit", () => {
    const messages = [
      { role: "user" as const, content: "message 1" },
      { role: "assistant" as const, content: "response 1" },
      { role: "user" as const, content: "message 2" },
      { role: "assistant" as const, content: "response 2" },
      { role: "user" as const, content: "message 3" },
    ];
    const ctx = extractApprovalContext(messages, 2);
    expect(ctx).not.toContain("message 1");
    expect(ctx).not.toContain("response 1");
    expect(ctx).toContain("response 2");
    expect(ctx).toContain("message 3");
  });

  it("truncates output at maxChars", () => {
    const longText = "x".repeat(3000);
    const messages = [{ role: "assistant" as const, content: longText }];
    const ctx = extractApprovalContext(messages, 3, 100);
    expect(ctx).toBeDefined();
    expect(ctx!.length).toBeLessThanOrEqual(101);
    expect(ctx).toMatch(/…$/);
  });
});
