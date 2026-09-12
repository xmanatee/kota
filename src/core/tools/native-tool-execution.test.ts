import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import { daemonWriteEffect, readOnlySessionEffect } from "./effect.js";
import { registerTool, type ToolRunner } from "./index.js";
import {
  nativeToolExecutor,
  withNativeToolExecution,
} from "./native-tool-execution.js";

let root: string;
let dispose: () => void;
const runner = vi.fn<ToolRunner>(async (input) => ({
  content: JSON.stringify(input),
}));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "native-tool-permissions-"));
  runner.mockClear();
  dispose = registerTool(
    {
      name: "native_permission_probe",
      description: "Native permission boundary probe",
      input_schema: {
        type: "object",
        properties: { publish: { type: "boolean" }, value: { type: "string" } },
      },
    },
    runner,
    "permission-probe",
    {
      nativeInvocation: true,
      effect: readOnlySessionEffect(),
      resolveEffect: (input) =>
        input.publish === true ? daemonWriteEffect() : readOnlySessionEffect(),
    },
  );
});
afterEach(() => {
  dispose();
  rmSync(root, { recursive: true, force: true });
});

function invoke(overrides: Partial<AgentHarnessRunOptions> = {}) {
  return withNativeToolExecution(
    {
      prompt: "Inspect a contained result",
      effort: "low",
      autonomyMode: "autonomous",
      cwd: root,
      scopeRoot: root,
      agentOutputDir: root,
      workflowContext: {
        runId: "native-permissions",
        workflowName: "builder",
        stepId: "build",
        spanId: "probe",
        scopeId: "scope",
      },
      ...overrides,
    },
    () =>
      nativeToolExecutor(root, {
        runId: "native-permissions",
        workspaceDir: root,
        scopeRoot: root,
      })!(
        "native_permission_probe",
        {},
        "request-1",
        new AbortController().signal,
      ),
  );
}

it.each<{
  name: string;
  options: Partial<AgentHarnessRunOptions>;
  reason: string;
}>([
  {
    name: "allowedTools",
    options: { allowedTools: ["another_tool"] },
    reason: "not in allowedTools",
  },
  {
    name: "disallowedTools",
    options: { disallowedTools: ["native_permission_probe"] },
    reason: "in disallowedTools",
  },
  {
    name: "canUseTool",
    options: {
      canUseTool: async () => ({
        behavior: "deny",
        message: "hosting agent denied this call",
      }),
    },
    reason: "hosting agent denied",
  },
])("preserves inherited $name restrictions on an opted-in tool", async ({
  options,
  reason,
}) => {
  const result = await invoke(options);
  expect(result).toMatchObject({
    is_error: true,
    content: expect.stringContaining(reason),
  });
  expect(runner).not.toHaveBeenCalled();
});

it("preserves host input updates and applies the writer guard to the updated effect", async () => {
  const allowed = await invoke({
    allowedTools: ["native_permission_probe"],
    canUseTool: async () => ({
      behavior: "allow",
      updatedInput: { value: "host-approved" },
    }),
  });
  expect(allowed.is_error, allowed.content).not.toBe(true);
  expect(allowed.content).toBe('{"value":"host-approved"}');
  const denied = await invoke({
    canUseTool: async () => ({
      behavior: "allow",
      updatedInput: { publish: true },
    }),
  });
  expect(denied).toMatchObject({
    is_error: true,
    content: expect.stringContaining("before integration"),
  });
  expect(runner).toHaveBeenCalledTimes(1);
});
