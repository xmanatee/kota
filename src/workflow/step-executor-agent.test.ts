import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("../event-bus.js", () => ({ tryEmit: tryEmitMock }));

const executeWithAgentSDKMock = vi.hoisted(() => vi.fn());
vi.mock("../agent-sdk/index.js", () => ({
  buildClaudeCodeSystemPrompt: () => "system",
  executeWithAgentSDK: executeWithAgentSDKMock,
}));

import type { WorkflowRunMetadata } from "./run-types.js";
import { executeAgentStep } from "./step-executor-agent.js";
import type { WorkflowAgentStep, WorkflowDefinition } from "./types.js";

function makeDefinition(name = "test-workflow"): WorkflowDefinition {
  return {
    name,
    enabled: true,
    definitionPath: "src/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
  };
}

function makeMetadata(runId = "run-001"): WorkflowRunMetadata {
  return {
    id: runId,
    workflow: "test-workflow",
    runDir: ".kota/runs/run-001",
    definitionPath: "src/workflows/test/workflow.ts",
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
  };
}

function makeAgentStep(overrides: Partial<WorkflowAgentStep> = {}): WorkflowAgentStep {
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    permissionMode: "bypassPermissions",
    settingSources: [],
    ...overrides,
  };
}

describe("executeAgentStep — cost ceiling", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    // Create a minimal prompt file
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits workflow.cost.ceiling.exceeded when the SDK returns error_max_budget_usd", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "budget exceeded",
      streamedText: "",
      sessionId: undefined,
      turns: 3,
      totalCostUsd: 2.5,
      subtype: "error_max_budget_usd",
      isError: true,
    });

    const definition = makeDefinition("builder");
    const step = makeAgentStep({ id: "build", maxBudgetUsd: 2.0 });
    const metadata = makeMetadata("run-xyz");

    await expect(
      executeAgentStep(
        definition,
        step,
        metadata,
        { event: "runtime.idle", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { projectDir, log: () => {} },
      ),
    ).rejects.toThrow();

    expect(tryEmitMock).toHaveBeenCalledWith("workflow.cost.ceiling.exceeded", {
      workflow: "builder",
      runId: "run-xyz",
      stepId: "build",
      budgetUsd: 2.0,
      actualCostUsd: 2.5,
    });
  });

  it("does not emit workflow.cost.ceiling.exceeded for other error subtypes", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "too many turns",
      streamedText: "",
      sessionId: undefined,
      turns: 10,
      totalCostUsd: 0.5,
      subtype: "error_max_turns",
      isError: true,
    });

    const definition = makeDefinition("builder");
    const step = makeAgentStep({ id: "build", maxTurns: 10 });
    const metadata = makeMetadata("run-abc");

    await expect(
      executeAgentStep(
        definition,
        step,
        metadata,
        { event: "runtime.idle", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { projectDir, log: () => {} },
      ),
    ).rejects.toThrow();

    expect(tryEmitMock).not.toHaveBeenCalledWith("workflow.cost.ceiling.exceeded", expect.anything());
  });
});
