/**
 * Integration test: prove an autonomy agent step executed via the workflow
 * step-executor flows through the `vercel` harness without triggering the
 * adapter's claude-specific rejection list, with the Vercel AI SDK mocked.
 *
 * This is the regression guard for the "harness-neutral autonomy" contract:
 * switching `defaultAgentHarness` to `"vercel"` must not leak claude options
 * through the step-executor.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";

const streamTextMock = vi.fn();

// Hoist `node:child_process` mock so the critic's git execFileSync stays silent.
const execFileSyncMock = vi.hoisted(() => vi.fn(() => ""));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, execFileSync: execFileSyncMock };
});

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (n: number) => ({ __stepCountIs: n }),
  jsonSchema: (schema: unknown) => ({ __jsonSchema: schema }),
  dynamicTool: (definition: unknown) => definition,
}));

// Mock the OpenAI provider package; the streamText mock above never invokes
// the resolved language model, so a stub factory is enough to satisfy the
// adapter's import. Avoiding the real import sidesteps a Node 22 limitation
// where TypeScript stripping refuses to load `.ts` source under node_modules
// (eventsource-parser ships its dist as TypeScript source).
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({
    __languageModel: true,
    modelId,
  }),
}));

import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { VERCEL_AGENT_HARNESS_NAME } from "./index.js";

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
    id: "run-vercel-ok",
    workflow: "builder",
    runDir: ".kota/runs/run-vercel-ok",
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
    model: "openai/gpt-4o-mini",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: VERCEL_AGENT_HARNESS_NAME,
  };
}

describe("autonomy agent step on vercel", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs a representative workflow agent step without the vercel adapter rejecting claude-specific options", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-vercel-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "Stay focused on the build.");
    writeFileSync(
      join(projectDir, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(projectDir, ".kota/runs/run-vercel-ok"), { recursive: true });
    mkdirSync(join(projectDir, ".kota/runs/run-vercel-ok/steps"), {
      recursive: true,
    });

    streamTextMock.mockImplementation(
      (args: {
        onChunk: (event: { chunk: { type: string; text?: string } }) => void;
      }) => {
        args.onChunk({ chunk: { type: "text-delta", text: "done" } });
        return {
          text: Promise.resolve("done"),
          totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
          steps: Promise.resolve([{ response: { id: "step-1" } }]),
          finishReason: Promise.resolve("stop"),
        } as unknown;
      },
    );

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

    expect(result.harness).toBe(VERCEL_AGENT_HARNESS_NAME);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const streamArgs = streamTextMock.mock.calls[0][0] as Record<string, unknown>;
    // System prompt must reach the adapter as a plain string carrying the
    // portable instruction and autonomous-agent-instructions sections — not
    // a claude-SDK preset envelope.
    expect(typeof streamArgs.system).toBe("string");
    const systemText = streamArgs.system as string;
    expect(systemText).not.toContain('"preset"');
    expect(systemText).toContain("Project AGENTS");
    expect(systemText).toContain("Portable project rules live here.");
    expect(systemText).toContain("## Autonomous Agent Instructions");
    expect(systemText).toContain("Stay focused on the build.");
    // Provider options carry effort mapping for openai.
    expect(streamArgs.providerOptions).toEqual({
      openai: { reasoningEffort: "high" },
    });
  });
});
