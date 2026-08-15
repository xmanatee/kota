// biome-ignore-all lint/correctness/noUnusedImports: split integration suites share one runtime fixture
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { RepairAgentRuntimeError } from "#core/workflow/repair-loop.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowNotifyConfig } from "#core/workflow/step-input-base.js";
import type { WorkflowAgentStep, WorkflowEmitStep, WorkflowToolStep } from "#core/workflow/step-types.js";
import type { AgentStepConfig } from "#core/workflow/steps/step-executor.js";
import {
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  executeEmitStep,
  executeStep,
  executeToolStep,
  withRetry,
} from "#core/workflow/steps/step-executor.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import {
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#modules/claude-agent-harness/kota-tools-mcp.js";
import {
  makeDefinition,
  makeMetadata,
  makeStep,
  mockedExecuteWithAgentSDK,
  SUCCESS_RESULT,
  TRIGGER,
} from "./workflow-step-executor-fixture.integration.js";

describe("buildAgentPrompt", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-build-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
  });

  it("omits the exposed step outputs section when nothing is exposed", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Exposed step outputs:");
  });

  it("states that the agent should choose its own investigation path", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain("There is intentionally no fixed checklist here.");
  });

  it("points high-stakes decisions at the owner-question MCP tool", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain(KOTA_OWNER_QUESTIONS_MCP_TOOL);
  });

  it("omits non-exposed step outputs", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [{ id: "some-step", type: "code", run: async () => ({ ok: true }) }],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "some-step": { counts: { ready: 2 } } },
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Exposed step outputs:");
  });

  it("omits skipped exposed outputs", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [
          {
            id: "some-step",
            type: "code",
            run: async () => ({ ok: true }),
            exposeOutputToAgent: true,
          },
        ],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "some-step": { skipped: true } },
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Exposed step outputs:");
  });

  it("injects explicitly exposed step outputs into prompt", () => {
    const output = { counts: { ready: 3 }, actionableCount: 3 };
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [
          {
            id: "inspect-ready-queue",
            type: "code",
            run: async () => output,
            exposeOutputToAgent: true,
          },
        ],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "inspect-ready-queue": output },
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain("Exposed step outputs:");
    expect(prompt).toContain('<step id="inspect-ready-queue">');
    expect(prompt).toContain('"ready": 3');
  });

  it("injects multiple exposed step outputs in definition order", () => {
    const outputs = {
      "claim-task": { chosenTaskId: "task-demo" },
      "inspect-queue": { counts: { ready: 2 } },
    };
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [
          {
            id: "inspect-queue",
            type: "code",
            run: async () => ({ counts: { ready: 2 } }),
            exposeOutputToAgent: true,
          },
          {
            id: "claim-task",
            type: "code",
            run: async () => ({ chosenTaskId: "task-demo" }),
            exposeOutputToAgent: true,
          },
        ],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      outputs,
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    const inspectIdx = prompt.indexOf('<step id="inspect-queue">');
    const claimIdx = prompt.indexOf('<step id="claim-task">');
    expect(inspectIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(inspectIdx).toBeLessThan(claimIdx);
  });

  it("omits the trigger payload block when the payload is empty", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Trigger payload (untrusted data):");
  });

  it("includes the trigger payload block when the payload has runtime facts", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      { event: "workflow.completed", schemaRef: null, payload: { runId: "run-123" } },
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain("Trigger payload (untrusted data):");
    expect(prompt).toContain('"runId": "run-123"');
  });
});

