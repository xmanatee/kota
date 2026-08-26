import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarnessRuntimeProbeDeps,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { createTestRunContext } from "#core/workflow/testing/run-context-fixture.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  antigravityCliAgentHarness,
  antigravityCliReadiness,
} from "#modules/antigravity-cli-agent-harness/index.js";

const SELECTED_MODEL = "gemini-autonomy-readiness-candidate";

function unavailableHighEffortDeps(): AgentHarnessRuntimeProbeDeps {
  return {
    resolveBinary: () => ({
      status: "ready",
      executablePath: "/opt/bin/agy",
    }),
    readCommandVersion: () => ({
      status: "ready",
      version: "agy 2.0.0",
    }),
    readCommandOutput: () => ({
      status: "ready",
      output: `${SELECTED_MODEL}-medium`,
    }),
    readPackageVersion: () => ({ status: "error", detail: "not used" }),
  };
}

describe("AGY autonomy model/effort readiness", () => {
  let projectDir: string;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    projectDir = mkdtempSync(join(tmpdir(), "kota-agy-readiness-"));
    writeFileSync(join(projectDir, "prompt.md"), "Implement the task.\n");
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("rejects an unavailable effort-qualified selection before AGY launches", async () => {
    const run = vi.fn(antigravityCliAgentHarness.run);
    registerAgentHarness({
      ...antigravityCliAgentHarness,
      readiness: (request) =>
        antigravityCliReadiness(
          request,
          unavailableHighEffortDeps(),
          { platform: "linux" },
        ),
      run,
    });
    const step: WorkflowAgentStep = {
      id: "build",
      type: "agent",
      harness: antigravityCliAgentHarness.name,
      promptPath: "prompt.md",
      moduleRoot: projectDir,
      model: SELECTED_MODEL,
      effort: "xhigh",
      autonomyMode: "autonomous",
    };
    const definition: WorkflowDefinition = {
      name: "agy-readiness-preflight",
      enabled: true,
      repository: "read",
      definitionPath: "src/agy-model-readiness.integration.test.ts",
      moduleRoot: projectDir,
      triggers: [],
      steps: [step],
      tags: [],
    };
    const store = new WorkflowRunStore(projectDir);
    const { promise } = executeWorkflowRun(
      definition,
      { event: "manual", schemaRef: null, payload: {} },
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: createTestRunContext(projectDir, {
          event: "manual",
          schemaRef: null,
          payload: {},
        }),
        bus: new EventBus(),
        store,
        log: () => {},
      },
    );

    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]?.error).toContain("harness_readiness");
    expect(result.metadata.steps[0]?.error).toContain(
      `AGY model/effort ${SELECTED_MODEL}-high is unavailable`,
    );
    expect(run).not.toHaveBeenCalled();

    const capabilityPath = join(
      projectDir,
      result.metadata.runDir,
      "steps",
      "build.harness-capability.json",
    );
    const capability = JSON.parse(readFileSync(capabilityPath, "utf-8")) as {
      localReadiness: {
        modelEffort: {
          status: string;
          model: string;
          effort: string;
          adapterModel: string;
        };
      };
    };
    expect(capability.localReadiness.modelEffort).toEqual({
      kind: "model-effort",
      status: "unavailable",
      required: true,
      summary: `AGY model/effort ${SELECTED_MODEL}-high is unavailable`,
      model: SELECTED_MODEL,
      effort: "xhigh",
      adapterModel: `${SELECTED_MODEL}-high`,
    });
  });
});
