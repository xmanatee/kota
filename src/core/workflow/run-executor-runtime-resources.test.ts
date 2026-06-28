import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function registerWorkflowTestHarness(
  name: string,
  run: AgentHarness["run"],
): void {
  registerAgentHarness({
    name,
    description: "workflow runtime resource test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: true,
    toolControl: "kota",
    run,
  });
}

function makeAgentStep(
  projectDir: string,
  harness: string,
): WorkflowAgentStep {
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
  };
}

describe("workflow runtime resources", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-run-executor-resources-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("updates runtime resources from an explicit top-level code step", async () => {
    const harness = "workflow-runtime-resources";
    let agentOptions: AgentHarnessRunOptions | undefined;
    registerWorkflowTestHarness(harness, async (options: AgentHarnessRunOptions) => {
      agentOptions = options;
      return AGENT_OK_RESULT;
    });
    let toolEnv: Record<string, string> | undefined;
    const runtimeResources = {
      profileId: "profile-1",
      tempRoot: join(projectDir, ".kota", "tmp", "profile-1"),
      artifactRoot: join(projectDir, ".kota", "runs", "run-1", "artifacts"),
      ports: { start: 41_000, end: 41_019 },
      env: {
        KOTA_RUNTIME_PROFILE_ID: "profile-1",
        KOTA_PORT_BASE: "41000",
      },
    };
    const definition = makeDefinition({
      moduleRoot: projectDir,
      steps: [
        {
          id: "prepare-resources",
          type: "code",
          updatesRuntimeResources: true,
          run: () => ({ runtimeResources }),
        },
        {
          id: "inspect",
          type: "code",
          run: async (ctx) => {
            await ctx.runTool("capture", {});
            return {
              profileId: ctx.runtimeResources?.profileId,
              envValue: ctx.runtimeResources?.env.KOTA_PORT_BASE,
            };
          },
        },
        makeAgentStep(projectDir, harness),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      runTool: async (_name, _input, context) => {
        toolEnv = context?.env;
        return { content: "ok" };
      },
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[1]?.output).toEqual({
      profileId: "profile-1",
      envValue: "41000",
    });
    expect(toolEnv?.KOTA_PORT_BASE).toBe("41000");
    expect(agentOptions?.env?.KOTA_PORT_BASE).toBe("41000");
  }, 10_000);
});
