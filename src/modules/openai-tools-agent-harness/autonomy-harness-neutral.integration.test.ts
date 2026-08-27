/**
 * Integration test: prove that an autonomy agent step executed via the
 * workflow step-executor, and an autonomy judge executed via the critic
 * repair check, both flow through the `openai-tools` harness without
 * triggering the adapter's unsupported-option boundary.
 *
 * This is the regression guard for the "harness-neutral autonomy" contract:
 * switching `defaultAgentHarness` to `"openai-tools"` must not leak claude
 * options through the step-executor or the judge wrapper.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import { registerModelClientFactory } from "#core/model/model-client.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import {
  type CriticReviewInspectionInput,
  inspectCriticReviewInWorker,
} from "#modules/autonomy/review-input-operations.js";
import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { OPENAI_TOOLS_AGENT_HARNESS_NAME } from "./index.js";

function makeDefinition(): WorkflowDefinition {
  return {
    name: "builder",
    enabled: true,
    repository: "read",
    tags: [],
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
  };
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-openai-ok",
    workflow: "builder",
    runDir: ".kota/runs/run-openai-ok",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
  };
}

function makeAgentStep(moduleRoot: string): WorkflowAgentStep {
  // Intentionally no harnessOptions block — those per-harness options are
  // only valid on the resolved harness and the openai-tools adapter rejects
  // unsupported harness-private options that leak through its boundary.
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot,
    model: "openai/gpt-5.6-luna",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: OPENAI_TOOLS_AGENT_HARNESS_NAME,
  };
}

function stubTextResponse(text: string): KotaModelResponse {
  return {
    id: "msg-ok",
    role: "assistant",
    model: "openai/gpt-5.6-luna",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
}

describe("autonomy agent steps and judges on openai-tools", () => {
  const streamMock = vi.fn();
  const createMock = vi.fn();

  beforeEach(() => {
    streamMock.mockReset();
    createMock.mockReset();
    registerModelClientFactory(({ model }) => ({
      client: { messages: { create: createMock, stream: streamMock } },
      model,
      providerName: "test",
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs a representative workflow agent step without leaking unsupported adapter options", async () => {
    const scopeRoot = join(
      tmpdir(),
      `kota-openai-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    writeFileSync(join(scopeRoot, "prompt.md"), "Stay focused on the build.");
    // Seed a project instruction file so the harness-neutral system-prompt
    // builder composes a non-empty portable text and we can prove it reached
    // the adapter as a string rather than a claude-preset envelope.
    writeFileSync(
      join(scopeRoot, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(scopeRoot, ".kota/runs/run-openai-ok"), { recursive: true });
    mkdirSync(join(scopeRoot, ".kota/runs/run-openai-ok/steps"), { recursive: true });

    streamMock.mockReturnValue({
      on(event: string, cb: (delta: string) => void) {
        if (event === "text") cb("done");
        return this;
      },
      finalMessage: async () => stubTextResponse("done"),
    });

    const result = await executeAgentStep(
      makeDefinition(),
      makeAgentStep(scopeRoot),
      makeMetadata(),
      { event: "autonomy.queue.available", schemaRef: null, payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { scopeRoot, log: () => {} },
    );

    expect(result.harness).toBe(OPENAI_TOOLS_AGENT_HARNESS_NAME);
    expect(streamMock).toHaveBeenCalledTimes(1);
    const streamArgs = streamMock.mock.calls[0][0] as Record<string, unknown>;
    // The openai-tools adapter would throw loudly if any unsupported
    // option leaked through; reaching this assertion means the boundary
    // stayed neutral.
    expect(streamArgs.model).toBe("openai/gpt-5.6-luna");
    // System prompt must reach the adapter as a plain string carrying the
    // portable instruction and autonomous-agent-instructions sections — not a
    // claude-SDK preset envelope.
    expect(typeof streamArgs.system).toBe("string");
    const systemText = streamArgs.system as string;
    expect(systemText).not.toContain('"preset"');
    expect(systemText).toContain("Project AGENTS");
    expect(systemText).toContain("Portable project rules live here.");
    expect(systemText).toContain("## Autonomous Agent Instructions");
    expect(systemText).toContain("Stay focused on the build.");
  });

  it("runs the autonomy critic judge through the openai-tools harness", async () => {
    const scopeRoot = join(
      tmpdir(),
      `kota-openai-harness-critic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: scopeRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["config", "user.name", "Test User"], {
      cwd: scopeRoot,
    });
    execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
      cwd: scopeRoot,
    });
    const tasksDir = join(scopeRoot, "data/tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(
      join(tasksDir, "task-openai-judge.md"),
      "---\nstatus: open\npriority: p2\n---\n\n# OpenAI judge\n\nContent.",
    );
    const runDir = join(scopeRoot, ".kota/runs/run-critic");
    mkdirSync(runDir, { recursive: true });

    streamMock.mockReturnValue({
      on(event: string, cb: (delta: string) => void) {
        if (event === "text")
          cb(
            '{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"ok"}',
          );
        return this;
      },
      finalMessage: async () =>
        stubTextResponse(
          '{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"ok"}',
        ),
    });

    // Call the critic with no explicit harness override — instead, thread the
    // parent step's resolved harness (the same value the validator would have
    // populated from `config.defaultAgentHarness`). This is the production
    // resolution path: the judge inherits the harness its enclosing agent
    // step runs on.
    const check = createCriticCheck({
      runDirPath: runDir,
      model: "openai/gpt-5.6-luna",
    });

    const parentStep = makeAgentStep(scopeRoot);
    const result = await (
      check as {
        run: (ctx: unknown, step: unknown) => Promise<string>;
      }
    ).run(
      {
        scopeRoot,
        workspaceRoot: scopeRoot,
        workflow: {
          name: "builder",
          runId: "run-critic",
          runDirPath: runDir,
          definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        },
        trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
        stepOutputs: {},
        stepResults: {},
        runBlocking: async (
          _operation: { exportName: string },
          input: CriticReviewInspectionInput,
        ) => inspectCriticReviewInWorker(input),
        runCommand: successfulWorkflowCommandRun,
        runTool: vi.fn(),
        runAgentHarness: createWorkflowAgentHarnessRunner(undefined),
        emit: vi.fn(),
        requestRestart: vi.fn(),
        readPrompt: vi.fn(),
        triggerWorkflow: vi.fn(),
        readRuntimeState: vi.fn(),
      },
      parentStep,
    );

    expect(result).toMatch(/pass/);
    expect(streamMock).toHaveBeenCalledTimes(1);
    // Judge systemPrompt must reach the adapter as a plain string — the
    // critic's role prompt — with no claude-preset envelope leaking through.
    const judgeStreamArgs = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof judgeStreamArgs.system).toBe("string");
    const judgeSystemText = judgeStreamArgs.system as string;
    expect(judgeSystemText).not.toContain('"preset"');
    expect(judgeSystemText).toContain("independent code review critic");
  });
});
