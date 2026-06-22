import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "./control-monitor-coverage.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("control monitor coverage executor persistence", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-control-coverage-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes the artifact when the workflow executor finishes a run", async () => {
    const store = new WorkflowRunStore(projectDir);
    const trigger: WorkflowRunTrigger = {
      event: "runtime.idle",
      schemaRef: null,
      payload: {},
    };
    const definition: WorkflowDefinition = {
      name: "coverage-smoke",
      enabled: true,
      recoveryCapable: false,
      definitionPath: "src/modules/test/workflows/coverage-smoke/workflow.ts",
      moduleRoot: projectDir,
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
      projectDir,
      bus: new EventBus(),
      store,
      log: vi.fn(),
      runId: "executor-run",
    });
    const result = await promise;
    const artifactPath = join(
      projectDir,
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
      },
    });
  });

  it("refreshes linked source run coverage when an async reviewer finishes", async () => {
    const store = new WorkflowRunStore(projectDir);
    const sourceDefinition: WorkflowDefinition = {
      name: "monitored-source",
      enabled: true,
      recoveryCapable: false,
      definitionPath: "src/modules/test/workflows/monitored-source/workflow.ts",
      moduleRoot: projectDir,
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
      recoveryCapable: false,
      definitionPath: "src/modules/test/workflows/progress-reviewer/workflow.ts",
      moduleRoot: projectDir,
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
    const sourceRun = await executeWorkflowRun(
      sourceDefinition,
      {
        event: "runtime.idle",
        schemaRef: null,
        payload: {},
      },
      {
        projectDir,
        bus,
        store,
        log: vi.fn(),
        runId: "source-run",
      },
    ).promise;
    const sourceCoveragePath = join(
      projectDir,
      sourceRun.metadata.runDir,
      CONTROL_MONITOR_COVERAGE_ARTIFACT,
    );
    const initialCoverage =
      readOptionalJsonFile<ControlMonitorCoverageArtifact>(sourceCoveragePath);
    expect(initialCoverage?.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "async-reviewers",
          status: "pending",
        }),
      ]),
    );

    await executeWorkflowRun(
      reviewerDefinition,
      {
        event: "workflow.batch.flushed",
        schemaRef: null,
        payload: {
          scopeId: "default",
          projectId: "default",
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
      },
      {
        projectDir,
        bus,
        store,
        log: vi.fn(),
        runId: "review-run",
      },
    ).promise;
    const refreshed =
      readOptionalJsonFile<ControlMonitorCoverageArtifact>(sourceCoveragePath);

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
});
