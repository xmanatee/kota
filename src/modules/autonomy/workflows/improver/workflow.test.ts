import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  listAutonomyIssues,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  checkCommitStageable,
  commitWorkflowChanges,
} from "#modules/autonomy/commit.js";
import improverWorkflow, { agent } from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc123",
  })),
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  checkCommitStageable: vi.fn(),
  commitWorkflowChanges: vi.fn(() => ({
    committed: true,
    committedPaths: ["data/tasks/ready/task-fixture.md"],
    daemonRestartRequired: false,
  })),
}));

const OBSERVED_DISPOSITION = {
  action: "observe" as const,
  rationale: "Evidence is diagnostic and does not justify implementation work yet.",
  taskTitle: "",
  taskSummary: "",
  taskPriority: "p2" as const,
  taskArea: "autonomy",
  taskClass: "Meta" as const,
  taskAcceptanceEvidence: "",
  ownerQuestion: "",
  ownerReason: "",
  proposedAnswers: [],
};

const TASK_DISPOSITION = {
  ...OBSERVED_DISPOSITION,
  action: "create-task" as const,
  rationale: "The stable failure needs a builder-owned repair.",
  taskTitle: "Repair the stable builder fixture failure",
  taskSummary: "Route the fixture failure through the normal builder lifecycle.",
  taskAcceptanceEvidence: "A focused fixture proves the failure no longer recurs.",
};

const RESOLVED_DISPOSITION = {
  ...OBSERVED_DISPOSITION,
  action: "resolve" as const,
  rationale: "The revised evidence proves the root cause is resolved.",
};

const mockedCheckCommitStageable = vi.mocked(checkCommitStageable);
const mockedCommitWorkflowChanges = vi.mocked(commitWorkflowChanges);

describe("improver issue disposition workflow", () => {
  let projectDir: string;

  beforeEach(() => {
    mockedCheckCommitStageable.mockClear();
    mockedCommitWorkflowChanges.mockClear();
    projectDir = join(
      tmpdir(),
      `kota-improver-issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ scripts: { "validate-tasks": "true" } }),
      "utf-8",
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function openIssue() {
    const observation = buildAutonomyIssueObservation({
      kind: "present",
      rootCauseKey: "workflow:builder:fixture-failure",
      observedAt: "2026-08-13T10:00:00.000Z",
      source: { kind: "workflow", id: "builder", workflow: "builder" },
      severity: "error",
      actionability: "local-code",
      labels: ["workflow-failure"],
      summaries: ["The fixture failed."],
      evidenceRefs: [{ kind: "run", ref: ".kota/runs/fixture" }],
      observationCount: 1,
      signalIds: ["signal-fixture"],
    });
    const result = applyAutonomyIssueObservations({
      projectDir,
      observations: [observation],
    });
    return result.projection.issues[0]!;
  }

  it("has no generic successful-completion trigger or implementation write scope", () => {
    expect(improverWorkflow.triggers.map((trigger) => trigger.event)).toEqual([
      autonomyIssueDecisionRequested.name,
      "runtime.recovered",
    ]);
    expect(improverWorkflow.triggers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "workflow.completed" })]),
    );
    expect(improverWorkflow.defaultAutonomyMode).toBe("autonomous");
    expect(agent.writeScope).toBe("deny-all");
    expect(
      improverWorkflow.steps.find((step) => step.id === "select-issue"),
    ).toEqual(expect.objectContaining({ exposeOutputToAgent: true }));
  });

  it("reviews one undecided semantic revision and does not review it again", async () => {
    const issue = openIssue();
    const trigger = {
      event: autonomyIssueDecisionRequested.name,
      payload: {
        scopeId: "scope-fixture",
        projectId: "scope-fixture",
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision: issue.semanticRevision,
        transition: "opened",
        observedAt: issue.lastSeenAt,
      },
    };
    const first = await new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger,
      stepMocks: { "review-issue": OBSERVED_DISPOSITION },
    }).run();

    expect(first.status).toBe("success");
    expect(first.steps["review-issue"].status).toBe("success");
    expect(first.steps["record-disposition"].status).toBe("success");
    expect(first.steps["emit-attention"].status).toBe("skipped");
    expect(listAutonomyIssues(projectDir)[0]?.disposition.kind).toBe("observed");

    const repeated = await new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger,
      stepMocks: { "review-issue": OBSERVED_DISPOSITION },
    }).run();

    expect(repeated.status).toBe("success");
    expect(repeated.steps["select-issue"].output).toMatchObject({ eligible: false });
    expect(repeated.steps["review-issue"].status).toBe("skipped");
  });

  it("recovery restores state without replaying AI review", async () => {
    const result = await new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: { event: "runtime.recovered", payload: {} },
      stepMocks: { "review-issue": OBSERVED_DISPOSITION },
    }).run();

    expect(result.steps["select-issue"].output).toMatchObject({
      eligible: false,
      reason: expect.stringContaining("without replaying AI review"),
    });
    expect(result.steps["review-issue"].status).toBe("skipped");
  });

  it("routes a repair through one stable task and resolves it on a revised issue", async () => {
    const issue = openIssue();
    const triggerFor = (
      semanticRevision: number,
      transition: "opened" | "revised",
    ) => ({
      event: autonomyIssueDecisionRequested.name,
      payload: {
        scopeId: "scope-fixture",
        projectId: "scope-fixture",
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision,
        transition,
        observedAt: "2026-08-13T10:00:00.000Z",
      },
    });
    const created = await new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: triggerFor(1, "opened"),
      stepMocks: { "review-issue": TASK_DISPOSITION },
    }).run();

    expect(created.status, JSON.stringify(created, null, 2)).toBe("success");
    const applied = created.steps["apply-disposition"].output as {
      materialized: { taskId: string | null };
    };
    const taskId = applied.materialized.taskId;
    expect(taskId).toEqual(expect.stringMatching(/^task-/));
    expect(
      existsSync(join(projectDir, "data", "tasks", "ready", `${taskId}.md`)),
    ).toBe(true);
    expect(listAutonomyIssues(projectDir)[0]?.links.taskIds).toEqual([taskId]);
    const readyPath = `data/tasks/ready/${taskId}.md`;
    expect(mockedCheckCommitStageable).toHaveBeenLastCalledWith(projectDir, {
      kind: "exact-paths",
      paths: [readyPath],
    });
    expect(mockedCommitWorkflowChanges).toHaveBeenLastCalledWith(
      projectDir,
      expect.any(String),
      { kind: "exact-paths", paths: [readyPath] },
    );

    const revisedObservation = buildAutonomyIssueObservation({
      kind: "changed",
      rootCauseKey: issue.rootCauseKey,
      observedAt: "2026-08-13T11:00:00.000Z",
      source: { kind: "workflow", id: "builder", workflow: "builder" },
      severity: "critical",
      actionability: "local-code",
      labels: ["workflow-failure"],
      summaries: ["The fixture now carries explicit resolution evidence."],
      evidenceRefs: [{ kind: "run", ref: ".kota/runs/fixture-resolution" }],
      observationCount: 1,
      signalIds: ["signal-fixture-resolution"],
    });
    const revised = applyAutonomyIssueObservations({
      projectDir,
      observations: [revisedObservation],
    }).transitions[0]!;
    const resolved = await new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: triggerFor(revised.semanticRevision, "revised"),
      stepMocks: { "review-issue": RESOLVED_DISPOSITION },
    }).run();

    expect(resolved.status).toBe("success");
    const resolvedApplied = resolved.steps["apply-disposition"].output as {
      materialized: {
        taskId: string | null;
        actions: Array<{ kind: string; taskId?: string }>;
      };
    };
    expect(resolvedApplied.materialized).toMatchObject({
      taskId: null,
      actions: [expect.objectContaining({ kind: "dropped-task", taskId })],
    });
    expect(
      existsSync(join(projectDir, "data", "tasks", "dropped", `${taskId}.md`)),
    ).toBe(true);
    expect(mockedCommitWorkflowChanges).toHaveBeenLastCalledWith(
      projectDir,
      expect.any(String),
      {
        kind: "exact-paths",
        paths: [
          `data/tasks/dropped/${taskId}.md`,
          `data/tasks/ready/${taskId}.md`,
        ],
      },
    );
    expect(listAutonomyIssues(projectDir)[0]).toMatchObject({
      status: "resolved",
      links: { taskIds: [], ownerQuestionIds: [] },
    });
  });
});
