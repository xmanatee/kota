import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowRunMetadata,
  WorkflowStepErrorKind,
} from "#core/workflow/run-types.js";
import {
  type HarnessOptions,
  WorkflowTestHarness,
} from "#core/workflow/testing/index.js";
import type { DecompositionPlan } from "./decomposition-plan.js";
import decomposerWorkflow, { agent } from "./workflow.js";

vi.mock("#core/util/json-file.js", () => ({
  readOptionalJsonFile: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    existsSync: vi.fn(actual.existsSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

vi.mock("#modules/autonomy/commit.js", () => ({
  checkCommitStageable: vi.fn(() => "OK"),
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("#modules/autonomy/task-claims.js", () => ({
  CLAIM_SCHEMA_VERSION: 2,
  readActiveTaskClaim: vi.fn(() => null),
  supersedeTaskClaim: vi.fn(() => ({
    taskId: "task-big-refactor",
    changed: true,
    claim: null,
    recoveryStatus: "superseded",
    safeToRetry: true,
    reason: null,
  })),
}));

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("#modules/repo-tasks/repo-tasks-domain.js")
  >();
  return {
    ...actual,
    readVerifiedRepoTaskFile: vi.fn(),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
    "#modules/autonomy/shared.js",
  );
  return {
    ...actual,
    checkCommitMessageExists: vi.fn(() => "OK"),
    checkNoScratchArtifacts: vi.fn(() => "OK"),
    runCheck: vi.fn(async () => "OK"),
  };
});

vi.mock("./decomposition-actions.js", () => ({
  applyDecompositionPlan: vi.fn((args: { taskId: string }) => ({
    taskId: args.taskId,
    subtaskIds: ["task-scoped-subtask"],
  })),
}));

function makeFailedBuilderMetadata(opts: {
  buildDurationMs: number;
  buildError?: string;
  buildErrorKind?: WorkflowStepErrorKind;
}): WorkflowRunMetadata {
  return {
    id: "run-failed-builder",
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    startedAt: "2026-04-10T20:00:00Z",
    completedAt: "2026-04-10T21:00:00Z",
    status: "failed",
    durationMs: opts.buildDurationMs + 1000,
    runDir: ".kota/runs/run-failed-builder",
    steps: [
      {
        id: "inspect-ready-queue",
        type: "code",
        status: "success",
        startedAt: "2026-04-10T20:00:00Z",
        completedAt: "2026-04-10T20:00:01Z",
        durationMs: 1000,
      },
      {
        id: "build",
        type: "agent",
        status: "failed",
        startedAt: "2026-04-10T20:00:01Z",
        completedAt: "2026-04-10T21:00:00Z",
        durationMs: opts.buildDurationMs,
        error: opts.buildError,
        errorKind: opts.buildErrorKind,
      },
    ],
  };
}

async function configureBuilderFailure(
  metadata: WorkflowRunMetadata,
  taskId: string | null = "task-big-refactor",
) {
  const { readOptionalJsonFile } = await import("#core/util/json-file.js");
  vi.mocked(readOptionalJsonFile).mockImplementation((path: string) => {
    if (path.endsWith("/metadata.json")) return metadata as never;
    if (path.endsWith("/task-claim.json")) {
      return taskId === null
        ? null
        : ({
            claimed: true,
            taskId,
            claim: {
              schemaVersion: 2,
              taskId,
              taskState: "ready",
              taskFile: {
                path: `data/tasks/ready/${taskId}.md`,
                snapshot: {
                  dev: 1,
                  ino: 1,
                  size: 1,
                  mtimeMs: 1,
                  ctimeMs: 1,
                },
              },
            },
          } as never);
    }
    return null;
  });
}

const TRIGGER_PAYLOAD = {
  workflow: "builder",
  runId: "run-failed-builder",
  status: "failed",
  triggerEvent: "autonomy.queue.available",
  durationMs: 3_600_000,
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  runDir: ".kota/runs/run-failed-builder",
};

const HANG_TIMEOUT_BUILD_MS = 3 * 60 * 60 * 1000 + 5 * 60 * 1000;

const DECOMPOSITION_PLAN: DecompositionPlan = {
  rationale: "Separate the failed task into one independently actionable slice.",
  subtasks: [
    {
      title: "Scoped subtask",
      summary: "Implement one bounded portion of the failed task.",
      priority: "p1",
      area: "modules",
      taskClass: "Platform",
      problem: "The original task could not produce stageable progress.",
      desiredOutcome: "The bounded portion is complete and independently verifiable.",
      constraints: ["Preserve the original task intent."],
      doneWhen: ["Focused evidence proves the bounded outcome."],
      sourceIntent: "Builder repair exhaustion requires a smaller execution unit.",
      initiative: "Reliable autonomous task execution.",
      acceptanceEvidence: ["A focused regression or runtime artifact proves completion."],
      dependsOn: [],
    },
  ],
};

const DECOMPOSITION_REVIEW = {
  decision: "approve",
  rationale: "Every subtask preserves the parent task's bounded outcome.",
  issues: [],
} as const;

function decomposeStepMocks(
  extra: NonNullable<HarnessOptions["stepMocks"]> = {},
): NonNullable<HarnessOptions["stepMocks"]> {
  return {
    decompose: DECOMPOSITION_PLAN,
    "review-decomposition": DECOMPOSITION_REVIEW,
    ...extra,
  };
}

describe("decomposer workflow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { readActiveTaskClaim } = await import("#modules/autonomy/task-claims.js");
    vi.mocked(readActiveTaskClaim).mockReturnValue(null);
    const { readVerifiedRepoTaskFile } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(readVerifiedRepoTaskFile).mockImplementation(
      (_projectDir, state, taskId) =>
        state === "doing"
          ? {
              path: `data/tasks/doing/${taskId}.md`,
              content:
                `---\nid: ${taskId}\n---\n\n## Problem\n\nCanonical task intent.\n`,
              snapshot: {
                dev: 1,
                ino: 2,
                size: 1,
                mtimeMs: 1,
                ctimeMs: 1,
              },
            }
          : null,
    );
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/")) return true;
      return actual.existsSync(path as Parameters<typeof actual.existsSync>[0]);
    });
    vi.mocked(fs.readFileSync).mockImplementation((path, options) => {
      if (String(path).includes("data/tasks/")) {
        return "---\nid: task-fixture\n---\n\n## Problem\n\nCanonical task intent.\n";
      }
      return actual.readFileSync(path, options as never);
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  });

  it("exposes the typed plan to the semantic reviewer", () => {
    const step = decomposerWorkflow.steps.find(
      (candidate) => candidate.id === "decompose",
    );

    expect(step).toMatchObject({
      type: "agent",
      exposeOutputToAgent: true,
    });
  });

  it("runs both reasoning steps as passive deny-all agents without unenforceable named tool policy", () => {
    expect(agent.writeScope).toBe("deny-all");
    const steps = decomposerWorkflow.steps.filter(
      (candidate) => candidate.type === "agent",
    );

    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.autonomyMode ?? decomposerWorkflow.defaultAutonomyMode).toBe(
        "passive",
      );
      expect(step.allowedTools).toBeUndefined();
      expect(step.disallowedTools).toBeUndefined();
    }
  });

  it("skips decompose when builder failure does not require rescoping", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({ buildDurationMs: 5 * 60 * 1000 }),
    );

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: null,
      reason: expect.stringMatching(/does not require task rescoping/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("fails assess-failure when trigger payload is missing runDir", async () => {
    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "workflow.completed",
        schemaRef: null, payload: { workflow: "builder", status: "failed" },
      },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps.decompose).toBeUndefined();
  });

  it("skips decompose when the failed run has no claimed task artifact", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
      null,
    );

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: "timeout",
      reason: expect.stringMatching(/no claimed task artifact/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("runs decompose for a timed-out claimed task", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["data/tasks/ready/task-scoped-subtask.md"],
      daemonRestartRequired: false,
    } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      failureKind: "timeout",
      taskId: "task-big-refactor",
      taskPath: "data/tasks/doing/task-big-refactor.md",
    });
    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(commitWorkflowChanges).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {
        kind: "exact-paths",
        paths: [
          "data/tasks/doing/task-big-refactor.md",
          "data/tasks/dropped/task-big-refactor.md",
          "data/tasks/ready/task-scoped-subtask.md",
        ],
      },
    );
  });

  it("detects a structured step timeout even when duration is short", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: 10 * 60 * 1000,
        buildError: "Step timed out after 600000ms",
        buildErrorKind: "step-timeout",
      }),
      "task-oversized",
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["data/tasks/ready/task-scoped-subtask.md"],
      daemonRestartRequired: false,
    } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      failureKind: "timeout",
      taskId: "task-oversized",
    });
  });

  it("rescopes a claimed task after the builder repair loop makes no progress", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: 15 * 60 * 1000,
        buildError:
          'Repair loop for step "build" made no progress after 3 consecutive attempts. Still failing: success-criteria-declared, commit-stageable',
        buildErrorKind: "repair-no-progress",
      }),
      "task-needs-rescope",
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["data/tasks/ready/task-scoped-subtask.md"],
      daemonRestartRequired: false,
    } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      failureKind: "repair-exhausted",
      taskId: "task-needs-rescope",
      taskPath: "data/tasks/doing/task-needs-rescope.md",
    });
    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("uses the run claim instead of selecting an unrelated active task", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
      null,
    );

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: "timeout",
      reason: expect.stringMatching(/no claimed task artifact/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("treats a claimed task outside active states as superseding evidence", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
      "task-already-resolved",
    );
    const { readVerifiedRepoTaskFile } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(readVerifiedRepoTaskFile).mockReturnValue(null);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: "timeout",
      reason: expect.stringMatching(/no longer active.*supersedes/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("skips commit when decompose step is skipped", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({ buildDurationMs: 5 * 60 * 1000 }),
    );

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps.decompose.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["finalize-source-claim"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("finalizes the source claim without restarting for a task-only commit", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["data/tasks/ready/task-scoped-subtask.md"],
      daemonRestartRequired: false,
    } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["finalize-source-claim"].status).toBe("success");
    expect(result.steps["request-restart"].status).toBe("skipped");
    const { supersedeTaskClaim } = await import("#modules/autonomy/task-claims.js");
    expect(supersedeTaskClaim).toHaveBeenCalledWith({
      projectDir: expect.any(String),
      taskId: "task-big-refactor",
      runId: "run-failed-builder",
      workflowId: "builder",
      evidence: expect.stringContaining("replaced the exhausted task"),
    });
  });

  it("finalizes the current pending decomposition claim after a builder retry", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["data/tasks/ready/task-scoped-subtask.md"],
      daemonRestartRequired: false,
    } as never);

    const { readActiveTaskClaim, supersedeTaskClaim } = await import(
      "#modules/autonomy/task-claims.js"
    );
    vi.mocked(readActiveTaskClaim).mockReturnValue({
      taskId: "task-big-refactor",
      runId: "run-newer-builder",
      workflowId: "builder",
      status: "pending-decomposition",
    } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["finalize-source-claim"].status).toBe("success");
    expect(supersedeTaskClaim).toHaveBeenCalledWith({
      projectDir: expect.any(String),
      taskId: "task-big-refactor",
      runId: "run-newer-builder",
      workflowId: "builder",
      evidence: expect.stringContaining("replaced the exhausted task"),
    });
  });

  it("rejects a semantically misaligned plan before task mutation", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );
    const { applyDecompositionPlan } = await import("./decomposition-actions.js");

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks({
        "review-decomposition": {
          decision: "reject",
          rationale: "The plan changes the security boundary.",
          issues: ["The proposed tasks solve a different vulnerability."],
        },
      }),
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["require-decomposition-approval"].error).toContain(
      "solve a different vulnerability",
    );
    expect(applyDecompositionPlan).not.toHaveBeenCalled();
  });

  it("decomposes on runtime.recovered when the source was a timed-out builder", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: 10 * 60 * 1000,
        buildError: 'Step "build" timed out after 2100000ms',
        buildErrorKind: "step-timeout",
      }),
    );

    const { readVerifiedRepoTaskFile } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(readVerifiedRepoTaskFile).mockImplementation(
      (_projectDir, state, taskId) =>
        state === "ready"
          ? {
              path: `data/tasks/ready/${taskId}.md`,
              content:
                `---\nid: ${taskId}\n---\n\n## Problem\n\nCanonical task intent.\n`,
              snapshot: {
                dev: 1,
                ino: 2,
                size: 1,
                mtimeMs: 1,
                ctimeMs: 1,
              },
            }
          : null,
    );

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
      committedPaths: ["data/tasks/ready/task-scoped-subtask.md"],
      daemonRestartRequired: false,
    } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "runtime.recovered",
        schemaRef: null, payload: {
          recoveredAt: "2026-04-18T10:00:00Z",
          sourceRunId: "run-failed-builder",
          sourceWorkflow: "builder",
        },
      },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      failureKind: "timeout",
      taskId: "task-big-refactor",
      taskPath: "data/tasks/ready/task-big-refactor.md",
    });
    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("skips decompose on runtime.recovered when sourceWorkflow is not builder", async () => {
    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "runtime.recovered",
        schemaRef: null, payload: {
          recoveredAt: "2026-04-18T10:00:00Z",
          sourceRunId: "run-failed-improver",
          sourceWorkflow: "improver",
        },
      },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: null,
      reason: expect.stringMatching(/not builder/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

});
