/**
 * Integration test: prove an autonomy agent step executed via the workflow
 * step-executor flows through the `codex` harness without triggering the
 * adapter's claude-specific rejection list, with the OpenAI Agents SDK
 * mocked.
 *
 * This is the regression guard for the "harness-neutral autonomy" contract:
 * switching `defaultAgentHarness` to `"codex"` must not leak claude options
 * through the step-executor.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  WorkflowAgentStep,
  WorkflowDefinition,
} from "#core/workflow/types.js";

type CapturedAgent = {
  name: string;
  instructions: string;
  model: string;
  modelSettings: { reasoning: { effort: string } };
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
    strict: boolean;
    execute: unknown;
  }>;
};

const runMock = vi.fn();
const agentCtorMock = vi.fn();

// Hoist `node:child_process` mock so the critic's git execFileSync stays silent.
const execFileSyncMock = vi.hoisted(() => vi.fn(() => ""));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, execFileSync: execFileSyncMock };
});

vi.mock("@openai/agents", () => ({
  Agent: function MockAgent(this: unknown, config: CapturedAgent) {
    agentCtorMock(config);
    Object.assign(this as Record<string, unknown>, config);
  },
  run: (...args: unknown[]) => runMock(...args),
  tool: (definition: Record<string, unknown>) => definition,
}));

import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { CODEX_AGENT_HARNESS_NAME } from "./index.js";

function makeRunResult(): unknown {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta: "done" },
      };
    },
    completed: Promise.resolve(),
    finalOutput: "done",
    rawResponses: [{ id: "step-1" }],
    lastResponseId: "step-1",
    runContext: { usage: { inputTokens: 1, outputTokens: 1 } },
  };
}

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
    id: "run-codex-ok",
    workflow: "builder",
    runDir: ".kota/runs/run-codex-ok",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: { event: "autonomy.queue.available", payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
  };
}

function makeAgentStep(moduleRoot: string): WorkflowAgentStep {
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot,
    model: "gpt-5-codex",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: CODEX_AGENT_HARNESS_NAME,
  };
}

describe("autonomy agent step on codex", () => {
  beforeEach(() => {
    runMock.mockReset();
    agentCtorMock.mockReset();
    runMock.mockResolvedValue(makeRunResult());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs a representative workflow agent step without the codex adapter rejecting claude-specific options", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-codex-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "Stay focused on the build.");
    writeFileSync(
      join(projectDir, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(projectDir, ".kota/runs/run-codex-ok"), { recursive: true });
    mkdirSync(join(projectDir, ".kota/runs/run-codex-ok/steps"), {
      recursive: true,
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

    expect(result.harness).toBe(CODEX_AGENT_HARNESS_NAME);
    expect(runMock).toHaveBeenCalledTimes(1);

    const config = agentCtorMock.mock.calls[0][0] as CapturedAgent;
    // System prompt must reach the adapter as a plain string carrying the
    // portable instruction and autonomous-agent-instructions sections — not
    // a claude-SDK preset envelope.
    expect(typeof config.instructions).toBe("string");
    expect(config.instructions).not.toContain('"preset"');
    expect(config.instructions).toContain("Project AGENTS");
    expect(config.instructions).toContain("Portable project rules live here.");
    expect(config.instructions).toContain("## Autonomous Agent Instructions");
    expect(config.instructions).toContain("Stay focused on the build.");
    // Effort mapping reaches the adapter.
    expect(config.modelSettings).toEqual({ reasoning: { effort: "xhigh" } });
    // Model name is forwarded verbatim.
    expect(config.model).toBe("gpt-5-codex");
  });
});
