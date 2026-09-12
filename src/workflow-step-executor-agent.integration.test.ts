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
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
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

registerAgentHarness(claudeAgentHarness);

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
    repository: "read",
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
    trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
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

// Adapter composition: correction feedback and resolved model must reach the SDK;
// decoding cases live with run-executor-agent-output and JSON/schema owners.
describe("executeAgentStep — schema validation feedback on retry", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-step-executor-schema-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    writeFileSync(join(scopeRoot, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
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

    const step = makeAgentStep(scopeRoot, {
      id: "analyze",
      agentName: "builder",
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
      { event: "runtime.idle", schemaRef: null, payload: {} },
      new AbortController(),
      () => {},
      () => {},
      {
        scopeRoot,
        log: () => {},
        config: { model: "fallback-model", agentModels: { builder: "claude-sonnet-4-6" } } as never,
      },
    );

    expect(result.output).toEqual({ status: "ok", count: 3 });
    expect(result.harness).toBe("claude-agent-sdk");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(executeWithAgentSDKMock.mock.calls.map((call) => call[1].model))
      .toEqual(["claude-sonnet-4-6", "claude-sonnet-4-6"]);
    expect(capturedPrompts).toHaveLength(2);
    expect(capturedPrompts[0]).not.toContain("Previous output failed schema validation");
    expect(capturedPrompts[1]).toContain("Previous output failed schema validation");
    expect(capturedPrompts[1]).toContain("count");
  });

});

describe("executeAgentStep — provider errors from SDK result", () => {
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-step-executor-provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    writeFileSync(join(scopeRoot, "prompt.md"), "do the thing");
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
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

    const step = makeAgentStep(scopeRoot, {
      id: "build",
      retry: { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 },
    });

    let caught: unknown;
    try {
      await executeAgentStep(
        makeDefinition("builder"),
        step,
        makeMetadata(),
        { event: "runtime.idle", schemaRef: null, payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { scopeRoot, log: () => {} },
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
  let scopeRoot: string;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-step-executor-permissions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    writeFileSync(join(scopeRoot, "prompt.md"), "do the thing");
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
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("limits passive agent steps to read-only SDK tools", async () => {
    const step = makeAgentStep(scopeRoot, {
      autonomyMode: "passive",
      allowedTools: undefined,
      disallowedTools: undefined,
    });

    await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      { event: "runtime.idle", schemaRef: null, payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { scopeRoot, log: () => {} },
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
    const step = makeAgentStep(scopeRoot, {
      autonomyMode: "passive",
      allowedTools: ["Read", "Bash"],
    });

    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        { event: "runtime.idle", schemaRef: null, payload: {} },
        new AbortController(),
        () => {},
        () => {},
        { scopeRoot, log: () => {} },
      ),
    ).rejects.toThrow("Passive agent steps may only allow read-only tools");
    expect(executeWithAgentSDKMock).not.toHaveBeenCalled();
  });
});

describe("executeAgentStep — writeScope enforcement", () => {
  let scopeRoot: string;

  function initRepo(dir: string) {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
    mkdirSync(join(dir, "data", "tasks"), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", "baseline.md"), "seed\n");
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
    scopeRoot = join(
      tmpdir(),
      `kota-step-executor-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    initRepo(scopeRoot);
    tryEmitMock.mockReset();
    executeWithAgentSDKMock.mockReset();
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("fails with the offending paths when writes escape the declared writeScope", async () => {
    executeWithAgentSDKMock.mockImplementation(async () => {
      writeTracked(scopeRoot, "src/core/keep.ts", "// modified\n");
      writeTracked(scopeRoot, "AGENTS.md", "root agents\n");
      writeTracked(scopeRoot, "data/tasks/new-task.md", "ok\n");
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
    const step = makeAgentStep(scopeRoot, {
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
        { event: "autonomy.queue.empty", schemaRef: null, payload: {} },
        new AbortController(),
        () => {},
        () => {},
        {
          scopeRoot,
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
      scopeRoot,
      ".kota/runs/run-001/steps/explore.write-scope-violation.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(parsed.violations).toEqual(["AGENTS.md", "src/core/keep.ts"]);
    expect(parsed.agentName).toBe("explorer");
    expect(parsed.stepId).toBe("explore");
  });

  it("restores every attempted mutation for an explicit deny-all writeScope", async () => {
    writeTracked(scopeRoot, "src/core/keep.ts", "// legitimate staged dirt\n");
    execFileSync("git", ["add", "src/core/keep.ts"], { cwd: scopeRoot });
    writeTracked(scopeRoot, "src/core/keep.ts", "// legitimate worktree dirt\n");
    executeWithAgentSDKMock.mockImplementation(() => {
      writeTracked(scopeRoot, "src/core/keep.ts", "// unauthorized\n");
      writeTracked(scopeRoot, "src/core/injected.ts", "// injected\n");
      return Promise.resolve({
        text: "done",
        streamedText: "",
        sessionId: undefined,
        turns: 1,
        totalCostUsd: 0.01,
        subtype: undefined,
        isError: false,
      });
    });
    const agent = makeAgentDef({
      name: "decomposer",
      writeScope: "deny-all",
    });
    const step = makeAgentStep(scopeRoot, {
      id: "decompose",
      agentName: agent.name,
      autonomyMode: "passive",
    });
    const initialHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: scopeRoot,
      encoding: "utf-8",
    }).trim();

    await expect(
      executeAgentStep(
        makeDefinition("decomposer"),
        step,
        makeMetadata("run-deny-all"),
        { event: "workflow.completed", schemaRef: null, payload: {} },
        new AbortController(),
        () => {},
        () => {},
        {
          scopeRoot,
          log: () => {},
          resolveAgentDef: () => agent,
        },
      ),
    ).rejects.toMatchObject({
      name: "AgentWriteScopeViolationError",
      scope: "deny-all",
      violations: ["src/core/injected.ts", "src/core/keep.ts"],
    });

    expect(readFileSync(join(scopeRoot, "src/core/keep.ts"), "utf-8")).toBe(
      "// legitimate worktree dirt\n",
    );
    expect(
      execFileSync("git", ["show", ":src/core/keep.ts"], {
        cwd: scopeRoot,
        encoding: "utf-8",
      }),
    ).toBe("// legitimate staged dirt\n");
    expect(existsSync(join(scopeRoot, "src/core/injected.ts"))).toBe(false);
    expect(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: scopeRoot,
        encoding: "utf-8",
      }).trim(),
    ).toBe(initialHead);
    expect(
      execFileSync("git", ["status", "--short", "--", "src/core"], {
        cwd: scopeRoot,
        encoding: "utf-8",
      }).trim(),
    ).toBe("MM src/core/keep.ts");
  });

});
