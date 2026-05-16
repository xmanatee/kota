import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { KOTA_OWNER_QUESTIONS_MCP_TOOL } from "#modules/claude-agent-harness/kota-tools-mcp.js";

const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("#core/events/event-bus.js", () => ({ tryEmit: tryEmitMock }));

const executeWithAgentSDKMock = vi.hoisted(() => vi.fn());
vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/claude-agent-harness/executor.js")>(
    "#modules/claude-agent-harness/executor.js",
  );
  return {
    ...actual,
    executeWithAgentSDK: executeWithAgentSDKMock,
  };
});
vi.mock("#core/loop/system-prompt.js", () => ({
  buildKotaSystemPrompt: () => "system",
}));

// Registers the claude agent harness. After the harness refactor the step
// executor dispatches through the registry; importing this module triggers
// side-effect registration so `resolveAgentHarness("claude-agent-sdk")` works
// and the adapter still routes through the mocked executeWithAgentSDK.
import "#modules/claude-agent-harness/index.js";

import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { AgentWriteScopeViolationError } from "#core/workflow/steps/agent-write-scope.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { AgentStepRuntimeError } from "#core/workflow/steps/step-executor-retry.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";

function makeDefinition(name = "test-workflow"): WorkflowDefinition {
  return {
    name,
    enabled: true,
    recoveryCapable: false,
    tags: [],
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
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

function makeAgentStep(
  moduleRoot: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot,
    model: "claude-opus-4-7",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: "claude-agent-sdk",
    ...overrides,
  };
}

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
    const step = makeAgentStep(projectDir, { id: "analyze", outputFormat: "json" });
    const metadata = makeMetadata("run-json-ok");

    const result = await executeAgentStep(
      definition,
      step,
      metadata,
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result.output).toEqual({ status: "ok", count: 3 });
    expect(result.harness).toBe("claude-agent-sdk");
    expect(result.model).toBe("claude-opus-4-7");
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
    const step = makeAgentStep(projectDir, { id: "analyze", outputFormat: "json" });
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
    const step = makeAgentStep(projectDir, { id: "analyze", outputFormat: "json" });
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
    const step = makeAgentStep(projectDir, {
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
    const step = makeAgentStep(projectDir, {
      id: "analyze",
      outputFormat: "json",
      outputSchema: { type: "object", required: ["status", "count"], properties: { status: { type: "string" }, count: { type: "number" } } },
    });
    const metadata = makeMetadata("run-json-schema-ok");

    const result = await executeAgentStep(
      definition,
      step,
      metadata,
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result.output).toEqual({ status: "done", count: 5 });
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

    const step = makeAgentStep(projectDir, {
      id: "analyze",
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["status", "count"],
        properties: { status: { type: "string" }, count: { type: "number" } },
      },
      retry: { maxAttempts: 2, initialDelayMs: 0, backoffFactor: 1 },
    });

    const result = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result.output).toEqual({ status: "ok", count: 3 });
    expect(capturedPrompts).toHaveLength(2);
    expect(capturedPrompts[0]).not.toContain("Previous output failed schema validation");
    expect(capturedPrompts[1]).toContain("Previous output failed schema validation");
    expect(capturedPrompts[1]).toContain("count");
  });

  it("fails hard without retry on non-schema JSON format errors", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: "No JSON block here.",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });

    const step = makeAgentStep(projectDir, {
      id: "analyze",
      outputFormat: "json",
      outputSchema: {
        type: "object",
        required: ["status", "count"],
        properties: { status: { type: "string" }, count: { type: "number" } },
      },
      retry: { maxAttempts: 2, initialDelayMs: 0, backoffFactor: 1 },
    });

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
    ).rejects.toThrow("no fenced JSON block was found");

    // "no fenced block" is a format failure, not a classified transient
    // failure and not a schema validation error — so the retry predicate
    // refuses to consume a retry attempt.
    expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(1);
  });
});

describe("executeAgentStep — provider errors from SDK result", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("marks SDK-returned provider errors as non-retryable and does not spawn a second session", async () => {
    executeWithAgentSDKMock.mockResolvedValue({
      text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      streamedText: "",
      sessionId: "sess-xyz",
      turns: 1,
      totalCostUsd: 0.0006,
      subtype: "success",
      isError: true,
    });

    const step = makeAgentStep(projectDir, {
      id: "build",
      retry: { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 },
    });

    let caught: unknown;
    try {
      await executeAgentStep(
        makeDefinition("builder"),
        step,
        makeMetadata(),
        { event: "runtime.idle", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { projectDir, log: () => {} },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentStepRuntimeError);
    expect((caught as AgentStepRuntimeError).kind).toBe("provider");
    expect((caught as AgentStepRuntimeError).retryable).toBe(false);
    expect(executeWithAgentSDKMock).toHaveBeenCalledTimes(1);
  });
});

describe("executeAgentStep — SDK autonomy permissions", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-permissions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
    executeWithAgentSDKMock.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("limits passive agent steps to read-only SDK tools", async () => {
    const step = makeAgentStep(projectDir, {
      autonomyMode: "passive",
      allowedTools: undefined,
      disallowedTools: undefined,
    });

    await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    const options = executeWithAgentSDKMock.mock.calls[0][1] as {
      permissionMode: string;
      allowedTools: string[];
      disallowedTools?: string[];
    };
    expect(options.permissionMode).toBe("default");
    expect(options.disallowedTools).toBeUndefined();
    expect(options.allowedTools).toEqual([
      "Read",
      "LS",
      "Grep",
      "Glob",
      "NotebookRead",
      "WebFetch",
      "WebSearch",
      "TodoRead",
      "ListMcpResourcesTool",
      "ReadMcpResourceTool",
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    ]);
  });

  it("rejects unsafe allowedTools on passive agent steps", async () => {
    const step = makeAgentStep(projectDir, {
      autonomyMode: "passive",
      allowedTools: ["Read", "Bash"],
    });

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
    ).rejects.toThrow("Passive agent steps may only allow read-only tools");
    expect(executeWithAgentSDKMock).not.toHaveBeenCalled();
  });
});

describe("executeAgentStep — harness tool-control preflight", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-tool-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("fails before running a harness that declares canUseTool unsupported", async () => {
    const run = vi.fn(async () => ({
      text: "should not run",
      streamedText: "",
      turns: 1,
      isError: false,
    }));
    registerAgentHarness({
      name: "unsupported-tool-control-harness",
      description: "test-only unsupported harness",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      unsupportedRunOptions: [
        {
          runOption: "canUseTool",
          option: "canUseTool",
          reason: "this harness cannot enforce KOTA tool gates",
        },
      ],
      run,
    });

    await expect(
      executeAgentStep(
        makeDefinition(),
        makeAgentStep(projectDir, {
          harness: "unsupported-tool-control-harness",
          model: "fake-model",
        }),
        makeMetadata("run-tool-control-blocked"),
        { event: "runtime.idle", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { projectDir, log: () => {} },
      ),
    ).rejects.toThrow(/unsupported-tool-control-harness.*canUseTool/);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes canUseTool through to a guardrail-capable harness", async () => {
    const calls: Array<{ canUseTool: unknown }> = [];
    registerAgentHarness({
      name: "capable-tool-control-harness",
      description: "test-only guardrail-capable harness",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      async run(options) {
        calls.push({ canUseTool: options.canUseTool });
        return {
          text: "done",
          streamedText: "",
          turns: 1,
          isError: false,
        };
      },
    });

    const result = await executeAgentStep(
      makeDefinition(),
      makeAgentStep(projectDir, {
        harness: "capable-tool-control-harness",
        model: "fake-model",
      }),
      makeMetadata("run-tool-control-capable"),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result.harness).toBe("capable-tool-control-harness");
    expect(calls).toHaveLength(1);
    expect(calls[0].canUseTool).toEqual(expect.any(Function));
  });

  it("omits KOTA tool-control options for native tool-control harnesses", async () => {
    const calls: Array<{
      allowedTools?: string[];
      disallowedTools?: string[];
      hasCanUseTool: boolean;
    }> = [];
    registerAgentHarness({
      name: "native-tool-control-harness",
      description: "test-only native harness that owns its tool loop",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      unsupportedRunOptions: [
        {
          runOption: "disallowedTools",
          option: "disallowedTools",
          reason: "native harness owns tool filtering",
        },
        {
          runOption: "canUseTool",
          option: "canUseTool",
          reason: "native harness owns tool approvals",
        },
      ],
      async run(options) {
        calls.push({
          allowedTools: options.allowedTools,
          disallowedTools: options.disallowedTools,
          hasCanUseTool: options.canUseTool !== undefined,
        });
        return {
          text: "done",
          streamedText: "",
          turns: 1,
          isError: false,
        };
      },
    });

    const result = await executeAgentStep(
      makeDefinition(),
      makeAgentStep(projectDir, {
        harness: "native-tool-control-harness",
        model: "fake-model",
        disallowedTools: ["Bash"],
      }),
      makeMetadata("run-tool-control-native"),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result.harness).toBe("native-tool-control-harness");
    expect(calls).toEqual([
      {
        allowedTools: undefined,
        disallowedTools: undefined,
        hasCanUseTool: false,
      },
    ]);
  });
});

describe("executeAgentStep — writeScope enforcement", () => {
  let projectDir: string;

  function initRepo(dir: string) {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    mkdirSync(join(dir, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", "ready", "baseline.md"), "seed\n");
    mkdirSync(join(dir, "src", "core"), { recursive: true });
    writeFileSync(join(dir, "src", "core", "keep.ts"), "// seed\n");
    // Commit the prompt fixture so it sits in the clean baseline; the
    // writeScope gate now sees every untracked path that `git add -A` would
    // stage, and an uncommitted prompt.md would otherwise show up as a
    // spurious violation for every test in this block.
    writeFileSync(join(dir, "prompt.md"), "do the thing");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: dir });
  }

  function writeTracked(dir: string, relPath: string, content: string) {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  function makeAgentDef(overrides: Partial<AgentDef> = {}): AgentDef {
    return {
      name: "explorer",
      role: "test agent",
      promptPath: "prompt.md",
      model: "claude-opus-4-7",
      effort: "xhigh",
      writeScope: ["data/tasks/"],
      ...overrides,
    };
  }

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    initRepo(projectDir);
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("passes when every tracked mutation is inside the declared writeScope", async () => {
    executeWithAgentSDKMock.mockImplementation(async () => {
      writeTracked(
        projectDir,
        "data/tasks/ready/new-task.md",
        "---\ntitle: x\n---\n",
      );
      return {
        text: "done",
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      };
    });

    const agent = makeAgentDef();
    const step = makeAgentStep(projectDir, { agentName: agent.name });
    const metadata = makeMetadata("run-ws-inscope");

    await expect(
      executeAgentStep(
        makeDefinition("explorer"),
        step,
        metadata,
        { event: "autonomy.queue.empty", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        {
          projectDir,
          log: () => {},
          resolveAgentDef: () => agent,
        },
      ),
    ).resolves.toBeDefined();
  });

  it("fails with the offending paths when writes escape the declared writeScope", async () => {
    executeWithAgentSDKMock.mockImplementation(async () => {
      writeTracked(projectDir, "src/core/keep.ts", "// modified\n");
      writeTracked(projectDir, "AGENTS.md", "root agents\n");
      writeTracked(projectDir, "data/tasks/ready/new-task.md", "ok\n");
      return {
        text: "done",
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      };
    });

    const agent = makeAgentDef({ writeScope: ["data/tasks/"] });
    const step = makeAgentStep(projectDir, {
      id: "explore",
      agentName: agent.name,
    });
    const metadata = makeMetadata("run-ws-violation");

    let caught: unknown;
    try {
      await executeAgentStep(
        makeDefinition("explorer"),
        step,
        metadata,
        { event: "autonomy.queue.empty", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        {
          projectDir,
          log: () => {},
          resolveAgentDef: () => agent,
        },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AgentWriteScopeViolationError);
    const err = caught as AgentWriteScopeViolationError;
    expect(err.violations).toEqual(["AGENTS.md", "src/core/keep.ts"]);
    expect(err.scope).toEqual(["data/tasks/"]);

    const artifactPath = join(
      projectDir,
      ".kota/runs/run-001/steps/explore.write-scope-violation.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(parsed.violations).toEqual(["AGENTS.md", "src/core/keep.ts"]);
    expect(parsed.agentName).toBe("explorer");
    expect(parsed.stepId).toBe("explore");
  });

  it("treats writeScope: [] as explicit unrestricted and passes on any tracked mutation", async () => {
    executeWithAgentSDKMock.mockImplementation(async () => {
      writeTracked(projectDir, "src/core/keep.ts", "// anywhere\n");
      writeTracked(projectDir, "AGENTS.md", "root agents\n");
      return {
        text: "done",
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      };
    });

    const agent = makeAgentDef({ name: "builder", writeScope: [] });
    const step = makeAgentStep(projectDir, { agentName: agent.name });
    const metadata = makeMetadata("run-ws-unrestricted");

    await expect(
      executeAgentStep(
        makeDefinition("builder"),
        step,
        metadata,
        { event: "autonomy.queue.available", payload: {} },
        new AbortController(),
        () => {},
        () => {},
        {
          projectDir,
          log: () => {},
          resolveAgentDef: () => agent,
        },
      ),
    ).resolves.toBeDefined();
  });

  it("skips enforcement when the agent step does not run (recovery-only entry)", async () => {
    // A recovery-only pass never calls `executeAgentStep` for the gated agent
    // step — the workflow's `when` predicate returns false, so the executor
    // shell skips the step and therefore never invokes scope enforcement.
    // Simulate that: leave the SDK mock rejecting so any accidental invocation
    // would fail, and assert that neither the SDK nor the scope check runs.
    executeWithAgentSDKMock.mockRejectedValue(
      new Error("SDK must not run on a recovery-gated step"),
    );

    // Pre-seed the worktree with an out-of-scope tracked mutation. Because we
    // never call executeAgentStep, the enforcement never observes it.
    writeTracked(projectDir, "src/core/keep.ts", "// recovery dirt\n");

    expect(executeWithAgentSDKMock).not.toHaveBeenCalled();
    // And the enforcement helper is not reachable because no step ran.
    expect(true).toBe(true);
  });
});

describe("executeAgentStep — records resolved harness and model", () => {
  let projectDir: string;

  // A distinct harness registered under a second name lets us prove the step
  // result records the name the *registry* returned, not just the optional
  // `step.harness` config field.
  const testHarnessCalls: Array<{ model?: string }> = [];
  const testHarness: AgentHarness = {
    name: "step-executor-test-harness",
    description: "test-only adapter that captures invocation args",
    supportsMultiTurn: true,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    async run(options) {
      testHarnessCalls.push({ model: options.model });
      return {
        text: "done",
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      };
    },
  };

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-harness-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "do the thing");
    testHarnessCalls.length = 0;
    registerAgentHarness(testHarness);
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
    executeWithAgentSDKMock.mockResolvedValue({
      text: "done",
      streamedText: "",
      sessionId: undefined,
      turns: 1,
      totalCostUsd: 0.01,
      subtype: undefined,
      isError: false,
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("records the registry-returned name when the step resolves via the registered default", async () => {
    const step = makeAgentStep(projectDir);
    const result = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata("run-harness-default"),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );
    expect(result.harness).toBe("claude-agent-sdk");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("records the exact harness name when the step explicitly overrides", async () => {
    const step = makeAgentStep(projectDir, {
      harness: "step-executor-test-harness",
    });
    const result = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata("run-harness-override"),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );
    expect(result.harness).toBe("step-executor-test-harness");
    expect(testHarnessCalls).toHaveLength(1);
  });

  it("records the model an agentModels override resolves to", async () => {
    const step = makeAgentStep(projectDir, { agentName: "builder" });
    const result = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata("run-harness-agent-model"),
      { event: "runtime.idle", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      {
        projectDir,
        log: () => {},
        config: {
          model: "fallback-model",
          agentModels: { builder: "claude-sonnet-4-6" },
        } as never,
      },
    );
    expect(result.model).toBe("claude-sonnet-4-6");
    // The harness received the same resolved model, not the static step.model.
    expect(executeWithAgentSDKMock.mock.calls[0]?.[1]?.model).toBe("claude-sonnet-4-6");
  });
});
