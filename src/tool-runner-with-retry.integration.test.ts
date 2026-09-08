import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeModuleLoader } from "#core/modules/module-context.test-helpers.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import renderingModule from "#modules/rendering/index.js";
import toolRetryModule from "#modules/tool-retry/index.js";

// The process result is controlled; registration, middleware activation, retry
// input mutation and approval binding all run through their production owners.
describe("registered retry middleware through the tool runner", () => {
  let loader: ReturnType<typeof createRuntimeModuleLoader>;
  let timeouts: unknown[];

  beforeEach(async () => {
    timeouts = [];
    loader = createRuntimeModuleLoader({});
    await loader.loadAll([renderingModule, toolRetryModule]);
    registerTool({
      name: "shell",
      description: "Controlled process result",
      input_schema: { type: "object", properties: {
        command: { type: "string" },
        timeout_ms: { type: "number" },
      } },
    }, async (input) => {
      timeouts.push(input.timeout_ms);
      return timeouts.length === 1
        ? { content: "command timed out", is_error: true }
        : { content: `completed with timeout=${input.timeout_ms}` };
    }, undefined, { effect: localWriteEffect() });
  });

  afterEach(async () => {
    deregisterTool("shell");
    await loader.unloadAll();
  });

  const call = {
    type: "tool_use" as const,
    id: "retry-process",
    name: "shell",
    input: { command: "echo ready", timeout_ms: 120_000 },
  };

  it("propagates adjusted retry input to the registered runner", async () => {
    const [result] = await executeToolCalls([call], {
      resultLimit: 50_000,
      verbose: false,
      autonomyMode: "autonomous",
    });
    expect(timeouts).toEqual([120_000, 240_000]);
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("completed with timeout=240000");
  });

  it("rejects adjusted retry input after approval without executing it", async () => {
    const approvedInputs: unknown[] = [];
    const [result] = await executeToolCalls([call], {
      resultLimit: 50_000,
      verbose: false,
      autonomyMode: "supervised",
      clientApprovalResolver: async (request) => {
        approvedInputs.push(request.input);
        return { outcome: "allow" };
      },
    });
    expect(approvedInputs).toEqual([call.input]);
    expect(timeouts).toEqual([120_000]);
    expect(result).toMatchObject({
      is_error: true,
      content: expect.stringContaining("tool input changed after client approval"),
    });
  });
});
