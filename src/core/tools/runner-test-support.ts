import { afterEach, type Mock, vi } from "vitest";
import type { KotaTool, KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import { deregisterLocalToolApprovalBinding, registerLocalToolApprovalBinding } from "./local-tool-approval-binding.js";
import type { ToolCallExecutionOptions, ToolResultEntry } from "./tool-runner.js";

const declaredTools = vi.hoisted(() => new Map<string, KotaTool>());
vi.mock("./index.js", () => ({
  executeTool: vi.fn(),
  getToolEffect: vi.fn(),
  getAllTools: () => [...declaredTools.values()],
}));
vi.mock("#core/loop/context.js", () => ({
  truncateToolResult: vi.fn((text: string) => text),
}));
vi.mock("./guardrails.js", () => ({
  assess: vi.fn(),
}));
vi.mock("#core/util/confirm.js", () => ({
  confirmAction: vi.fn(),
}));
const tryEmitMock: Mock = vi.hoisted(() => vi.fn());
vi.mock("#core/events/event-bus.js", () => ({
  tryEmit: tryEmitMock,
}));
vi.mock("#core/daemon/approval-queue.js", () => ({
  getApprovalQueue: vi.fn(() => ({
    enqueue: vi.fn(() => ({ id: "abc123" })),
  })),
}));
vi.mock("#core/config/secrets.js", () => ({
  maskKnownSecretValues: (text: string) => text,
}));

import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { truncateToolResult } from "#core/loop/context.js";
import { confirmAction } from "#core/util/confirm.js";
import { assess } from "./guardrails.js";
import { executeTool, getToolEffect } from "./index.js";

export const mockExecuteTool = vi.mocked(executeTool);
export const mockGetToolEffect = vi.mocked(getToolEffect);
export const mockTruncate = vi.mocked(truncateToolResult);
export const mockAssess = vi.mocked(assess);
export const mockConfirmAction = vi.mocked(confirmAction);
export const mockGetApprovalQueue = vi.mocked(getApprovalQueue);

export const readEffect = {
  kind: "read",
  scope: "local-fs",
  idempotent: true,
  openWorld: false,
} as const;
export const writeEffect = {
  kind: "write",
  scope: "local-fs",
  idempotent: false,
  openWorld: false,
} as const;
export const destructiveEffect = {
  kind: "destructive",
  scope: "local-fs",
  idempotent: false,
  openWorld: false,
} as const;

export const safeAssessment = {
  tool: "file_read",
  risk: "safe" as const,
  policy: "allow" as const,
  reason: "read-only",
};

export const dangerousAssessment = {
  tool: "shell",
  risk: "dangerous" as const,
  policy: "confirm" as const,
  reason: "destructive command pattern detected",
};

export const confirmConfig = {
  policies: {
    safe: "allow" as const,
    moderate: "allow" as const,
    dangerous: "confirm" as const,
  },
};

// Scenarios declare only their local leaf tools. MCP declarations belong to the
// supplied manager; both input validation and execution leasing remain real.
export function toolBlock(
  name: string,
  input: KotaToolUseBlock["input"] = {},
  id = "t1",
): KotaToolUseBlock {
  if (!name.startsWith("mcp__") && !declaredTools.has(name)) {
    const tool: KotaTool = {
      name, description: "Controlled test operation",
      input_schema: { type: "object", properties: {} },
    };
    declaredTools.set(name, tool);
    registerLocalToolApprovalBinding(tool,
      (params, context) => mockExecuteTool(name, params, context),
      { effect: readEffect, resolveEffect: (params) => mockGetToolEffect(name, params) });
  }
  return { type: "tool_use", id, name, input };
}

afterEach(() => {
  for (const name of declaredTools.keys()) deregisterLocalToolApprovalBinding(name);
  declaredTools.clear();
});

export function ok(content = "done"): ToolResultEntry[] {
  return [{ tool_use_id: "t1", content }];
}

export function err(content = "error"): ToolResultEntry[] {
  return [{ tool_use_id: "t1", content, is_error: true }];
}

export function runOptions(
  overrides: Partial<ToolCallExecutionOptions> = {},
): ToolCallExecutionOptions {
  return {
    resultLimit: 50000,
    verbose: false,
    autonomyMode: "autonomous",
    approvalQueue: getApprovalQueue(),
    ...overrides,
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export function releaseTool(
  deferreds: Map<string, { resolve: () => void }>,
  name: string,
): void {
  const pending = deferreds.get(name);
  if (!pending) throw new Error(`Tool did not start: ${name}`);
  pending.resolve();
}

export function startTracker(): {
  started: string[];
  markStarted: (name: string) => void;
  waitForStart: (name: string) => Promise<void>;
} {
  const started: string[] = [];
  const waiters = new Map<string, Array<() => void>>();
  return {
    started,
    markStarted: (name: string) => {
      started.push(name);
      const waiting = waiters.get(name) ?? [];
      waiters.delete(name);
      for (const resolve of waiting) resolve();
    },
    waitForStart: (name: string) => {
      if (started.includes(name)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const waiting = waiters.get(name) ?? [];
        waiting.push(resolve);
        waiters.set(name, waiting);
      });
    },
  };
}

export function mockDeferredLocalTools(): {
  started: string[];
  deferreds: Map<string, { resolve: () => void }>;
  waitForStart: (name: string) => Promise<void>;
} {
  const tracker = startTracker();
  const deferreds = new Map<string, { resolve: () => void }>();
  mockExecuteTool.mockImplementation(async (name: string) => {
    tracker.markStarted(name);
    const pending = deferred();
    deferreds.set(name, pending);
    await pending.promise;
    return { content: `result:${name}` };
  });
  return { started: tracker.started, deferreds, waitForStart: tracker.waitForStart };
}


export type { ToolResultEntry } from "./tool-runner.js";
export { tryEmitMock };
