import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { destructiveEffect, flushMicrotasks, mockAssess, mockDeferredLocalTools, mockExecuteTool, mockGetToolEffect, mockTruncate, readEffect, releaseTool, runOptions, safeAssessment, toolBlock, writeEffect } from "./runner-test-support.js";
import { executeToolCalls } from "./tool-runner.js";
import { resetToolTelemetry } from "./tool-telemetry.js";

describe("executeToolCalls local execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolTelemetry();
    mockTruncate.mockImplementation((text: string) => text);
    mockAssess.mockReturnValue(safeAssessment);
    mockGetToolEffect.mockReturnValue(readEffect);
  });
  it("routes tool call to executeTool and returns result", async () => {
    mockExecuteTool.mockResolvedValue({ content: "file contents" });
    const results = await executeToolCalls(
      [toolBlock("file_read", { path: "/a.txt" })],
      runOptions(),
    );
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "file_read",
      { path: "/a.txt" },
      expect.objectContaining({
        approvalQueue: expect.any(Object),
        toolUseId: "t1",
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe("t1");
    expect(results[0].content).toBe("file contents");
    expect(results[0].is_error).toBeUndefined();
  });

  it("passes session and tool-use context to local tool runners", async () => {
    mockExecuteTool.mockResolvedValue({ content: "ok" });

    await executeToolCalls(
      [toolBlock("shell", { command: "pwd" }, "tool-42")],
      runOptions({ sessionId: "session-7" }),
    );

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "shell",
      { command: "pwd" },
      expect.objectContaining({
        approvalQueue: expect.any(Object),
        sessionId: "session-7",
        toolUseId: "tool-42",
      }),
    );
  });

  it("replays provider writes with the same idempotency key and rejects mismatched retries", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-tool-idempotency-"));
    const idempotencyStore = new IdempotencyStore(join(root, "idempotency"), "scope-a");
    try {
      mockGetToolEffect.mockReturnValue(writeEffect);
      mockExecuteTool.mockResolvedValue({ content: "sent" });
      const options = runOptions({ idempotencyStore });

      const first = await executeToolCalls(
        [toolBlock("send_message", { idempotencyKey: "msg-1", text: "hello" })],
        options,
      );
      const replayed = await executeToolCalls(
        [toolBlock("send_message", { idempotencyKey: "msg-1", text: "hello" })],
        options,
      );
      const rejected = await executeToolCalls(
        [toolBlock("send_message", { idempotencyKey: "msg-1", text: "changed" })],
        options,
      );

      expect(first[0].content).toBe("sent");
      expect(first[0]._meta?.idempotency).toEqual({
        status: "accepted",
        key: expect.stringContaining("tool:"),
      });
      expect(replayed[0].content).toBe("sent");
      expect(replayed[0]._meta?.idempotency).toEqual({
        status: "replayed",
        key: expect.stringContaining("tool:"),
      });
      expect(rejected[0].is_error).toBe(true);
      expect(rejected[0].content).toContain("different parameters");
      expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes multiple read-only tools in parallel", async () => {
    mockExecuteTool.mockResolvedValue({ content: "ok" });
    const blocks = [
      toolBlock("grep", { pattern: "TODO" }, "t1"),
      toolBlock("glob", { pattern: "*.ts" }, "t2"),
    ];
    const results = await executeToolCalls(blocks, runOptions());
    expect(results).toHaveLength(2);
    expect(results[0].tool_use_id).toBe("t1");
    expect(results[1].tool_use_id).toBe("t2");
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it("runs contiguous read-only local tools concurrently and preserves model order", async () => {
    mockGetToolEffect.mockReturnValue(readEffect);
    const { started, deferreds } = mockDeferredLocalTools();

    const pending = executeToolCalls(
      [
        toolBlock("read_slow", {}, "t1"),
        toolBlock("read_fast", {}, "t2"),
      ],
      runOptions(),
    );

    expect(started).toEqual(["read_slow", "read_fast"]);
    releaseTool(deferreds, "read_fast");
    await flushMicrotasks();
    releaseTool(deferreds, "read_slow");

    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2"]);
    expect(results.map((result) => result.content)).toEqual([
      "result:read_slow",
      "result:read_fast",
    ]);
  });

  it("treats web_fetch save_to as an ordered barrier despite its read effect", async () => {
    mockGetToolEffect.mockReturnValue(readEffect);
    const { started, deferreds, waitForStart } = mockDeferredLocalTools();

    const pending = executeToolCalls(
      [
        toolBlock("read_before", {}, "t1"),
        toolBlock(
          "web_fetch",
          { url: "https://example.com", save_to: "data/page.md" },
          "t2",
        ),
        toolBlock("read_after", {}, "t3"),
      ],
      runOptions(),
    );

    expect(started).toEqual(["read_before"]);
    releaseTool(deferreds, "read_before");
    await waitForStart("web_fetch");
    expect(started).toEqual(["read_before", "web_fetch"]);

    await flushMicrotasks();
    expect(started).toEqual(["read_before", "web_fetch"]);

    releaseTool(deferreds, "web_fetch");
    await waitForStart("read_after");
    expect(started).toEqual(["read_before", "web_fetch", "read_after"]);

    releaseTool(deferreds, "read_after");
    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2", "t3"]);
  });

  it("treats mutating and destructive local tools as barriers", async () => {
    mockGetToolEffect.mockImplementation((name: string) => {
      if (name.startsWith("read")) return readEffect;
      if (name === "destroy_one") return destructiveEffect;
      return writeEffect;
    });
    const { started, deferreds, waitForStart } = mockDeferredLocalTools();

    const pending = executeToolCalls(
      [
        toolBlock("read_before", {}, "t1"),
        toolBlock("write_one", {}, "t2"),
        toolBlock("destroy_one", {}, "t3"),
        toolBlock("read_after", {}, "t4"),
      ],
      runOptions(),
    );

    expect(started).toEqual(["read_before"]);
    releaseTool(deferreds, "read_before");
    await waitForStart("write_one");
    expect(started).toEqual(["read_before", "write_one"]);

    releaseTool(deferreds, "write_one");
    await waitForStart("destroy_one");
    expect(started).toEqual(["read_before", "write_one", "destroy_one"]);

    releaseTool(deferreds, "destroy_one");
    await waitForStart("read_after");
    expect(started).toEqual(["read_before", "write_one", "destroy_one", "read_after"]);

    releaseTool(deferreds, "read_after");
    const results = await pending;
    expect(results.map((result) => result.tool_use_id)).toEqual(["t1", "t2", "t3", "t4"]);
  });

});
