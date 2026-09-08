import { afterEach, describe, expect, it } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import {
  clearCustomTools,
  executeTool,
  getAllTools,
  registerTool,
} from "./index.js";
import { enableGroup, filterTools, resetGroups } from "./tool-groups.js";

const makeTool = (name: string): KotaTool => ({
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
  });

  it("custom tools survive filterTools with group enabled", () => {
    registerTool(makeTool("email_send"), async () => ({
      content: "sent",
    }));
    enableGroup("code");
    const filtered = filterTools(getAllTools());
    const names = filtered.map((t) => t.name);
    expect(names).toContain("email_send");
    // sqlite is now in the system module (not core); it only appears after module loads
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
