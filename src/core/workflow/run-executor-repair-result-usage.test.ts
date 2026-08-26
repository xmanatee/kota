import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { EventBus } from "#core/events/event-bus.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";

function makeRunContext(
  projectDir: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = projectDir,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    project: { id: "test-project", root: projectDir },
    workflow: "test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: projectDir,
      workspaceDir,
      tempDir: projectDir,
      artifactDir: projectDir,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: projectDir,
      tempDir: projectDir,
      artifactDir: projectDir,
      agentDir: projectDir,
      packageCacheDir: projectDir,
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}



const HARNESS = "workflow-repair-result-error-usage";
const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

function makeAgentStep(projectDir: string): WorkflowAgentStep {
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
  return {
    id: "agent",
    type: "agent",
    harness: HARNESS,
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
    repairLoop: {
      maxRepairAttempts: 1,
      checks: [{
        id: "post-check",
        type: "code",
        run: () => {
          throw new Error("still failing");
        },
      }],
    },
  };
}

function makeDefinition(projectDir: string): WorkflowDefinition {
  return {
    name: "repair-result-usage",
    enabled: true,
    repository: "none",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: projectDir,
    triggers: [],
    steps: [makeAgentStep(projectDir)],
    tags: [],
  };
}

describe("run executor repair-result usage", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-run-executor-repair-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("records failed repair-result usage and provider backoff on the run", async () => {
    let attempts = 0;
    registerAgentHarness({
      name: HARNESS,
      description: "workflow repair-result usage test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "kota",
      run: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            text: "done",
            streamedText: "done",
            turns: 1,
            inputTokens: 10,
            outputTokens: 2,
            isError: false,
          };
        }
        return {
          text: "Individual quota reached. Resets in 1h.",
          streamedText: "",
          turns: 1,
          inputTokens: 31,
          outputTokens: 4,
          subtype: "antigravity_cli_error",
          isError: true,
        };
      },
    });

    const result = await executeWorkflowRun(makeDefinition(projectDir), TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: makeRunContext(projectDir, TRIGGER),
      bus: new EventBus(),
      store: new WorkflowRunStore(projectDir),
      log: vi.fn(),
    }).promise;

    expect(result.metadata).toMatchObject({
      status: "failed",
      inputTokens: 41,
      outputTokens: 6,
      steps: [{
        status: "failed",
        inputTokens: 41,
        outputTokens: 6,
        output: {
          inputTokens: 41,
          outputTokens: 6,
          repairIterations: [{
            agentInputTokens: 31,
            agentOutputTokens: 4,
            agentError: expect.stringContaining("Individual quota reached"),
          }],
        },
      }],
    });
    expect(result.agentBackoff).toMatchObject({ kind: "rate_limit" });
    expect(attempts).toBe(2);
  }, 10_000);
});
