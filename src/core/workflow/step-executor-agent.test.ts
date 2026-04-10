import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("#core/events/event-bus.js", () => ({ tryEmit: tryEmitMock }));

const executeWithAgentSDKMock = vi.hoisted(() => vi.fn());
vi.mock("#core/agent-sdk/index.js", () => ({
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
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
  };
}

function makeMetadata(runId = "run-001"): WorkflowRunMetadata {
  return {
    id: runId,
    workflow: "test-workflow",
    runDir: ".kota/runs/run-001",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
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
    model: "claude-opus-4-6",
    permissionMode: "bypassPermissions",
    settingSources: [],
    ...overrides,
  };
}

describe("executeAgentStep — maxCostUsd", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-maxcost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("completes normally when totalCostUsd is under maxCostUsd", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: undefined,
      turns: 2,
      totalCostUsd: 0.30,
      subtype: "success",
      isError: false,
    });

    const step = makeAgentStep({ id: "build", maxCostUsd: 0.50 });
    const output = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect((output as { content: string }).content).toBe("done");
  });

  it("fails with cost_cap_exceeded when totalCostUsd exceeds maxCostUsd", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "large output",
      streamedText: "",
      sessionId: undefined,
      turns: 5,
      totalCostUsd: 0.75,
      subtype: "success",
      isError: false,
    });

    const step = makeAgentStep({ id: "analyze", maxCostUsd: 0.50 });
    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        { event: "runtime.idle", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { projectDir, log: () => {} },
      ),
    ).rejects.toThrow(/cost_cap_exceeded/);
  });

  it("error message includes actual spend, cap, and step name", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "large output",
      streamedText: "",
      sessionId: undefined,
      turns: 5,
      totalCostUsd: 1.2345,
      subtype: "success",
      isError: false,
    });

    const step = makeAgentStep({ id: "my-step", maxCostUsd: 0.5 });
    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        { event: "runtime.idle", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { projectDir, log: () => {} },
      ),
    ).rejects.toThrow(/my-step.*cost_cap_exceeded.*1\.2345.*0\.5000/);
  });

  it("behaves normally when maxCostUsd is absent", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: undefined,
      turns: 10,
      totalCostUsd: 999.99,
      subtype: "success",
      isError: false,
    });

    const step = makeAgentStep({ id: "build" });
    const output = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect((output as { content: string }).content).toBe("done");
  });
});

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

describe("executeAgentStep — outputFormat: json", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-json-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("extracts parsed JSON from the last fenced block when outputFormat is json", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "Some text\n\n```json\n{\"status\":\"ok\",\"count\":3}\n```",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });

    const definition = makeDefinition("test-workflow");
    const step = makeAgentStep({ id: "analyze", outputFormat: "json" });
    const metadata = makeMetadata("run-json-ok");

    const output = await executeAgentStep(
      definition,
      step,
      metadata,
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(output).toEqual({ status: "ok", count: 3 });
  });

  it("fails the step when outputFormat is json but no fenced block is present", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "I did the analysis and found nothing special.",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });

    const definition = makeDefinition("test-workflow");
    const step = makeAgentStep({ id: "analyze", outputFormat: "json" });
    const metadata = makeMetadata("run-json-missing");

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
    ).rejects.toThrow(/no fenced JSON block was found/);
  });

  it("fails the step when the fenced block content is not valid JSON", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "Result:\n\n```json\nnot valid json {\n```",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });

    const definition = makeDefinition("test-workflow");
    const step = makeAgentStep({ id: "analyze", outputFormat: "json" });
    const metadata = makeMetadata("run-json-bad");

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
    ).rejects.toThrow(/invalid JSON/);
  });

  it("fails the step when outputSchema validation fails", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "Result:\n\n```json\n{\"status\":\"ok\"}\n```",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });

    const definition = makeDefinition("test-workflow");
    const step = makeAgentStep({
      id: "analyze",
      outputFormat: "json",
      outputSchema: { type: "object", required: ["status", "count"], properties: { status: { type: "string" }, count: { type: "number" } } },
    });
    const metadata = makeMetadata("run-json-schema-fail");

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
    ).rejects.toThrow(/schema validation/);
  });

  it("succeeds when outputSchema validation passes", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "Result:\n\n```json\n{\"status\":\"done\",\"count\":5}\n```",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });

    const definition = makeDefinition("test-workflow");
    const step = makeAgentStep({
      id: "analyze",
      outputFormat: "json",
      outputSchema: { type: "object", required: ["status", "count"], properties: { status: { type: "string" }, count: { type: "number" } } },
    });
    const metadata = makeMetadata("run-json-schema-ok");

    const output = await executeAgentStep(
      definition,
      step,
      metadata,
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(output).toEqual({ status: "done", count: 5 });
  });
});

describe("executeAgentStep — schema validation feedback on retry", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-schema-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("injects schema validation error into the prompt on the second attempt", async () => {
    const capturedPrompts: string[] = [];

    executeWithAgentSDKMock.mockImplementation(async (prompt: string) => {
      capturedPrompts.push(prompt);
      // First call: missing required field "count"
      if (capturedPrompts.length === 1) {
        return {
          text: 'Result:\n\n```json\n{"status":"ok"}\n```',
          streamedText: "",
          sessionId: undefined,
          turns: 1,
          totalCostUsd: 0.01,
          subtype: undefined,
          isError: false,
        };
      }
      // Second call: valid output
      return {
        text: 'Result:\n\n```json\n{"status":"ok","count":3}\n```',
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      };
    });

    const step = makeAgentStep({
      id: "analyze",
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["status", "count"],
        properties: { status: { type: "string" }, count: { type: "number" } },
      },
      retry: { maxAttempts: 2, initialDelayMs: 0, backoffFactor: 1 },
    });

    const output = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(output).toEqual({ status: "ok", count: 3 });
    expect(capturedPrompts).toHaveLength(2);
    expect(capturedPrompts[0]).not.toContain("Previous output failed schema validation");
    expect(capturedPrompts[1]).toContain("Previous output failed schema validation");
    expect(capturedPrompts[1]).toContain("count");
  });

  it("does not inject feedback for non-schema errors on retry", async () => {
    const capturedPrompts: string[] = [];

    executeWithAgentSDKMock.mockImplementation(async (prompt: string) => {
      capturedPrompts.push(prompt);
      if (capturedPrompts.length === 1) {
        return {
          text: "No JSON block here.",
          streamedText: "",
          sessionId: undefined,
          turns: 1,
          totalCostUsd: 0.01,
          subtype: undefined,
          isError: false,
        };
      }
      return {
        text: 'Result:\n\n```json\n{"status":"ok","count":1}\n```',
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      };
    });

    const step = makeAgentStep({
      id: "analyze",
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["status", "count"],
        properties: { status: { type: "string" }, count: { type: "number" } },
      },
      retry: { maxAttempts: 2, initialDelayMs: 0, backoffFactor: 1 },
    });

    const output = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(output).toEqual({ status: "ok", count: 1 });
    // No schema correction note — the first failure was missing JSON block, not schema mismatch
    expect(capturedPrompts[1]).not.toContain("Previous output failed schema validation");
  });
});
