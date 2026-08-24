import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkflowRunMetadata,
  WorkflowStepErrorKind,
} from "#core/workflow/run-types.js";
import {
  type HarnessOptions,
  WorkflowTestHarness,
} from "#core/workflow/testing/index.js";
import {
  taskClaimContentDigest,
  taskClaimContractDigest,
} from "#modules/autonomy/task-claim-task-binding.js";
import type { DecompositionPlan } from "./decomposition-plan.js";
import decomposerWorkflow, { agent } from "./workflow.js";
import {
  CLAIM_SNAPSHOT,
  claimedTaskFile,
  FAILED_RUN_ID,
  matchingPendingClaim,
  TASK_MARKDOWN,
} from "./workflow-test-support.js";

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
  CLAIM_CANDIDATE_STATES: ["doing", "ready"],
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
    mutatedTaskPaths: ["data/tasks/ready/task-scoped-subtask.md"],
  })),
}));

function makeFailedBuilderMetadata(opts: {
  buildDurationMs: number;
  buildError?: string;
  buildErrorKind?: WorkflowStepErrorKind;
}): WorkflowRunMetadata {
  return {
    id: FAILED_RUN_ID,
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
  artifactOverrides: {
    runId?: string;
    workflowId?: string;
    status?: string;
  } = {},
) {
  const { readActiveTaskClaim } = await import("#modules/autonomy/task-claims.js");
  vi.mocked(readActiveTaskClaim).mockReturnValue(
    taskId === null ? null : matchingPendingClaim(taskId),
  );
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
              taskFile: claimedTaskFile(taskId),
              taskContentDigest: taskClaimContentDigest(TASK_MARKDOWN),
              taskContractDigest: taskClaimContractDigest(TASK_MARKDOWN),
              runId: artifactOverrides.runId ?? FAILED_RUN_ID,
              workflowId: artifactOverrides.workflowId ?? "builder",
              status: artifactOverrides.status ?? "active",
            },
          } as never);
    }
    return null;
  });
}

const TRIGGER_PAYLOAD = {
  workflow: "builder",
  runId: FAILED_RUN_ID,
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
      reuseTaskId: null,
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
              content: TASK_MARKDOWN,
              snapshot: {
                ...CLAIM_SNAPSHOT,
                ino: 2,
                size: 2,
                mtimeMs: 2,
                ctimeMs: 2,
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
        return TASK_MARKDOWN;
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

  it("runs both reasoning steps as native-compatible deny-all agents without named tool policy", () => {
    expect(agent.writeScope).toBe("deny-all");
    const steps = decomposerWorkflow.steps.filter(
      (candidate) => candidate.type === "agent",
    );

    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.autonomyMode ?? decomposerWorkflow.defaultAutonomyMode).toBe(
        "autonomous",
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

  it("rejects a claimed run whose active pending-decomposition claim is missing", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );
    const { readActiveTaskClaim } = await import("#modules/autonomy/task-claims.js");
    vi.mocked(readActiveTaskClaim).mockReturnValue(null);

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: TRIGGER_PAYLOAD,
      },
      stepMocks: decomposeStepMocks(),
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toContain(
      "pending-decomposition claim is missing",
    );
    expect(result.steps.decompose).toBeUndefined();
  });

  it("rejects a forged run claim artifact that does not match the authoritative claim", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
      "task-big-refactor",
      { runId: "run-forged-builder" },
    );

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: TRIGGER_PAYLOAD,
      },
      stepMocks: decomposeStepMocks(),
    }).run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toContain(
      "run claim artifact does not match",
    );
    expect(result.steps.decompose).toBeUndefined();
  });

  it("rejects replay after the claimed task file was replaced under the same id", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );
    const { readVerifiedRepoTaskFile } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(readVerifiedRepoTaskFile).mockReturnValue({
      path: "data/tasks/ready/task-big-refactor.md",
      content: TASK_MARKDOWN,
      snapshot: { ...CLAIM_SNAPSHOT, ino: 999 },
    });

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: TRIGGER_PAYLOAD,
      },
      stepMocks: decomposeStepMocks(),
    }).run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      reason: expect.stringMatching(/changed.*current task identity supersedes/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("runs decompose after the claimed task moves from ready to doing", async () => {
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
      reason: expect.stringMatching(/no longer.*claimable task state.*supersedes/i),
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

  it("rejects a different builder run's pending-decomposition claim before planning", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );

    const { readActiveTaskClaim, supersedeTaskClaim } = await import(
      "#modules/autonomy/task-claims.js"
    );
    vi.mocked(readActiveTaskClaim).mockReturnValue(
      matchingPendingClaim("task-big-refactor", {
        runId: "run-newer-builder",
      }),
    );
    const { applyDecompositionPlan } = await import("./decomposition-actions.js");

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", schemaRef: null, payload: TRIGGER_PAYLOAD },
      stepMocks: decomposeStepMocks(),
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].status).toBe("failed");
    expect(result.steps["assess-failure"].error).toContain(
      "run-newer-builder/pending-decomposition",
    );
    expect(result.steps.decompose).toBeUndefined();
    expect(applyDecompositionPlan).not.toHaveBeenCalled();
    expect(supersedeTaskClaim).not.toHaveBeenCalled();
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

  it("revalidates failed-run ownership immediately before applying decomposition", async () => {
    await configureBuilderFailure(
      makeFailedBuilderMetadata({
        buildDurationMs: HANG_TIMEOUT_BUILD_MS,
        buildErrorKind: "step-timeout",
      }),
    );
    const { readActiveTaskClaim } = await import("#modules/autonomy/task-claims.js");
    vi.mocked(readActiveTaskClaim)
      .mockReturnValueOnce(matchingPendingClaim("task-big-refactor"))
      .mockReturnValue(
        matchingPendingClaim("task-big-refactor", {
          runId: "run-replacement-builder",
        }),
      );
    const { applyDecompositionPlan } = await import("./decomposition-actions.js");

    const result = await new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: TRIGGER_PAYLOAD,
      },
      stepMocks: decomposeStepMocks(),
    }).run();

    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps["review-decomposition"].status).toBe("success");
    expect(result.steps["apply-decomposition"].status).toBe("failed");
    expect(result.steps["apply-decomposition"].error).toContain(
      "claim ownership is builder/run-replacement-builder/pending-decomposition",
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
              content: TASK_MARKDOWN,
              snapshot: { ...CLAIM_SNAPSHOT },
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
