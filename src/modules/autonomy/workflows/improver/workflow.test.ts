import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  createWorkflowCommandRunner,
  type WorkflowCommandRunner,
} from "#core/workflow/workflow-command.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { publishImproverDisposition } from "./disposition-publication.js";
import improverWorkflow, { agent } from "./workflow.js";

const OBSERVED_DISPOSITION = {
  action: "observe" as const,
  rationale: "Evidence is diagnostic and does not justify implementation work yet.",
  taskTitle: "",
  taskSummary: "",
  taskPriority: "p2" as const,
  taskArea: "autonomy",
  taskClass: "Meta" as const,
  taskHowWeWillKnow: "",
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
  taskHowWeWillKnow: "The failure no longer recurs at the owning boundary.",
};

const ACCEPTED_DISPOSITION = {
  ...OBSERVED_DISPOSITION,
  action: "accept" as const,
  rationale: "The revised evidence proves the root cause is resolved.",
};

function improverCommandRunner(workspaceRoot: string): WorkflowCommandRunner {
  const runCommand = createWorkflowCommandRunner({ cwd: workspaceRoot });
  return (input) =>
    input.command === "git"
      ? runCommand(input)
      : successfulWorkflowCommandRun(input);
}

describe("improver issue disposition workflow", () => {
  let workspaceRoot: string;
  let projection: AutonomyIssueProjection;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-improver-issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
    execFileSync("git", ["config", "user.email", "scenario@kota.local"], {
      cwd: workspaceRoot,
    });
    execFileSync("git", ["config", "user.name", "KOTA scenario"], {
      cwd: workspaceRoot,
    });
    writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ scripts: { "validate-tasks": "true" } }),
      "utf-8",
    );
    execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "scenario baseline"], {
      cwd: workspaceRoot,
    });
    projection = emptyAutonomyIssueProjection();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
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
      current: projection,
      observations: [observation],
    });
    projection = result.projection;
    return result.projection.issues[0]!;
  }

  function stateForProjection() {
    const state = createTestTransactionalRunState();
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, 0, projection);
    return state;
  }

  it("has no generic successful-completion trigger or implementation write scope", () => {
    expect(improverWorkflow.triggers.map((trigger) => trigger.event)).toEqual([
      autonomyIssueDecisionRequested.name,
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
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision: issue.semanticRevision,
        transition: "opened",
        observedAt: issue.lastSeenAt,
      },
    };
    const first = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger,
      stepOutputs: { "review-issue": OBSERVED_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(first.status, JSON.stringify(first, null, 2)).toBe("success");
    expect(first.steps["review-issue"].status).toBe("success");
    expect(first.steps["write-disposition-artifact"].status).toBe("success");
    expect(projection.issues[0]?.disposition.kind).toBe("needs-decision");
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(first.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]?.disposition.kind).toBe("observed");

    const repeated = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger,
      stepOutputs: { "review-issue": OBSERVED_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(repeated.status).toBe("success");
    expect(repeated.steps["select-issue"].output).toMatchObject({ eligible: false });
    expect(repeated.steps["review-issue"].status).toBe("skipped");
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
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision,
        transition,
        observedAt: "2026-08-13T10:00:00.000Z",
      },
    });
    const created = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger: triggerFor(1, "opened"),
      stepOutputs: { "review-issue": TASK_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(created.status, JSON.stringify(created, null, 2)).toBe("success");
    const applied = created.steps["apply-disposition"].output as {
      materialized: { taskId: string | null };
    };
    const taskId = applied.materialized.taskId;
    expect(taskId).toEqual(expect.stringMatching(/^task-/));
    expect(
      existsSync(join(workspaceRoot, "data", "tasks", "ready", `${taskId}.md`)),
    ).toBe(true);
    expect(projection.issues[0]?.links.taskIds).toEqual([]);
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(created.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]?.links.taskIds).toEqual([taskId]);
    expect(created.steps["validate-changes"].status).toBe("success");
    execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "integrate repair task"], {
      cwd: workspaceRoot,
    });

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
    const revisedResult = applyAutonomyIssueObservations({
      current: projection,
      observations: [revisedObservation],
    });
    projection = revisedResult.projection;
    const revised = revisedResult.transitions[0]!;
    const resolved = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger: triggerFor(revised.semanticRevision, "revised"),
      stepOutputs: { "review-issue": ACCEPTED_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
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
      actions: expect.arrayContaining([
        expect.objectContaining({ kind: "dropped-task", taskId }),
        expect.objectContaining({ kind: "owner-question-dismissal-pending" }),
      ]),
    });
    expect(
      existsSync(join(workspaceRoot, "data", "tasks", "dropped", `${taskId}.md`)),
    ).toBe(true);
    expect(resolved.steps["validate-changes"].status).toBe("success");
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(resolved.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]).toMatchObject({
      status: "resolved",
      disposition: { kind: "accepted" },
      links: { taskIds: [], ownerQuestionIds: [] },
    });
  });
});
