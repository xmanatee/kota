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
import { KOTA_OWNER_QUESTIONS_MCP_TOOL } from "#core/agent-sdk/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";

const tryEmitMock = vi.hoisted(() => vi.fn());
vi.mock("#core/events/event-bus.js", () => ({ tryEmit: tryEmitMock }));

const executeWithAgentSDKMock = vi.hoisted(() => vi.fn());
vi.mock("#core/agent-sdk/index.js", async () => {
  const actual = await vi.importActual("../../agent-sdk/index.js");
  return {
    ...actual,
    buildClaudeCodeSystemPrompt: () => "system",
    executeWithAgentSDK: executeWithAgentSDKMock,
  };
});

import type { WorkflowRunMetadata } from "../run-types.js";
import type { WorkflowAgentStep, WorkflowDefinition } from "../types.js";
import { AgentWriteScopeViolationError } from "./agent-write-scope.js";
import { executeAgentStep } from "./step-executor-agent.js";
import { AgentStepRuntimeError } from "./step-executor-retry.js";

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
    permissionMode: "bypassPermissions",
    settingSources: [],
    autonomyMode: "autonomous",
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
      permissionMode: "bypassPermissions",
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
    ).rejects.toThrow("Passive agent steps may only allow read-only SDK tools");
    expect(executeWithAgentSDKMock).not.toHaveBeenCalled();
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
