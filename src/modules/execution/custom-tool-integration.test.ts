/**
 * Integration tests for `custom_tool` end-to-end execution against real
 * Python and Node.js REPL sessions. Lives in the execution module because
 * the tests depend on the module's CodeRunner adapter; the matching unit
 * tests stay in `src/core/tools/custom-tool.test.ts` and do not spawn
 * runtimes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetCodeRunners } from "#core/tools/code-runner.js";
import { resetCustomTools, runCustomTool } from "#core/tools/custom-tool.js";
import { executeTool } from "#core/tools/index.js";
import {
  deregisterExecutionCodeRunners,
  registerExecutionCodeRunners,
} from "./code-runner-adapter.js";
import { cleanupSessions } from "./repl-session.js";

describe("custom_tool execution against the execution module runners", () => {
  beforeAll(() => {
    resetCodeRunners();
    registerExecutionCodeRunners();
  });

  afterAll(() => {
    cleanupSessions();
    deregisterExecutionCodeRunners();
    resetCustomTools();
  });

  beforeEach(() => {
    resetCustomTools();
  });

  it("executes a Python custom tool", async () => {
    await runCustomTool({
      action: "create",
      name: "add_numbers",
      description: "Add two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
      },
      code: "print(params['a'] + params['b'])",
      language: "python",
    });

    const result = await executeTool("add_numbers", { a: 3, b: 7 });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("10");
  });

  it("executes a Node.js custom tool", async () => {
    await runCustomTool({
      action: "create",
      name: "reverse_string",
      description: "Reverse a string",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      code: "console.log(params.text.split('').reverse().join(''))",
      language: "node",
    });

    const result = await executeTool("reverse_string", { text: "hello" });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("olleh");
  });

  it("handles errors in custom tool code gracefully", async () => {
    await runCustomTool({
      action: "create",
      name: "will_fail",
      description: "This will error",
      code: "raise ValueError('intentional error')",
      language: "python",
    });

    const result = await executeTool("will_fail", {});
    expect(result.content).toContain("ValueError");
    expect(result.content).toContain("intentional error");
  });

  it("passes complex parameters correctly", async () => {
    await runCustomTool({
      action: "create",
      name: "format_data",
      description: "Format structured data",
      parameters: {
        type: "object",
        properties: {
          items: { type: "array" },
          separator: { type: "string" },
        },
      },
      code: "print(params['separator'].join(str(x) for x in params['items']))",
      language: "python",
    });

    const result = await executeTool("format_data", {
      items: [1, 2, 3],
      separator: " | ",
    });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("1 | 2 | 3");
  });

  it("handles params with special characters", async () => {
    await runCustomTool({
      action: "create",
      name: "echo_special",
      description: "Echo text with special chars",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      code: "print(params['text'])",
      language: "python",
    });

    const result = await executeTool("echo_special", {
      text: "Hello 'world' \"test\" \n newline & special <chars>",
    });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("Hello 'world'");
  });
});
