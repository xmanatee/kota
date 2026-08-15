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
  let projectDir: string;
  let agentConfig: AgentStepConfig;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { projectDir };
    mockedExecuteWithAgentSDK.mockReset();
  });

  it("completes successfully", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const result = await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    expect(result.output).toMatchObject({ content: "done", turns: 1 });
    expect(result.harness).toBe("claude-agent-sdk");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("exposes ask_owner to agent steps through the SDK MCP bridge", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const options = mockedExecuteWithAgentSDK.mock.calls[0]?.[1];
    expect(options?.mcpServers).toHaveProperty(KOTA_OWNER_QUESTIONS_MCP_SERVER);
  });

  it("passes the daemon host-control guard to workflow agent steps", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const guard = mockedExecuteWithAgentSDK.mock.calls[0]?.[1]?.canUseTool;
    expect(guard).toEqual(expect.any(Function));
    const denied = await guard?.("Bash", { command: "pnpm kota daemon stop" }, {
      signal: new AbortController().signal,
      toolUseId: "tool-1",
    });
    expect(denied).toMatchObject({ behavior: "deny" });
    expect(denied).not.toHaveProperty("interrupt");
  });

  it("keeps ask_owner available when an agent step has an allowedTools list", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir, { allowedTools: ["Read"] }),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const options = mockedExecuteWithAgentSDK.mock.calls[0]?.[1];
    expect(options?.allowedTools).toEqual(["Read", KOTA_OWNER_QUESTIONS_MCP_TOOL]);
  });

  it("keeps ask_owner available when an agent step has a disallowedTools list", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir, { disallowedTools: ["Bash", KOTA_OWNER_QUESTIONS_MCP_TOOL] }),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const options = mockedExecuteWithAgentSDK.mock.calls[0]?.[1];
    expect(options?.disallowedTools).toEqual(["Bash"]);
  });

  it("aborts when the provided abort controller is triggered externally", async () => {
    const abortController = new AbortController();

    mockedExecuteWithAgentSDK.mockImplementation((_prompt, options) => {
      return new Promise<typeof SUCCESS_RESULT>((_resolve, reject) => {
        options?.abortController?.signal.addEventListener("abort", () => {
          reject(options!.abortController!.signal.reason);
        });
      });
    });

    const step = makeStep(projectDir);
    const rejectReason = new Error("external abort");
    setTimeout(() => abortController.abort(rejectReason), 10);

    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        abortController,
        () => {},
        () => {},
        agentConfig,
      ),
    ).rejects.toThrow("external abort");

    expect(abortController.signal.aborted).toBe(true);
  });

});
