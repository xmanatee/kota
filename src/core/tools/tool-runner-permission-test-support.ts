import { beforeEach, vi } from "vitest";
import type { KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import type { ToolCallExecutionOptions } from "./tool-runner.js";

const confirmActionMock = vi.hoisted(() =>
  vi.fn<(message: string) => Promise<boolean>>(),
);

vi.mock("./index.js", () => ({
  executeTool: vi.fn(),
  getAllTools: vi.fn(() => ["file_read", "file_write", "shell"].map((name) => ({
    name,
    description: "test",
    input_schema: { type: "object", properties: {} },
  }))),
  getToolEffect: vi.fn(() => ({
    kind: "read",
    scope: "local-fs",
    idempotent: true,
    openWorld: false,
  })),
}));
vi.mock("#core/loop/context.js", () => ({
  truncateToolResult: vi.fn((text: string) => text),
}));
vi.mock("#core/config/secrets.js", () => ({
  maskKnownSecretValues: (text: string) => text,
}));
vi.mock("#core/util/confirm.js", () => ({
  confirmAction: (message: string) => confirmActionMock(message),
}));

import { executeTool, getAllTools, getToolEffect } from "./index.js";

export function permissionTestMocks() {
  return {
    confirmActionMock,
    mockExecuteTool: vi.mocked(executeTool),
    mockGetToolEffect: vi.mocked(getToolEffect),
  };
}

export function toolBlock(
  name: string,
  input: KotaToolUseBlock["input"] = {},
  id = "t1",
): KotaToolUseBlock {
  return { type: "tool_use", id, name, input };
}

export function runOptions(
  overrides: Partial<ToolCallExecutionOptions> = {},
): ToolCallExecutionOptions {
  return {
    resultLimit: 50_000,
    verbose: false,
    autonomyMode: "autonomous",
    ...overrides,
  };
}

import { resolve } from "node:path";
import { readOnlyLocalEffect } from "./effect.js";
import { registerLocalToolApprovalBinding } from "./local-tool-approval-binding.js";

beforeEach(() => {
  for (const tool of getAllTools()) registerLocalToolApprovalBinding(tool,
    (input, context) => executeTool(tool.name, input, context), {
      effect: readOnlyLocalEffect(), resolveEffect: (input) => getToolEffect(tool.name, input),
      ...(tool.name === "file_write" ? { resolveFilesystemTargets: (input: Record<string, unknown>) =>
        typeof input.path === "string" ? { kind: "known" as const, paths: [resolve(input.path)] } : { kind: "unknown" as const } } : {}),
    });
});
