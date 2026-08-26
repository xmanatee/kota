import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { createStepContext } from "#core/workflow/steps/step-context.js";
import { unexpectedWorkflowAgentHarnessRun } from "#core/workflow/testing/agent-harness-runner.js";
import { createTestRunContext } from "#core/workflow/testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { fileWriteTool, runFileWrite } from "#modules/filesystem/file-write.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";

const TOOL_NAME = "workflow_authority_file_write_fixture";
const roots: string[] = [];

afterEach(() => {
  deregisterTool(TOOL_NAME);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workflow machine-authority isolation", () => {
  it("threads the machine config path into actual workflow filesystem execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-workflow-authority-"));
    roots.push(root);
    const projectDir = join(root, "project");
    const authorityConfigPath = join(root, "operator", "config.json");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(root, "operator"), { recursive: true });
    writeFileSync(authorityConfigPath, "operator-owned\n");
    registerTool(
      { ...fileWriteTool, name: TOOL_NAME },
      runFileWrite,
      "workflow-scope-authority-test",
      { effect: localWriteEffect() },
    );
    const bus = new EventBus();
    const context = createStepContext(
      metadata(),
      trigger,
      undefined,
      {},
      {},
      [],
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        projectDir,
        scopeDir: projectDir,
        authorityConfigPath,
        bus,
        pbus: new ProjectScopedEventBus(bus, "scope-a"),
        store: new WorkflowRunStore(projectDir),
        runContext: createTestRunContext(projectDir, trigger),
        runAgentHarness: unexpectedWorkflowAgentHarnessRun,
        currentStepId: "mutate",
      },
    );

    await expect(context.runTool(TOOL_NAME, {
      path: authorityConfigPath,
      content: "project-controlled\n",
    })).rejects.toThrow(/operator-owned machine authority cannot be changed/);
    expect(readFileSync(authorityConfigPath, "utf8")).toBe("operator-owned\n");
  });
});

const trigger: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

function metadata(): WorkflowRunMetadata {
  return {
    id: "workflow-authority-run",
    workflow: "workflow-authority-fixture",
    definitionPath: "workflow.ts",
    trigger,
    startedAt: "2026-08-02T00:00:00.000Z",
    status: "running",
    runDir: ".kota/runs/workflow-authority-run",
    steps: [],
  };
}
