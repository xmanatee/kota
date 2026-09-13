import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
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
  readAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { planAutonomyIssueOwnerReconciliation } from "#modules/autonomy/autonomy-issue-reconciliation.js";
import {
  createGeneratedWorkQuestionQueue,
  generatedWorkQuestionDedupeKey,
} from "#modules/autonomy/generated-work-owner-question.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type AppliedDisposition,
  publishImproverDisposition,verifyImproverDispositionAfterReconcile, } from "./disposition-publication.js";
import improverWorkflow, { agent } from "./workflow.js";

const OBSERVED_DISPOSITION = {
  action: "observe" as const,
  recoveryAction: "" as const,
  rationale: "Evidence is diagnostic and does not justify implementation work yet.",
  taskTitle: "",
  taskDesiredOutcome: "",
  taskPriority: "p2" as const,
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
  taskDesiredOutcome: "Route the fixture failure through the normal builder lifecycle.",
  taskHowWeWillKnow: "The failure no longer recurs at the owning boundary.",
};

const ACCEPTED_DISPOSITION = {
  ...OBSERVED_DISPOSITION,
  action: "accept" as const,
  rationale: "The revised evidence proves the root cause is resolved.",
};

const RECOVERY_DISPOSITION = {
  ...OBSERVED_DISPOSITION,
  action: "recover" as const,
  recoveryAction: "doctor.fix" as const,
  rationale: "The cited runtime layout is eligible for the allowlisted doctor repair.",
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

  function openDoctorIssue() {
    mkdirSync(join(workspaceRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".kota", "daemon-control.json"),
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER }),
      "utf-8",
    );
    const observation = buildAutonomyIssueObservation({
      kind: "present",
      rootCauseKey: "operator-inbox:runtime:daemon-control-stale",
      observedAt: "2026-08-13T10:00:00.000Z",
      source: { kind: "inbox", id: "runtime:daemon-control-stale" },
      severity: "error",
      actionability: "owner-action",
      labels: ["operator-inbox", "runtime"],
      summaries: ["The daemon control file refers to a dead process."],
      evidenceRefs: [{ kind: "artifact", ref: ".kota/daemon-control.json" }],
      observationCount: 1,
      signalIds: ["doctor-recovery"],
    });
    projection = applyAutonomyIssueObservations({
      current: projection,
      observations: [observation],
    }).projection;
    return projection.issues[0]!;
  }

  function stateForProjection() {
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"));
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

  it("hands scoped incident content to the investigator in its isolated agent directory", async () => {
    const issue = openIssue();
    issue.evidenceRefs = [
      { kind: "module-log", ref: ".kota/modules/telegram/logs.jsonl" },
      { kind: "artifact", ref: ".kota/runs/incident/control-monitor-coverage.json" },
      { kind: "artifact", ref: ".kota/secrets.json" },
    ];
    issue.summaries = [];
    const state = stateForProjection();
    const database = RunStateDatabase.openExisting(state.stateDir);
    database.admitRun({ id: "incident", scopeId: state.scopeId, workflow: "probe", repository: "none", resources: [],
      admittedAt: "2026-09-12T00:00:00Z", trigger: { event: "manual", schemaRef: null, payload: {} } });
    database.close();
    mkdirSync(join(workspaceRoot, ".kota/modules/telegram"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".kota/runs/incident"), { recursive: true });
    const logHistory = Array.from({ length: 999 }, (_, index) => JSON.stringify({
      ts: "2026-09-12T00:00:00Z", level: "info", module: "telegram", msg: `poll ${index} ${"x".repeat(200)}`,
    }));
    logHistory.push(JSON.stringify({ ts: "2026-09-12T00:01:00Z", level: "error",
      module: "telegram", msg: "getUpdates conflict: competing consumer", data: { token: "private-token" },
    }));
    expect(Buffer.byteLength(logHistory.join("\n"))).toBeGreaterThan(128 * 1024);
    writeFileSync(join(workspaceRoot, ".kota/modules/telegram/logs.jsonl"), logHistory.join("\n"));
    writeFileSync(join(workspaceRoot, ".kota/runs/incident/control-monitor-coverage.json"), JSON.stringify({
      scopeId: state.scopeId, outcome: "control monitor missed deadline",
    }));
    writeFileSync(join(workspaceRoot, ".kota/secrets.json"), JSON.stringify({ value: "host-secret-content" }));
    let reviewed = false;
    const result = await new WorkflowScenarioDriver(improverWorkflow, {
      runId: "incident-investigator", workspaceRoot,
      trigger: { event: autonomyIssueDecisionRequested.name, payload: {
        issueKey: issue.issueKey, semanticRevision: issue.semanticRevision,
      } },
      ports: { state, runCommand: improverCommandRunner(workspaceRoot), runAgent: ({ cwd }) => {
        const selection = JSON.parse(readFileSync(join(workspaceRoot, ".kota/runs/incident-investigator/steps/select-issue.json"), "utf8"));
        const evidencePath = selection.output.evidencePath;
        const authority = RunStateDatabase.openReadOnly(state.stateDir);
        const sandbox = authority.getRun("incident-investigator")!.sandbox!;
        authority.close();
        expect(cwd).toBe(sandbox.workspaceDir);
        expect(evidencePath).toBe(join(sandbox.rootDir, "agent/issue-evidence.json"));
        expect(existsSync(join(cwd, ".kota/modules/telegram/logs.jsonl"))).toBe(false);
        const content = readFileSync(evidencePath, "utf8");
        expect(content).toContain("getUpdates conflict: competing consumer");
        expect(content).toContain("control monitor missed deadline");
        expect(content).toContain("Reference is not an authorized scoped diagnostic file");
        expect(content).not.toContain("host-secret-content");
        expect(content).not.toContain("private-token");
        reviewed = true;
        return { ...OBSERVED_DISPOSITION, rationale: "Scoped export confirms a competing Telegram consumer and a missed control deadline; existing recovery owner remains responsible." };
      } },
    }).run();
    expect(result.status, JSON.stringify(result)).toBe("success");
    expect(reviewed).toBe(true);
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
        requestKind: "transition",
        idempotencyKey:
          `autonomy-issue-investigation:${issue.issueKey}:${issue.semanticRevision}:0`,
      },
    };
    const first = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      trigger,
      stepOutputs: { "review-issue": OBSERVED_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(first.status, JSON.stringify(first, null, 2)).toBe("success");
    expect(first.steps["review-issue"].status).toBe("success");
    expect(projection.issues[0]?.disposition.kind).toBe("needs-decision");
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(first.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]?.disposition.kind).toBe("observed");

    const repeated = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      trigger,
      stepOutputs: { "review-issue": OBSERVED_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(repeated.status, repeated.error).toBe("success");
    expect(repeated.steps["select-issue"].output).toMatchObject({ eligible: false });
    expect(repeated.steps["review-issue"].status).toBe("skipped");
    const invariant = verifyImproverDispositionAfterReconcile;
    const input = {
      workspaceRoot,
      repoRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runId: basename(repeated.runDirPath),
      readState: <T = unknown>() => ({ revision: 1, value: projection as T }),
      workflowName: "improver",
      trigger: { ...trigger, schemaRef: null },
      baseHead: "unchanged-head",
      head: "unchanged-head",
      canonicalHead: "newer-canonical-head",
      signal: new AbortController().signal,
    };
    expect(invariant(input)).toEqual({ satisfied: true });
    expect(invariant({ ...input, head: "unexpected-writer-change" })).toMatchObject({
      satisfied: false,
    });
  });

  it("publishes an existing repair owner durably and rejects superseded review content", async () => {
    const issue = openIssue();
    const taskId = "task-existing-repair";
    const taskPath = join(workspaceRoot, "data/tasks", `${taskId}.md`);
    mkdirSync(join(workspaceRoot, "data/tasks"), { recursive: true });
    const content = "---\nstatus: blocked\npriority: p1\n---\n# Repair the fixture failure\n\n## Outcome\nRepair the owning boundary and verify the original failure.\n\n## Blocked on\nExternal provider recovery.\n";
    writeFileSync(taskPath, content);
    execFileSync("git", ["add", "data/tasks"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "existing repair owner"], { cwd: workspaceRoot });
    const state = stateForProjection();
    const result = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      trigger: { event: autonomyIssueDecisionRequested.name, payload: {
        issueKey: issue.issueKey, semanticRevision: issue.semanticRevision,
      } },
      stepOutputs: { "review-issue": { ...OBSERVED_DISPOSITION,
        action: "link-task", existingTaskId: taskId,
        rationale: "The existing repair contract covers the fixture boundary and its original failure verification; provider recovery is its external prerequisite.",
      } },
      ports: { state, runCommand: improverCommandRunner(workspaceRoot) },
    }).run();
    expect(result.status, JSON.stringify(result)).toBe("success");
    expect(result.steps["apply-disposition"].output).toMatchObject({
      materialized: { taskId, ownerQuestionId: null, touchedTaskQueue: false },
    });
    const sourceRunId = basename(result.runDirPath);
    const invariantInput = {
      workspaceRoot, repoRoot: workspaceRoot, stateDir: join(workspaceRoot, ".kota"),
      runId: sourceRunId, workflowName: "improver",
      trigger: { event: autonomyIssueDecisionRequested.name, schemaRef: null, payload: {} },
      readState: <T = unknown>() => ({ revision: 1, value: projection as T }),
      head: "head", baseHead: "head", canonicalHead: "head", signal: new AbortController().signal,
    };
    expect(verifyImproverDispositionAfterReconcile(invariantInput)).toEqual({ satisfied: true });
    writeFileSync(taskPath, content.replace("Repair the owning boundary", "A different outcome supersedes the original repair"));
    expect(verifyImproverDispositionAfterReconcile(invariantInput)).toMatchObject({ satisfied: false });
    expect(() => publishImproverDisposition({ scopeRoot: workspaceRoot, sourceRunId, currentProjection: projection }))
      .toThrow(/changed after ownership review/);
    writeFileSync(taskPath, content);
    projection = publishImproverDisposition({ scopeRoot: workspaceRoot, sourceRunId, currentProjection: projection }).nextProjection;
    expect(projection.issues[0]).toMatchObject({ status: "open", disposition: { kind: "task" }, links: { taskIds: [taskId], ownerQuestionIds: [] } });
    expect(publishImproverDisposition({ scopeRoot: workspaceRoot, sourceRunId, currentProjection: projection }).published).toBe(false);
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, state.read(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).revision, projection);
    const restarted = readAutonomyIssueProjection(workspaceRoot, state.stateDir);
    expect(restarted.issues[0]?.links.taskIds).toEqual([taskId]);
    expect(planAutonomyIssueOwnerReconciliation({ projection: restarted, tasks: listFullRepoTasks(workspaceRoot),
      runs: [], questions: [], requestedAt: new Date().toISOString(),
    })).toEqual([]);
    expect(readFileSync(taskPath, "utf8")).toBe(content);
    expect(listFullRepoTasks(workspaceRoot)).toHaveLength(1);
    expect(createGeneratedWorkQuestionQueue(workspaceRoot).list()).toEqual([]);
  });

  it("publishes verified deterministic recovery as a clear observation", async () => {
    const issue = openDoctorIssue();
    const result = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      trigger: {
        event: autonomyIssueDecisionRequested.name,
        payload: {
          scopeId: "scope-fixture",
          issueKey: issue.issueKey,
          rootCauseKey: issue.rootCauseKey,
          semanticRevision: issue.semanticRevision,
          transition: "opened",
          observedAt: issue.lastSeenAt,
          requestKind: "transition",
          idempotencyKey:
            `autonomy-issue-investigation:${issue.issueKey}:${issue.semanticRevision}:0`,
        },
      },
      stepOutputs: { "review-issue": RECOVERY_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    expect(result.steps["apply-disposition"].output).toMatchObject({
      recovery: {
        action: "doctor.fix",
        verification: expect.arrayContaining([
          expect.objectContaining({ action: "skipped" }),
        ]),
      },
    });
    writeFileSync(
      join(workspaceRoot, ".kota", "daemon-control.json"),
      JSON.stringify({ port: 8765, pid: Number.MAX_SAFE_INTEGER }),
      "utf-8",
    );
    expect(() => publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(result.runDirPath),
      currentProjection: projection,
    })).toThrow("cannot verify the original health contract");
    rmSync(join(workspaceRoot, ".kota", "daemon-control.json"));
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(result.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]).toMatchObject({
      status: "resolved",
      disposition: { kind: "cleared" },
      history: expect.arrayContaining([
        expect.objectContaining({
          kind: "cleared",
          summaries: [expect.stringContaining("doctor.fix")],
        }),
      ]),
    });
  });

  it("routes a repair through one stable task and resolves it on a revised issue", async () => {
    const issue = openIssue();
    const triggerFor = (
      semanticRevision: number,
      transition: "opened" | "revised",
    ) => ({
      event: autonomyIssueDecisionRequested.name,
      schemaRef: null,
      payload: {
        scopeId: "scope-fixture",
        issueKey: issue.issueKey,
        rootCauseKey: issue.rootCauseKey,
        semanticRevision,
        transition,
        observedAt: "2026-08-13T10:00:00.000Z",
        requestKind: "transition",
        idempotencyKey:
          `autonomy-issue-investigation:${issue.issueKey}:${semanticRevision}:0`,
      },
    });
    const created = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
      trigger: triggerFor(1, "opened"),
      stepOutputs: { "review-issue": TASK_DISPOSITION },
      ports: {
        runCommand: improverCommandRunner(workspaceRoot),
        state: stateForProjection(),
      },
    }).run();

    expect(created.status, JSON.stringify(created, null, 2)).toBe("success");
    const applied = created.steps["apply-disposition"].output as AppliedDisposition;
    const taskId = applied.materialized.taskId;
    expect(taskId).toEqual(expect.stringMatching(/^task-/));
    expect(
      existsSync(join(workspaceRoot, "data", "tasks", `${taskId}.md`)),
    ).toBe(true);
    expect(projection.issues[0]?.links.taskIds).toEqual([]);
    const invariant = verifyImproverDispositionAfterReconcile;
    const invariantInput = {
      workspaceRoot,
      repoRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      runId: basename(created.runDirPath),
      readState: <T = unknown>() => ({
        revision: 1,
        value: projection as T,
      }),
      workflowName: "improver",
      trigger: triggerFor(1, "opened"),
      head: "reconciled-head",
      baseHead: "base-head",
      canonicalHead: "canonical-head",
      signal: new AbortController().signal,
    };
    expect(invariant(invariantInput)).toEqual({ satisfied: true });
    const clearedProjection = applyAutonomyIssueObservations({
      current: projection,
      observations: [buildAutonomyIssueObservation({
        kind: "cleared",
        rootCauseKey: issue.rootCauseKey,
        observedAt: "2026-08-13T10:30:00.000Z",
        source: issue.source,
        severity: issue.severity,
        actionability: issue.actionability,
        labels: issue.labels,
        summaries: ["The fixture recovered while review was running."],
        evidenceRefs: [{ kind: "run", ref: ".kota/runs/fixture-clear" }],
        observationCount: 1,
        signalIds: ["signal-fixture-clear"],
      })],
    }).projection;
    expect(invariant({
      ...invariantInput,
      readState: <T = unknown>() => ({
        revision: 2,
        value: clearedProjection as T,
      }),
    })).toMatchObject({
      satisfied: false,
      reason: expect.stringContaining("changed after disposition review"),
    });
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(created.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]?.links.taskIds).toEqual([taskId]);
    expect(execFileSync("git", ["show", `HEAD:data/tasks/${taskId}.md`], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    })).toContain(TASK_DISPOSITION.taskTitle);

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
    const ownerQuestionQueue = createGeneratedWorkQuestionQueue(workspaceRoot);
    const pendingQuestion = ownerQuestionQueue.enqueue({
      dedupeKey: generatedWorkQuestionDedupeKey(applied.proposal.proposalKey),
      context: "Newer owner context",
      question: "Keep this newer owner question pending?",
      reason: "It belongs to the current issue revision.",
      source: "workflow-test",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "workflow-test" },
    });
    const stalePublication = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(created.runDirPath),
      currentProjection: projection,
      ownerQuestionQueue,
    });
    expect(stalePublication).toEqual({
      published: false,
      nextProjection: projection,
    });
    expect(ownerQuestionQueue.get(pendingQuestion.id)?.status).toBe("pending");
    const revised = revisedResult.transitions[0]!;
    const resolved = await new WorkflowScenarioDriver(improverWorkflow, {
      workspaceRoot,
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
      existsSync(join(workspaceRoot, "data", "tasks", "archive", `${taskId}.md`)),
    ).toBe(true);
    projection = publishImproverDisposition({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(resolved.runDirPath),
      currentProjection: projection,
    }).nextProjection;
    expect(projection.issues[0]).toMatchObject({
      status: "open",
      disposition: { kind: "accepted" },
      links: { taskIds: [], ownerQuestionIds: [] },
    });
  });
});
