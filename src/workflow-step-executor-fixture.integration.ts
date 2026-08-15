import { vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import {
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  executeEmitStep,
  executeStep,
  executeToolStep,
  withRetry,
} from "#core/workflow/steps/step-executor.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/claude-agent-harness/executor.js")>(
    "#modules/claude-agent-harness/executor.js",
  );
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

export const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

export function makeStep(
  moduleRoot: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  return {
    id: "test-step",
    type: "agent",
    promptPath: "src/modules/test/workflows/test/prompt.md",
    moduleRoot,
    model: "claude-opus-4-7",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: "claude-agent-sdk",
    ...overrides,
  };
}

export function makeDefinition(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

export function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "test",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    runDir: ".kota/runs/run-1",
    steps: [],
  };
}

export const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

export const SUCCESS_RESULT = {
  text: "done",
  streamedText: "",
  sessionId: "sess-1",
  turns: 1,
  totalCostUsd: 0.01,
  subtype: "success",
  isError: false,
};

export {
  buildAgentPrompt,
  buildRepairPrompt,
  classifyAgentRuntimeFailure,
  executeAgentStep,
  executeEmitStep,
  executeStep,
  executeToolStep,
  withRetry,
};
