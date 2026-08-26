import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "./control-monitor-coverage.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeRunContext(
  workspaceRoot: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = workspaceRoot,
  repositoryHeadSha?: string,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    scope: { id: "test-scope", root: workspaceRoot },
    workflow: "test",
    trigger,
    sandbox: repositoryHeadSha === undefined
      ? {
          runId,
          repository: "none",
          rootDir: workspaceRoot,
          workspaceDir,
          tempDir: workspaceRoot,
          artifactDir: workspaceRoot,
        }
      : {
          runId,
          repository: "read",
          baseCommit: repositoryHeadSha,
          rootDir: workspaceRoot,
          workspaceDir,
          tempDir: workspaceRoot,
          artifactDir: workspaceRoot,
        },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: workspaceRoot,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
      agentDir: workspaceRoot,
      packageCacheDir: workspaceRoot,
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



function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("control monitor coverage executor persistence", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-control-coverage-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("writes the artifact when the workflow executor finishes a run", async () => {
    const store = new WorkflowRunStore(workspaceRoot);
    const trigger: WorkflowRunTrigger = {
      event: "runtime.idle",
      schemaRef: null,
      payload: {},
    };
    const definition: WorkflowDefinition = {
      name: "coverage-smoke",
      enabled: true,
      repository: "none",
      definitionPath: "src/modules/test/workflows/coverage-smoke/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: [],
      steps: [
        {
          id: "noop",
          type: "code",
          run: () => ({ ok: true }),
        },
      ],
    };

    const { promise } = executeWorkflowRun(definition, trigger, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: makeRunContext(workspaceRoot, trigger, "executor-run"),
      bus: new EventBus(),
      store,
      log: vi.fn(),
    });
    const result = await promise;
    const artifactPath = join(
      workspaceRoot,
      result.metadata.runDir,
      CONTROL_MONITOR_COVERAGE_ARTIFACT,
    );
    const artifact =
      readOptionalJsonFile<ControlMonitorCoverageArtifact>(artifactPath);

    expect(existsSync(artifactPath)).toBe(true);
    expect(artifact).toMatchObject({
      run: {
        id: "executor-run",
        workflow: "coverage-smoke",
        status: "success",
        headSha: null,
      },
    });
  });

  it("uses the lifecycle-captured repository head without inspecting ambient Git", async () => {
    const store = new WorkflowRunStore(workspaceRoot);
    const trigger: WorkflowRunTrigger = {
      event: "runtime.idle",
      schemaRef: null,
      payload: {},
    };
    const definition: WorkflowDefinition = {
      name: "coverage-snapshot",
      enabled: true,
      repository: "read",
      definitionPath: "src/modules/test/workflows/coverage-snapshot/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: [],
      steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
    };

    const { promise } = executeWorkflowRun(definition, trigger, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: makeRunContext(
        workspaceRoot,
        trigger,
        "snapshot-run",
        workspaceRoot,
        "captured-head",
      ),
      bus: new EventBus(),
      store,
      log: vi.fn(),
    });
    const result = await promise;
    const artifact = readOptionalJsonFile<ControlMonitorCoverageArtifact>(
      join(workspaceRoot, result.metadata.runDir, CONTROL_MONITOR_COVERAGE_ARTIFACT),
    );

    expect(artifact?.run.headSha).toBe("captured-head");
  });

  it("refreshes linked source run coverage when an async reviewer finishes", async () => {
    const store = new WorkflowRunStore(workspaceRoot);
    const sourceDefinition: WorkflowDefinition = {
      name: "monitored-source",
      enabled: true,
      repository: "read",
      definitionPath: "src/modules/test/workflows/monitored-source/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: ["monitored"],
      steps: [
        {
          id: "noop",
          type: "code",
          run: () => ({ ok: true }),
        },
      ],
    };
    const reviewerDefinition: WorkflowDefinition = {
      name: "progress-reviewer",
      enabled: true,
      repository: "read",
      definitionPath: "src/modules/test/workflows/progress-reviewer/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: [],
      steps: [
        {
          id: "review",
          type: "code",
          run: (ctx) => {
            writeJson(join(ctx.workflow.runDirPath, "progress-review.json"), {
              verdict: "pass",
            });
            return { ok: true };
          },
        },
      ],
    };
    const bus = new EventBus();
    const sourceTrigger: WorkflowRunTrigger = {
      event: "runtime.idle",
      schemaRef: null,
      payload: {},
    };
    const sourceRun = await executeWorkflowRun(
      sourceDefinition,
      sourceTrigger,
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(
          workspaceRoot,
          sourceTrigger,
          "source-run",
          workspaceRoot,
          "source-head",
        ),
        bus,
        store,
        log: vi.fn(),
      },
    ).promise;
    const sourceCoveragePath = join(
      workspaceRoot,
      sourceRun.metadata.runDir,
      CONTROL_MONITOR_COVERAGE_ARTIFACT,
    );
    const initialCoverage =
      readOptionalJsonFile<ControlMonitorCoverageArtifact>(sourceCoveragePath);
    expect(initialCoverage?.run.headSha).toBe("source-head");
    expect(initialCoverage?.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "async-reviewers",
          status: "pending",
        }),
      ]),
    );

    const reviewerTrigger: WorkflowRunTrigger = {
        event: "workflow.batch.flushed",
        schemaRef: null,
        payload: {
          scopeId: "default",
          sourceEventName: "workflow.completed",
          groupingKey: "default",
          reason: "count",
          count: 1,
          window: {
            firstEventAt: "2026-06-22T10:00:00.000Z",
            lastEventAt: "2026-06-22T10:00:00.000Z",
            flushedAt: "2026-06-22T10:00:01.000Z",
          },
          inputEvents: [
            {
              event: "workflow.completed",
              schemaRef: null,
              receivedAt: "2026-06-22T10:00:00.000Z",
              payload: {
                runId: "source-run",
                workflow: "monitored-source",
                status: "success",
                triggerEvent: "runtime.idle",
                durationMs: 1,
                definitionPath: "src/modules/test/workflows/monitored-source/workflow.ts",
                runDir: ".kota/runs/source-run",
                tags: ["monitored"],
              },
            },
          ],
          batch: {
            workflow: "progress-reviewer",
            triggerIndex: 0,
            maxBufferSize: 5,
            overflow: "flush-oldest",
            droppedInputCount: 0,
          },
        },
    };
    await executeWorkflowRun(
      reviewerDefinition,
      reviewerTrigger,
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(
          workspaceRoot,
          reviewerTrigger,
          "review-run",
          workspaceRoot,
          "reviewer-head",
        ),
        bus,
        store,
        log: vi.fn(),
      },
    ).promise;
    const refreshed =
      readOptionalJsonFile<ControlMonitorCoverageArtifact>(sourceCoveragePath);

    expect(refreshed?.run.headSha).toBe("source-head");
    expect(refreshed?.monitoredSurfaceCounts.postRunReviewLinks).toBe(1);
    expect(refreshed?.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "async-reviewers",
          status: "covered",
          numerator: 1,
          denominator: 1,
        }),
      ]),
    );
    expect(refreshed?.asyncReviewResponseMs.observations).toBe(1);
  });

  it("does not refresh linked coverage outside the runs directory for traversal-shaped ids", async () => {
    const store = new WorkflowRunStore(workspaceRoot);
    const outsideRunDirPath = join(workspaceRoot, "outside-source-run");
    mkdirSync(join(outsideRunDirPath, "steps"), { recursive: true });
    writeJson(join(outsideRunDirPath, "metadata.json"), {
      id: "outside-source-run",
      workflow: "monitored-source",
      definitionPath: "src/modules/test/workflows/monitored-source/workflow.ts",
      trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
      startedAt: "2026-06-22T10:00:00.000Z",
      completedAt: "2026-06-22T10:00:01.000Z",
      status: "success",
      durationMs: 1,
      runDir: "outside-source-run",
      steps: [],
    });
    const reviewerDefinition: WorkflowDefinition = {
      name: "progress-reviewer",
      enabled: true,
      repository: "none",
      definitionPath: "src/modules/test/workflows/progress-reviewer/workflow.ts",
      moduleRoot: workspaceRoot,
      triggers: [],
      tags: [],
      steps: [
        {
          id: "review",
          type: "code",
          run: () => ({ ok: true }),
        },
      ],
    };

    const traversalTrigger: WorkflowRunTrigger = {
        event: "workflow.batch.flushed",
        schemaRef: null,
        payload: {
          runId: "../../outside-source-run",
          sourceRunId: "../../outside-source-run",
          inputEvents: [
            {
              event: "workflow.completed",
              schemaRef: null,
              receivedAt: "2026-06-22T10:00:00.000Z",
              payload: {
                runId: "../../outside-source-run",
                sourceRunId: "../../outside-source-run",
                workflow: "monitored-source",
                status: "success",
              },
            },
          ],
        },
    };
    await executeWorkflowRun(
      reviewerDefinition,
      traversalTrigger,
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(
          workspaceRoot,
          traversalTrigger,
          "review-run-traversal",
        ),
        bus: new EventBus(),
        store,
        log: vi.fn(),
      },
    ).promise;

    expect(
      existsSync(join(outsideRunDirPath, CONTROL_MONITOR_COVERAGE_ARTIFACT)),
    ).toBe(false);
  });
});
