/**
 * Integration test: prove an autonomy agent step executed via the workflow
 * step-executor flows through the `gemini` harness without triggering the
 * adapter's claude-specific rejection list, with the Google Gen AI SDK
 * mocked.
 *
 * This is the regression guard for the "harness-neutral autonomy" contract:
 * switching `defaultAgentHarness` to `"gemini"` must not leak claude options
 * through the step-executor.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";

const generateContentStreamMock = vi.fn();

// Hoist `node:child_process` mock so the critic's git execFileSync stays silent.
const execFileSyncMock = vi.hoisted(() => vi.fn(() => ""));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, execFileSync: execFileSyncMock };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(this: unknown) {
    (this as { models: unknown }).models = {
      generateContentStream: (...args: unknown[]) =>
        generateContentStreamMock(...args),
    };
  },
}));

import "../claude-agent-harness/index.js";
import "./index.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { GEMINI_AGENT_HARNESS_NAME } from "./index.js";

function makeStream(chunks: ReadonlyArray<Record<string, unknown>>) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
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
    id: "run-gemini-ok",
    workflow: "builder",
    runDir: ".kota/runs/run-gemini-ok",
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
    model: "gemini-2.5-flash",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness: GEMINI_AGENT_HARNESS_NAME,
  };
}

describe("autonomy agent step on gemini", () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs a representative workflow agent step without the gemini adapter rejecting claude-specific options", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-gemini-harness-step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "Stay focused on the build.");
    writeFileSync(
      join(projectDir, "AGENTS.md"),
      "# Project AGENTS\n\nPortable project rules live here.",
    );
    mkdirSync(join(projectDir, ".kota/runs/run-gemini-ok"), { recursive: true });
    mkdirSync(join(projectDir, ".kota/runs/run-gemini-ok/steps"), {
      recursive: true,
    });

    generateContentStreamMock.mockResolvedValue(
      makeStream([
        {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "done" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          responseId: "step-1",
        },
      ]),
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

    expect(result.harness).toBe(GEMINI_AGENT_HARNESS_NAME);
    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentStreamMock.mock.calls[0][0] as {
      config: { systemInstruction?: string; thinkingConfig?: Record<string, unknown> };
    };
    // System prompt must reach the adapter as a plain string carrying the
    // portable instruction and autonomous-agent-instructions sections — not
    // a claude-SDK preset envelope.
    const system = callArgs.config.systemInstruction;
    expect(typeof system).toBe("string");
    expect(system as string).not.toContain('"preset"');
    expect(system as string).toContain("Project AGENTS");
    expect(system as string).toContain("Portable project rules live here.");
    expect(system as string).toContain("## Autonomous Agent Instructions");
    expect(system as string).toContain("Stay focused on the build.");
    // Effort mapping reaches the adapter.
    expect(callArgs.config.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
  });
});
