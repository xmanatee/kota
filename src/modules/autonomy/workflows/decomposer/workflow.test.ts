import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowStepErrorKind } from "#core/workflow/run-types.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import {
  WorkflowScenarioDriver,
  type WorkflowScenarioOptions,
} from "#core/workflow/testing/index.js";
import type { DecompositionPlan } from "./decomposition-plan.js";
import decomposerWorkflow, { agent } from "./workflow.js";
import {
  FAILED_RUN_ID,
  failedBuilderMetadata,
  failedBuilderTrigger,
  TASK_ID,
  writeActionableTask,
  writeRunMetadata,
} from "./workflow-test-support.js";

vi.mock("./decomposition-actions.js", () => ({
  applyDecompositionPlan: vi.fn((args: { taskId: string }) => ({
    taskId: args.taskId,
    subtaskIds: ["task-scoped-subtask"],
  })),
}));

const roots: string[] = [];

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
      howWeWillKnow: ["The bounded outcome is observable at its public boundary."],
      dependsOn: [],
    },
  ],
};

const DECOMPOSITION_REVIEW = {
  decision: "approve",
  rationale: "Every subtask preserves the parent task's bounded outcome.",
  issues: [],
} as const;

function project(): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-decomposer-workflow-"));
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "KOTA test"], {
    cwd: workspaceRoot,
  });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  roots.push(workspaceRoot);
  return workspaceRoot;
}

function commitScenarioInput(workspaceRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "scenario input"], {
    cwd: workspaceRoot,
  });
}

function failureFixture(
  errorKind: WorkflowStepErrorKind | undefined,
  taskId = TASK_ID,
): {
  workspaceRoot: string;
  stateDir: string;
  trigger: ReturnType<typeof failedBuilderTrigger>;
} {
  const workspaceRoot = project();
  const task = writeActionableTask(workspaceRoot, taskId);
  const metadata = failedBuilderMetadata(task, { errorKind });
  return {
    workspaceRoot,
    stateDir: writeRunMetadata(workspaceRoot, FAILED_RUN_ID, metadata),
    trigger: failedBuilderTrigger(),
  };
}

function decomposeStepMocks(
  extra: NonNullable<WorkflowScenarioOptions["stepOutputs"]> = {},
): NonNullable<WorkflowScenarioOptions["stepOutputs"]> {
  return {
    decompose: DECOMPOSITION_PLAN,
    "review-decomposition": DECOMPOSITION_REVIEW,
    ...extra,
  };
}

async function runFixture(
  fixture: ReturnType<typeof failureFixture>,
  stepOutputs = decomposeStepMocks(),
) {
  commitScenarioInput(fixture.workspaceRoot);
  return new WorkflowScenarioDriver(decomposerWorkflow, {
    workspaceRoot: fixture.workspaceRoot,
    trigger: fixture.trigger,
    stepOutputs,
    ports: { runCommand: successfulWorkflowCommandRun },
  }).run();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("decomposer workflow", () => {
  it("keeps both reasoning steps read-only and exposes the plan to review", () => {
    expect(agent.writeScope).toBe("deny-all");
    const steps = decomposerWorkflow.steps.filter(
      (candidate) => candidate.type === "agent",
    );

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      id: "decompose",
      exposeOutputToAgent: true,
    });
    for (const step of steps) {
      expect(step.autonomyMode ?? decomposerWorkflow.defaultAutonomyMode).toBe(
        "autonomous",
      );
      expect(step.allowedTools).toBeUndefined();
      expect(step.disallowedTools).toBeUndefined();
    }
  });

  it("derives RunState ownership from the failed builder's immutable task contract", () => {
    const fixture = failureFixture("step-timeout");
    const resources = decomposerWorkflow.resources?.({
      scopeRoot: fixture.workspaceRoot,
      stateDir: fixture.stateDir,
      workflowName: "decomposer",
      trigger: fixture.trigger,
    });
    expect(resources).toEqual([`task:${TASK_ID}`]);

    const state = new RunStateDatabase(fixture.stateDir);
    try {
      state.registerScope({
        id: "scope-decomposer",
        rootPath: fixture.workspaceRoot,
        createdAt: "2026-08-25T01:00:00.000Z",
      });
      const { epoch } = state.beginDaemonSession("2026-08-25T01:00:00.500Z");
      state.admitRun({
        id: "run-decomposer",
        scopeId: "scope-decomposer",
        workflow: "decomposer",
        repository: "write",
        trigger: fixture.trigger,
        resources: resources ?? [],
        admittedAt: "2026-08-25T01:00:01.000Z",
      });
      expect(state.startRun("run-decomposer", epoch, "2026-08-25T01:00:01.500Z")).toBe(1);

      expect(state.getRun("run-decomposer")?.resources).toEqual([
        `task:${TASK_ID}`,
      ]);
      state.admitRun({
        id: "run-competing-builder",
        scopeId: "scope-decomposer",
        workflow: "builder",
        repository: "write",
        trigger: fixture.trigger,
        resources: [`task:${TASK_ID}`],
        admittedAt: "2026-08-25T01:00:02.000Z",
      });
      expect(
        state.startRun("run-competing-builder", epoch, "2026-08-25T01:00:03.000Z"),
      ).toBeNull();
      expect(state.getRun("run-competing-builder")?.state).toBe("queued");
    } finally {
      state.close();
    }
  });

  it("rejects resource admission when source metadata lacks the task contract", () => {
    const fixture = failureFixture("step-timeout");
    const metadata = failedBuilderMetadata(
      writeActionableTask(fixture.workspaceRoot),
      { errorKind: "step-timeout" },
    );
    metadata.trigger = {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: { taskId: TASK_ID },
    };
    writeRunMetadata(fixture.workspaceRoot, FAILED_RUN_ID, metadata);

    expect(() =>
      decomposerWorkflow.resources?.({
        scopeRoot: fixture.workspaceRoot,
        stateDir: fixture.stateDir,
        workflowName: "decomposer",
        trigger: fixture.trigger,
      }),
    ).toThrow("immutable task contract");
  });

  it("rechecks the failed builder's source contract after reconciliation", () => {
    const fixture = failureFixture("step-timeout");
    const invariant = decomposerWorkflow.integration?.postReconcile;
    if (!invariant) throw new Error("missing decomposer post-reconcile invariant");
    const input = {
      workspaceRoot: fixture.workspaceRoot,
      repoRoot: fixture.workspaceRoot,
      stateDir: fixture.stateDir,
      workflowName: "decomposer",
      trigger: fixture.trigger,
      head: "reconciled-head",
      canonicalHead: "canonical-head",
      signal: new AbortController().signal,
    };

    expect(invariant(input)).toEqual({ satisfied: true });
    writeActionableTask(
      fixture.workspaceRoot,
      TASK_ID,
      "doing",
      "The task changed after decomposer admission.",
    );
    expect(invariant(input)).toMatchObject({
      satisfied: false,
      reason: expect.stringMatching(/changed after the failed run was admitted/i),
    });
  });

  it("rejects unsupported triggers and malformed completion payloads", () => {
    const fixture = failureFixture("step-timeout");
    const resourceInput = {
      scopeRoot: fixture.workspaceRoot,
      stateDir: fixture.stateDir,
      workflowName: "decomposer",
    };

    expect(() =>
      decomposerWorkflow.resources?.({
        ...resourceInput,
        trigger: {
          event: "runtime.idle",
          schemaRef: null,
          payload: fixture.trigger.payload,
        },
      }),
    ).toThrow("accepts only workflow.completed triggers");

    expect(() =>
      decomposerWorkflow.resources?.({
        ...resourceInput,
        trigger: {
          event: "workflow.completed",
          schemaRef: null,
          payload: { workflow: "builder", status: "failed" },
        },
      }),
    ).toThrow("must include runDir and runId");
  });

  it("skips decomposition for a builder failure outside the rescope classes", async () => {
    const result = await runFixture(failureFixture(undefined));

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: null,
      reason: expect.stringMatching(/does not require task rescoping/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
    expect(result.steps["validate-decomposition"].status).toBe("skipped");
  });

  it.each([
    ["timeout", "step-timeout" as const, "task-oversized"],
    ["repair exhaustion", "repair-no-progress" as const, "task-needs-rescope"],
  ])("decomposes an unchanged task after %s", async (_label, errorKind, taskId) => {
    const result = await runFixture(failureFixture(errorKind, taskId));

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      failureKind: errorKind === "step-timeout" ? "timeout" : "repair-exhausted",
      taskId,
      taskPath: `data/tasks/doing/${taskId}.md`,
    });
    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps["validate-decomposition"].status).toBe("success");
  });

  it("skips a task whose immutable contract changed after builder admission", async () => {
    const fixture = failureFixture("step-timeout");
    writeActionableTask(
      fixture.workspaceRoot,
      TASK_ID,
      "doing",
      "The task changed after the failed builder run.",
    );

    const result = await runFixture(fixture);

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      failureKind: "timeout",
      reason: expect.stringMatching(/changed after the failed run was admitted/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("rejects a semantically misaligned plan before task mutation", async () => {
    const { applyDecompositionPlan } = await import("./decomposition-actions.js");
    const result = await runFixture(
      failureFixture("step-timeout"),
      decomposeStepMocks({
        "review-decomposition": {
          decision: "reject",
          rationale: "The plan changes the security boundary.",
          issues: ["The proposed tasks solve a different vulnerability."],
        },
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.steps["require-decomposition-approval"].error).toContain(
      "solve a different vulnerability",
    );
    expect(applyDecompositionPlan).not.toHaveBeenCalled();
  });

  it("rechecks the immutable task contract immediately before mutation", async () => {
    const fixture = failureFixture("step-timeout");
    const { applyDecompositionPlan } = await import("./decomposition-actions.js");
    commitScenarioInput(fixture.workspaceRoot);
    const result = await new WorkflowScenarioDriver(decomposerWorkflow, {
      workspaceRoot: fixture.workspaceRoot,
      trigger: fixture.trigger,
      ports: {
        runCommand: successfulWorkflowCommandRun,
        runAgent: ({ stepId, cwd }) => {
          if (stepId === "decompose") return DECOMPOSITION_PLAN;
          writeActionableTask(
            cwd,
            TASK_ID,
            "doing",
            "The task changed during semantic review.",
          );
          return DECOMPOSITION_REVIEW;
        },
      },
    }).run();

    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps["review-decomposition"].status).toBe("success");
    expect(result.steps["apply-decomposition"].status).toBe("failed");
    expect(result.steps["apply-decomposition"].error).toContain(
      "failed-run ownership changed after assessment",
    );
    expect(applyDecompositionPlan).not.toHaveBeenCalled();
  });
});
