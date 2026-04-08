import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { enableGroup, filterTools, resetGroups } from "./tool-groups.js";
import { FailureTracker } from "./tool-runner.js";
import {
  clearCustomTools,
  executeTool,
  getAllTools,
  registerTool,
} from "./tools/index.js";

const makeTool = (name: string): Anthropic.Tool => ({
  name,
  description: `Test tool: ${name}`,
  input_schema: { type: "object" as const, properties: {} },
});

afterEach(() => {
  clearCustomTools();
  resetGroups();
});

describe("registerTool × filterTools (cross-module)", () => {
  it("custom tools survive filterTools when no groups active", () => {
    registerTool(makeTool("calendar_check"), async () => ({
      content: "no events",
    }));
    const filtered = filterTools(getAllTools());
    const names = filtered.map((t) => t.name);
    expect(names).toContain("calendar_check");
    // Core tools also present
    expect(names).toContain("delegate");
    // shell is now in the execution extension, not in core
    expect(names).not.toContain("shell");
    // file_read is now in the filesystem extension, not in core
    expect(names).not.toContain("file_read");
  });

  it("custom tools survive filterTools with group enabled", () => {
    registerTool(makeTool("email_send"), async () => ({
      content: "sent",
    }));
    enableGroup("code");
    const filtered = filterTools(getAllTools());
    const names = filtered.map((t) => t.name);
    expect(names).toContain("email_send");
    // sqlite is now in the system extension (not core); it only appears after extension loads
  });

  it("custom tools survive filterTools with 'all' groups enabled", () => {
    registerTool(makeTool("smart_home"), async () => ({
      content: "lights off",
    }));
    enableGroup("all");
    const filtered = filterTools(getAllTools());
    const names = filtered.map((t) => t.name);
    expect(names).toContain("smart_home");
    // sqlite is now in the system extension (not core); it only appears after extension loads
  });

  it("cleared custom tools disappear from filterTools", () => {
    registerTool(makeTool("temp_tool"), async () => ({
      content: "tmp",
    }));
    expect(filterTools(getAllTools()).map((t) => t.name)).toContain("temp_tool");
    clearCustomTools();
    expect(filterTools(getAllTools()).map((t) => t.name)).not.toContain(
      "temp_tool",
    );
  });
});

describe("registerTool × executeTool (cross-module)", () => {
  it("custom tool executes correctly through executeTool", async () => {
    registerTool(makeTool("weather"), async (input) => ({
      content: `Weather in ${input.city ?? "unknown"}: sunny`,
    }));
    const result = await executeTool("weather", { city: "Tokyo" });
    expect(result.content).toBe("Weather in Tokyo: sunny");
    expect(result.is_error).toBeUndefined();
  });

  it("custom tool errors are caught by executeTool", async () => {
    registerTool(makeTool("flaky_api"), async () => {
      throw new Error("API rate limited");
    });
    const result = await executeTool("flaky_api", {});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("API rate limited");
  });
});

describe("registerTool × FailureTracker (cross-module)", () => {
  it("custom tool failures tracked like built-in tools", async () => {
    registerTool(makeTool("unstable"), async () => {
      throw new Error("connection reset");
    });
    const tracker = new FailureTracker();

    // 3 identical failures → circuit break
    for (let i = 0; i < 2; i++) {
      const result = await executeTool("unstable", {});
      const action = tracker.record([
        { tool_use_id: `id-${i}`, content: result.content, is_error: true },
      ]);
      expect(action).toBe("continue");
    }
    const result = await executeTool("unstable", {});
    const action = tracker.record([
      { tool_use_id: "id-3", content: result.content, is_error: true },
    ]);
    expect(action).toBe("circuit_break");
  });

  it("mixed custom + built-in failures tracked correctly", async () => {
    registerTool(makeTool("custom_fail"), async () => {
      throw new Error("oops");
    });
    const tracker = new FailureTracker();

    // Custom tool failure
    const r1 = await executeTool("custom_fail", {});
    tracker.record([
      { tool_use_id: "a", content: r1.content, is_error: true },
    ]);

    // Built-in tool failure (unknown tool)
    const r2 = await executeTool("nonexistent", {});
    tracker.record([
      { tool_use_id: "b", content: r2.content, is_error: true },
    ]);

    // Different error strings → no circuit break yet, just diverse failures
    expect(r1.content).not.toBe(r2.content);
  });
});
