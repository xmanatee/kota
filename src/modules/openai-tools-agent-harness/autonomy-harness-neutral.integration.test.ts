/**
 * Integration test: prove that an autonomy agent step executed via the
 * workflow step-executor, and an autonomy judge executed via the critic
 * repair check, both flow through the `openai-tools` harness without
 * triggering the adapter's claude-specific rejection list (mcpServers,
 * non-`bypass` permissionMode, settingSources).
 *
 * This is the regression guard for the "harness-neutral autonomy" contract:
 * switching `defaultAgentHarness` to `"openai-tools"` must not leak claude
 * options through the step-executor or the judge wrapper.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import { registerModelClientFactory } from "#core/model/model-client.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";

// Silence git shell-outs inside the critic: the temp project directories used
// here are not git repos, but the critic unconditionally shells out to
// `git diff --cached`. Mocking at the module level (hoisted) lets vi swap the
// execFileSync binding before any import in the critic module resolves it.
const execFileSyncMock = vi.hoisted(() => vi.fn(() => ""));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, execFileSync: execFileSyncMock };
});

import { createCriticCheck } from "#modules/autonomy/critic.js";
import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { OPENAI_TOOLS_AGENT_HARNESS_NAME } from "./index.js";

function makeDefinition(): WorkflowDefinition {
  return {
    name: "builder",
    enabled: true,
    recoveryCapable: false,
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
    trigger: { event: "autonomy.queue.available", payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
  };
}

function makeAgentStep(moduleRoot: string): WorkflowAgentStep {
  // Intentionally no harnessOptions block — those per-harness options are
  // only valid on the resolved harness and the openai-tools adapter rejects
  // any claude-specific wire options that leak through its boundary.
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot,
    model: "openai/gpt-4o-mini",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: OPENAI_TOOLS_AGENT_HARNESS_NAME,
  };
}

function stubTextResponse(text: string): KotaModelResponse {
  return {
    id: "msg-ok",
    role: "assistant",
    model: "openai/gpt-4o-mini",
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

  it("runs a representative workflow agent step without the openai-tools adapter rejecting claude-specific options", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-openai-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "Stay focused on the build.");
    // Seed a project instruction file so the harness-neutral system-prompt
    // builder composes a non-empty portable text and we can prove it reached
    // the adapter as a string rather than a claude-preset envelope.
    writeFileSync(
      join(projectDir, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(projectDir, ".kota/runs/run-openai-ok"), { recursive: true });
    mkdirSync(join(projectDir, ".kota/runs/run-openai-ok/steps"), { recursive: true });

    streamMock.mockReturnValue({
      on(event: string, cb: (delta: string) => void) {
        if (event === "text") cb("done");
        return this;
      },
      finalMessage: async () => stubTextResponse("done"),
    });

    const result = await executeAgentStep(
      makeDefinition(),
      makeAgentStep(projectDir),
      makeMetadata(),
      { event: "autonomy.queue.available", payload: {} },
      new AbortController(),
      () => {},
      () => {},
      { projectDir, log: () => {} },
    );

    expect(result.harness).toBe(OPENAI_TOOLS_AGENT_HARNESS_NAME);
    expect(streamMock).toHaveBeenCalledTimes(1);
    const streamArgs = streamMock.mock.calls[0][0] as Record<string, unknown>;
    // The openai-tools adapter would throw loudly if any claude-specific
    // option leaked through; reaching this assertion means the boundary
    // stayed neutral.
    expect(streamArgs.model).toBe("openai/gpt-4o-mini");
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
    const projectDir = join(
      tmpdir(),
      `kota-openai-harness-critic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const doingDir = join(projectDir, "data/tasks/doing");
    mkdirSync(doingDir, { recursive: true });
    writeFileSync(
      join(doingDir, "task-openai-judge.md"),
      "---\ntitle: Openai judge\n---\nContent.",
    );
    const runDir = join(projectDir, ".kota/runs/run-critic");
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
      model: "openai/gpt-4o-mini",
    });

    const parentStep = makeAgentStep(projectDir);
    const result = await (
      check as {
        run: (ctx: unknown, step: unknown) => Promise<string>;
      }
    ).run(
      {
        projectDir,
        workflow: {
          name: "builder",
          runId: "run-critic",
          runDirPath: runDir,
          definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        },
        trigger: { event: "autonomy.queue.available", payload: {} },
        stepOutputs: {},
        stepResults: {},
        runTool: vi.fn(),
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
    expect(judgeSystemText).toContain("calibrated code review critic");
  });
});
