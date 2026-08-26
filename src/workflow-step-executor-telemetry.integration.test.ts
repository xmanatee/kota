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

describe("executeAgentStep", () => {
  let scopeRoot: string;
  let agentConfig: AgentStepConfig;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-step-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(scopeRoot, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(scopeRoot, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { scopeRoot };
    mockedExecuteWithAgentSDK.mockReset();
  });

  describe("tool telemetry artifact", () => {
    it("writes tool-telemetry.json when tool calls were recorded via SDK messages", async () => {
      const largeResult = "x".repeat(8192);
      mockedExecuteWithAgentSDK.mockImplementation(async (_prompt, options) => {
        options?.onMessage?.({
          type: "tool_call",
          toolUseId: "tu-1",
          toolName: "shell",
          input: { command: "printf big" },
        });
        options?.onMessage?.({
          type: "tool_call",
          toolUseId: "tu-2",
          toolName: "file_read",
          input: { path: "/missing.txt" },
        });
        options?.onMessage?.({
          type: "tool_call",
          toolUseId: "tu-3",
          toolName: "grep",
          input: { pattern: "TODO" },
        });
        options?.onMessage?.({
          type: "tool_result",
          toolUseId: "tu-1",
          isError: false,
          content: largeResult,
        });
        options?.onMessage?.({
          type: "tool_result",
          toolUseId: "tu-2",
          isError: true,
          content: "not found",
        });
        return SUCCESS_RESULT;
      });
      mkdirSync(join(scopeRoot, ".kota", "runs", "run-1", "steps"), { recursive: true });

      await executeAgentStep(
        makeDefinition(),
        makeStep(scopeRoot),
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      );

      const telemetryPath = join(scopeRoot, ".kota", "runs", "run-1", "steps", "test-step.tool-telemetry.json");
      expect(existsSync(telemetryPath)).toBe(true);
      const data = JSON.parse(readFileSync(telemetryPath, "utf-8"));
      expect(data.summary).toContain("2 tool calls");
      expect(data.tools.shell).toMatchObject({ calls: 1, successes: 1, failures: 0 });
      expect(data.tools.file_read).toMatchObject({ calls: 1, failures: 1, lastError: "not found" });
      expect(data.calls).toHaveLength(3);
      expect(data.calls[0]).toMatchObject({
        toolUseId: "tu-1",
        tool: "shell",
        inputBytes: Buffer.byteLength(JSON.stringify({ command: "printf big" }), "utf-8"),
        resultBytes: Buffer.byteLength(largeResult, "utf-8"),
        resultContentKind: "text",
        success: true,
        truncated: false,
        incomplete: false,
      });
      expect(data.calls[1]).toMatchObject({
        toolUseId: "tu-2",
        tool: "file_read",
        inputBytes: Buffer.byteLength(JSON.stringify({ path: "/missing.txt" }), "utf-8"),
        resultBytes: Buffer.byteLength("not found", "utf-8"),
        resultContentKind: "text",
        success: false,
        truncated: false,
        incomplete: false,
      });
      expect(data.calls[2]).toMatchObject({
        toolUseId: "tu-3",
        tool: "grep",
        inputBytes: Buffer.byteLength(JSON.stringify({ pattern: "TODO" }), "utf-8"),
        truncated: false,
        incomplete: true,
      });
      expect(data.calls[2]).not.toHaveProperty("durationMs");
      expect(JSON.stringify(data.calls)).not.toContain(largeResult.slice(0, 20));
    });

    it("skips writing when no tool calls were recorded", async () => {
      mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);
      mkdirSync(join(scopeRoot, ".kota", "runs", "run-1", "steps"), { recursive: true });

      await executeAgentStep(
        makeDefinition(),
        makeStep(scopeRoot),
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      );

      const telemetryPath = join(scopeRoot, ".kota", "runs", "run-1", "steps", "test-step.tool-telemetry.json");
      expect(existsSync(telemetryPath)).toBe(false);
    });
  });
});
