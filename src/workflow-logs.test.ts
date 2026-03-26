import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "./workflow/types.js";
import { followRunLogs, formatAgentMessage, formatContentBlock, truncateContent } from "./workflow-logs.js";

describe("truncateContent", () => {
  it("returns short text unchanged", () => {
    expect(truncateContent("hello world", 200)).toBe("hello world");
  });

  it("truncates long text with indicator", () => {
    const long = "a".repeat(300);
    const result = truncateContent(long, 200);
    expect(result).toContain("… [+100 chars]");
    expect(result.startsWith("a".repeat(200))).toBe(true);
  });

  it("trims leading/trailing whitespace before measuring", () => {
    expect(truncateContent("  hello  ", 200)).toBe("hello");
  });
});

describe("formatContentBlock", () => {
  it("formats text block", () => {
    expect(formatContentBlock({ type: "text", text: "Hello!" })).toBe("Hello!");
  });

  it("returns null for thinking block", () => {
    expect(formatContentBlock({ type: "thinking", thinking: "hidden" })).toBeNull();
  });

  it("formats tool_use block with name and input", () => {
    const result = formatContentBlock({ type: "tool_use", name: "Bash", input: { command: "ls" } });
    expect(result).toBe('[tool: Bash] {"command":"ls"}');
  });

  it("formats tool_result block", () => {
    const result = formatContentBlock({ type: "tool_result", content: "output text" });
    expect(result).toBe("[tool result] output text");
  });

  it("truncates long tool input", () => {
    const long = "x".repeat(300);
    const result = formatContentBlock({ type: "tool_use", name: "Read", input: long }, 50);
    expect(result).toContain("… [+");
    expect(result?.startsWith("[tool: Read]")).toBe(true);
  });
});

describe("formatAgentMessage", () => {
  it("formats assistant message with text content", () => {
    const msg = {
      type: "assistant" as const,
      message: {
        content: [{ type: "text", text: "I will help you." }],
      },
    };
    const lines = formatAgentMessage(msg);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("[assistant] I will help you.");
  });

  it("skips thinking blocks in assistant message", () => {
    const msg = {
      type: "assistant" as const,
      message: {
        content: [
          { type: "thinking", thinking: "internal thoughts" },
          { type: "text", text: "Hello" },
        ],
      },
    };
    const lines = formatAgentMessage(msg);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Hello");
  });

  it("formats result message with cost and turns", () => {
    const msg = {
      type: "result" as const,
      subtype: "success",
      total_cost_usd: 0.5,
      num_turns: 10,
      result: "Done.",
    };
    const lines = formatAgentMessage(msg);
    expect(lines[0]).toContain("success");
    expect(lines[0]).toContain("turns=10");
    expect(lines[0]).toContain("cost=$0.5000");
    expect(lines[1]).toContain("Done.");
  });

  it("returns empty array for system message", () => {
    const msg = { type: "system", subtype: "init" };
    expect(formatAgentMessage(msg as never)).toHaveLength(0);
  });

  it("formats user message with tool_result", () => {
    const msg = {
      type: "user",
      message: {
        content: [{ type: "tool_result", content: "file contents" }],
      },
    };
    expect(formatAgentMessage(msg as never)[0]).toBe("[user]      [tool result] file contents");
  });
});

describe("followRunLogs", () => {
  let tmpDir: string;
  let runsDir: string;
  let statePath: string;

  const RUN_ID = "2026-01-01T00-00-00-000Z-builder-abc123";
  const STEP_ID = "build";

  const assistantEvent = {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hello from agent" }] },
  };

  function makeMetadata(status: "running" | "success" | "failed"): WorkflowRunMetadata {
    return {
      id: RUN_ID,
      workflow: "builder",
      definitionPath: "src/workflows/builder/workflow.ts",
      trigger: { event: "manual", payload: {} },
      startedAt: new Date().toISOString(),
      status,
      runDir: `.kota/runs/${RUN_ID}`,
      steps: [{ id: STEP_ID, type: "agent", status: "success", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 100 }],
    };
  }

  function writeMetadata(metadata: WorkflowRunMetadata): void {
    const runDir = join(runsDir, RUN_ID);
    mkdirSync(join(runDir, "steps"), { recursive: true });
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata), "utf-8");
  }

  function writeEvents(events: object[]): void {
    writeFileSync(
      join(runsDir, RUN_ID, "steps", `${STEP_ID}.events.jsonl`),
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf-8",
    );
  }

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kota-follow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    runsDir = join(tmpDir, "runs");
    statePath = join(tmpDir, "workflow-state.json");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints all events for a completed run and returns immediately", async () => {
    writeMetadata(makeMetadata("success"));
    writeEvents([assistantEvent]);

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    await followRunLogs(runsDir, statePath, RUN_ID, undefined);
    logSpy.mockRestore();

    const output = lines.join("\n");
    expect(output).toContain("Hello from agent");
    expect(output).toContain(`Step: ${STEP_ID}`);
  });

  it("polls a running run and exits when it completes", async () => {
    writeMetadata(makeMetadata("running"));
    writeEvents([assistantEvent]);

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    const followPromise = followRunLogs(runsDir, statePath, RUN_ID, undefined, 200, 30);

    await new Promise<void>((r) => setTimeout(r, 60));
    writeMetadata(makeMetadata("success"));

    await followPromise;
    logSpy.mockRestore();

    expect(lines.join("\n")).toContain("Hello from agent");
  });

  it("waits for an active run when no run-id is given", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    const followPromise = followRunLogs(runsDir, statePath, undefined, undefined, 200, 30);

    await new Promise<void>((r) => setTimeout(r, 50));

    writeMetadata(makeMetadata("running"));
    writeEvents([assistantEvent]);
    writeFileSync(
      statePath,
      JSON.stringify({ activeRuns: [{ runId: RUN_ID, workflow: "builder", startedAt: new Date().toISOString() }], completedRuns: 0, pendingRuns: [], workflows: {} }),
      "utf-8",
    );

    await new Promise<void>((r) => setTimeout(r, 80));
    writeMetadata(makeMetadata("success"));

    await followPromise;
    logSpy.mockRestore();

    const output = lines.join("\n");
    expect(output).toContain("Waiting for an active run");
    expect(output).toContain("Hello from agent");
  });

  it("does not double-print events seen in a previous poll", async () => {
    writeMetadata(makeMetadata("running"));
    writeEvents([assistantEvent]);

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    const followPromise = followRunLogs(runsDir, statePath, RUN_ID, undefined, 200, 30);

    await new Promise<void>((r) => setTimeout(r, 60));

    writeFileSync(
      join(runsDir, RUN_ID, "steps", `${STEP_ID}.events.jsonl`),
      `${[assistantEvent, { type: "assistant", message: { content: [{ type: "text", text: "Second message" }] } }]
        .map((e) => JSON.stringify(e))
        .join("\n")}\n`,
      "utf-8",
    );
    await new Promise<void>((r) => setTimeout(r, 60));
    writeMetadata(makeMetadata("success"));

    await followPromise;
    logSpy.mockRestore();

    const agentLines = lines.filter((l) => l.includes("[assistant]"));
    expect(agentLines.length).toBe(2);
    expect(agentLines.filter((l) => l.includes("Hello from agent")).length).toBe(1);
  });
});
