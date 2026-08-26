import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunStatus } from "./runtime-state-types.js";
import type { WorkflowDefinition } from "./types.js";

function workflow(name: string): WorkflowDefinition {
  return {
    name,
    definitionPath: `test/${name}.ts`,
    moduleRoot: "/test-module-root",
    enabled: true,
    repository: "read",
    tags: [],
    triggers: [],
    steps: [],
  };
}

function completion(
  runId: string,
  completedAt: string,
  status: WorkflowRunStatus = "success",
) {
  return {
    runId,
    startedAt: completedAt,
    completedAt,
    status,
  };
}

describe("workflow completion state races", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-completion-race-"));
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("preserves independent completion updates from concurrent run handles", () => {
    writeFileSync(
      store.statePath,
      JSON.stringify({
        completedRuns: 10,
        workflows: {
          alpha: {
            lastCompletion: completion(
              "prior-alpha",
              "2026-04-11T10:00:00.000Z",
            ),
          },
          beta: {
            lastCompletion: completion(
              "prior-beta",
              "2026-04-11T10:00:00.000Z",
            ),
          },
        },
      }),
    );
    const alpha = store.createRun(workflow("alpha"), {
      event: "test",
      schemaRef: null,
      payload: {},
    });
    const beta = store.createRun(workflow("beta"), {
      event: "test",
      schemaRef: null,
      payload: {},
    });

    beta.finish({ status: "success", durationMs: 1_000 });
    const betaCompletedAt = store.readState().workflows.beta?.lastCompletion?.completedAt;
    alpha.finish({ status: "success", durationMs: 2_000 });

    const state = store.readState();
    expect(state.workflows.alpha?.lastCompletion?.runId).toBe(alpha.metadata.id);
    expect(state.workflows.beta?.lastCompletion?.completedAt).toBe(betaCompletedAt);
    expect(state.completedRuns).toBe(12);
    expect(state).not.toHaveProperty("activeRuns");
    expect(state).not.toHaveProperty("pendingRuns");
  });

  it("never moves a workflow completion watermark backward", () => {
    const futureCompletion = new Date(Date.now() + 60_000).toISOString();
    writeFileSync(
      store.statePath,
      JSON.stringify({
        completedRuns: 5,
        workflows: {
          alpha: {
            lastCompletion: completion("run-alpha-newer", futureCompletion),
          },
        },
      }),
    );
    const older = store.createRun(workflow("alpha"), {
      event: "test",
      schemaRef: null,
      payload: {},
    });

    older.finish({ status: "success", durationMs: 500 });

    const state = store.readState();
    expect(state.workflows.alpha?.lastCompletion?.completedAt).toBe(futureCompletion);
    expect(state.completedRuns).toBe(6);
  });
});
