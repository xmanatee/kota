import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { registerTool } from "#core/tools/tool-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  WorkflowScenarioDriver,
  type WorkflowScenarioOptions,
  type WorkflowScenarioResult,
} from "#core/workflow/testing/testing-api.js";
import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { improvementHandoffRequested } from "#modules/autonomy/improvement-handoff.js";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { webFetchTool } from "#modules/web-access/web-fetch.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { automaticProgressReviewRequested } from "../progress-reviewer/events.js";
import { progressReviewTaskProposal } from "../progress-reviewer/progress-review/action-writers.js";
import type { ProgressReviewAgentOutput } from "../progress-reviewer/progress-review.js";
import { decodeProgressReviewConsumptionState, emptyProgressReviewConsumptionState, PROGRESS_REVIEW_STATE_KEY } from "../progress-reviewer/semantic-input-state.js";
import { publishProgressReview } from "../progress-reviewer/semantic-publication.js";
import {
  checkResearchRetryCapability,
  computeResourceFingerprint,
  renderRetryMarker,
  sourceAccessFingerprint,
} from "../research-retry/precondition.js";
import { scopeImprovementChanged } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import {
  emptyScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "../scope-improver/scope-policy-test-support.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY } from "../security-review/review-state.js";
import { PROGRESS_BOUNDARY_STATE_KEY } from "./semantic-reflection.js";
import dispatcherWorkflow from "./workflow.js";

function dispatcherDecision(result: WorkflowScenarioResult): Record<string, unknown> {
  return JSON.parse(readFileSync(join(result.runDirPath, "dispatcher-decision.json"), "utf8"));
}

function taskFixture(
  id: string,
  state: "open" | "blocked" | "done" | "dropped",
  options: {
    dependsOn?: string[];
    resources?: string[];
    marker?: string;
    priority?: "p0" | "p1" | "p2" | "p3";
  } = {},
): string {
  const terminal = state === "done" || state === "dropped";
  return [
    "---",
    `status: ${state}`,
    ...(terminal ? [] : [`priority: ${options.priority ?? "p2"}`]),
    ...(!terminal && options.dependsOn
      ? [`depends_on: [${options.dependsOn.join(", ")}]`]
      : []),
    "---",
    "",
    `# ${id}`,
    "",
    "Deliver the requested task outcome and verify the resulting behavior.",
    "",
    ...(state === "blocked" ? ["## Blocked on", "kind: operator-capture", "path: evidence", "description: Required operator evidence is unavailable", ""] : []),
    ...(options.resources
      ? [
          "## Resources",
          "",
          ...options.resources.map((url) => `- ${url}`),
          "",
        ]
      : []),
    ...(options.marker ? [options.marker, ""] : []),
  ].join("\n");
}

describe("dispatcher workflow", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-dispatcher-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
    mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
    const authority = new RunStateDatabase(join(workspaceRoot, ".kota"));
    authority.registerScope({ id: deriveDirectoryScopeId(workspaceRoot), rootPath: workspaceRoot, createdAt: new Date().toISOString() });
    authority.close();
    writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
    commitAll("scenario baseline");
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function git(args: readonly string[]): string {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function writeProjectFile(path: string, content: string): void {
    const fullPath = join(workspaceRoot, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  function commitAll(message: string): string {
    git(["add", "-A"]);
    if (git(["diff", "--cached", "--name-only"]) !== "") {
      git([
        "-c",
        "user.email=kota@example.test",
        "-c",
        "user.name=KOTA Test",
        "commit",
        "--no-gpg-sign",
        "-m",
        message,
      ]);
    }
    return git(["rev-parse", "HEAD"]);
  }

  async function runDispatcherScenario(
    options: Omit<WorkflowScenarioOptions, "workspaceRoot"> = {},
  ) {
    commitAll("scenario input");
    return new WorkflowScenarioDriver(dispatcherWorkflow, {
      ...options,
      workspaceRoot,
      ports: { runCommand: runGitEvidenceCommand, ...options.ports },
      scopePolicySnapshot:
        options.scopePolicySnapshot ?? scopePolicySnapshotForTest(workspaceRoot),
    }).run();
  }

  function writeSecurityReviewEvidence(args: {
    runId: string;
    completedAt: string;
    commitSha: string;
  }): void {
    const db = new RunStateDatabase(join(workspaceRoot, ".kota/scenario-state"));
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    db.registerScope({ id: scopeId, rootPath: workspaceRoot, createdAt: args.completedAt });
    const snapshot = db.readScopeStateValue(scopeId, SECURITY_REVIEW_STATE_KEY);
    db.compareAndSetScopeStateValue({ scopeId, key: SECURITY_REVIEW_STATE_KEY, expectedRevision: snapshot.revision,
      value: { ...decodeSecurityReviewState(null), lastReview: { runId: args.runId, head: args.commitSha, completedAt: args.completedAt } }, updatedAt: args.completedAt });
    db.close();
  }

  it.each(["passive", "autonomous"] as const)("keeps %s scopes without Git observable without dispatching repository work", async (mode) => {
    expect(dispatcherWorkflow.repository).toBe("none");
    const directoryRoot = mkdtempSync(join(tmpdir(), "kota-dispatcher-observe-"));
    try {
      const scopeId = deriveDirectoryScopeId(directoryRoot);
      const scopePolicySnapshot = scopePolicySnapshotForTest(directoryRoot, [{
        scopeId,
        reason: "Repository-free observe posture.",
        autonomy: { defaultMode: mode, maxMode: mode },
        writes: mode === "passive" ? { mode: "none" } : { mode: "scope-directory" },
      }]);
      writeFileSync(join(directoryRoot, "AGENTS.md"), "# Scope\n\n- Initial guidance.\n");
      const initial = computeScopeContentFingerprint(
        directoryRoot,
        scopePolicySnapshot.policy,
      );
      const state = createTestTransactionalRunState(join(directoryRoot, ".kota", "test-state"), scopeId);
      state.compareAndSet(
        SCOPE_IMPROVEMENT_STATE_KEY,
        0,
        {
          ...emptyScopeImprovementState(scopeId),
          lastRunAt: "2026-06-19T00:00:00.000Z",
          consumedFingerprint: initial.fingerprint,
        },
      );
      writeFileSync(join(directoryRoot, "AGENTS.md"), "# Scope\n\n- Revised guidance.\n");

      const result = await new WorkflowScenarioDriver(dispatcherWorkflow, {
        workspaceRoot: directoryRoot,
        scopePolicySnapshot,
        ports: { state },
      }).run();

      expect(result.error).toBeUndefined();
      expect(result.status, result.error).toBe("success");
      expect(result.emitted.some((event) => event.event === "autonomy.queue.available")).toBe(false);
      if (mode === "passive") {
        expect(result.emitted).toEqual(expect.arrayContaining([
          expect.objectContaining({
            event: scopeImprovementChanged.name,
            payload: expect.objectContaining({ automatic: true, boundary: "content-policy-changed" }),
          }),
        ]));
      } else {
        expect(result.emitted).toEqual([]);
        expect(dispatcherDecision(result)).toMatchObject({
          scopeBoundary: { shouldEmit: false, reason: expect.stringContaining("Git is unavailable") },
        });
      }
    } finally {
      rmSync(directoryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    { owner: "scope-improver" as const, taskState: "open" as const },
    { owner: "architecture-gardener" as const, taskState: "blocked" as const },
  ])("delivers deferred $owner evidence on idle after a $taskState intervention completes without another review", async ({ owner, taskState }) => {
    const handoff = {
      owner, topicKey: "improvement:guidance", targetScope: "AGENTS.md",
      reason: "Counterevidence challenges the intervention", evidenceIds: ["state:feedback"],
    };
    const review: ProgressReviewAgentOutput = {
      verdict: "needs-steering", summary: handoff.reason,
      findings: { localScope: { claims: [], followUpTasks: [] }, crossScope: { claims: [], followUpTasks: [] } },
      ownerQuestions: [], handoffs: [handoff],
    };
    stageGeneratedWorkProposal({ workspaceRoot, proposal: progressReviewTaskProposal({
      runId: "original-decision", review, task: {
        topicKey: handoff.topicKey, title: "Correct guidance", priority: "p1",
        problem: "Repeated operator corrections", howWeWillKnow: "Guidance matches intended behavior",
        evidenceIds: handoff.evidenceIds,
      },
    }) });
    const taskId = listFullRepoTasks(workspaceRoot)[0]!.id;
    if (taskState === "blocked") {
      appendFileSync(join(workspaceRoot, "data/tasks", `${taskId}.md`), "\n\n## Blocked on\nkind: operator-capture\npath: evidence\ndescription: Required operator evidence is unavailable\n");
      moveTaskById(workspaceRoot, taskId, "blocked");
    }
    const runDir = join(workspaceRoot, ".kota", "runs", "counterevidence");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "progress-review.json"), JSON.stringify({
      generatedAt: "2026-09-07T12:00:00.000Z", review,
      evidence: {
        semanticInput: { automatic: true, inputRevision: 1 },
        evidence: [{ id: "state:feedback", kind: "state", summary: handoff.reason, path: "feedback.md" }],
      },
    }));
    const pending = publishProgressReview({
      scopeRoot: workspaceRoot, sourceRunId: "counterevidence",
      currentState: emptyProgressReviewConsumptionState(workspaceRoot),
    });
    expect(pending.handoffs).toEqual([]);
    const accepted = pending.nextState.proposalObservations[0]!.pendingHandoff!;
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"), deriveDirectoryScopeId(workspaceRoot));
    state.compareAndSet(PROGRESS_REVIEW_STATE_KEY, 0, pending.nextState);
    const idle = () => runDispatcherScenario({
      trigger: { event: "runtime.idle", schemaRef: null, payload: {} }, ports: { state },
    });
    const before = await idle();
    expect(before.status, before.error).toBe("success");
    expect(before.emitted.some((entry) => entry.event === improvementHandoffRequested.name)).toBe(false);
    expect(listFullRepoTasks(workspaceRoot)[0]!.state).toBe(taskState);
    if (taskState === "blocked") moveTaskById(workspaceRoot, taskId, "open");
    moveTaskById(workspaceRoot, taskId, "done");
    // Each scenario reopens the persisted database; no new review publication
    // or agent evidence is supplied after the task completes.
    const completed = await idle();
    expect(completed.status, completed.error).toBe("success");
    expect(completed.emitted.filter((entry) => entry.event === improvementHandoffRequested.name)).toMatchObject([{
      payload: { owner, topicKey: handoff.topicKey, evidenceRefs: accepted.evidenceRefs,
        evidenceFingerprint: accepted.evidenceFingerprint,
        idempotencyKey: `improvement-handoff:${accepted.evidenceFingerprint}` },
    }]);
    expect(completed.emitted.some((entry) => entry.event === automaticProgressReviewRequested.name)).toBe(false);
    const receipt = decodeProgressReviewConsumptionState(state.read(PROGRESS_REVIEW_STATE_KEY).value, workspaceRoot);
    expect(receipt.lastConsumedRevision).toBe(1);
    expect(receipt.proposalObservations[0]!.pendingHandoff).toBeUndefined();
    expect(receipt.proposalObservations[0]!.handoffFingerprint).toBe(accepted.evidenceFingerprint);
    const repeated = await idle();
    expect(repeated.status, repeated.error).toBe("success");
    expect(repeated.emitted.some((entry) => entry.event === improvementHandoffRequested.name)).toBe(false);
    expect(listFullRepoTasks(workspaceRoot).map(({ id, state }) => ({ id, state }))).toEqual([{ id: taskId, state: "done" }]);
  });

  it("emits targeted task events even when retained history exceeds the step-output limit", async () => {
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"), scopeId);
    const observedAt = "2026-09-01T00:00:00.000Z";
    const runs = Array.from({ length: 1500 }, (_, i) => ({
      id: `historical-builder-${i}`, workflow: "builder", startedAt: observedAt,
      completedAt: observedAt, status: "success", delivery: "completed",
      errors: [], observationOnly: false,
    }));
    expect(Buffer.byteLength(JSON.stringify(runs))).toBeGreaterThan(256 * 1024);
    state.compareAndSet(PROGRESS_BOUNDARY_STATE_KEY, 0, {
      schemaVersion: 2, scopeId, inputRevision: 0, pending: null,
      baseline: { head: git(["rev-parse", "HEAD"]), ownerDecisionWatermark: null, runs, outcomeCohort: runs, observedAt },
    });
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-foo.md"),
      taskFixture("task-foo", "open"),
    );
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-bar.md"),
      taskFixture("task-bar", "open"),
    );
    const result = await runDispatcherScenario({ ports: { state } });
    expect(result.status, result.error).toBe("success");

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(2);
    expect(output.dispatchableCount).toBe(2);
    expect(
      result.emitted
        .filter((event) => event.event === "autonomy.queue.available")
        .map((event) => event.payload.taskId)
        .sort(),
    ).toEqual(["task-bar", "task-foo"]);
    expect(
      result.emitted
        .filter((event) => event.event === "autonomy.queue.available")
        .every((event) =>
          typeof event.payload.taskDigest === "string" &&
          event.payload.idempotencyKey ===
            `builder:${event.payload.taskId}:${event.payload.taskDigest}`
        ),
    ).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
  });

  it("keeps proposed tasks visible without admitting builder execution", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-proposed.md"),
      taskFixture("task-proposed", "open"),
    );
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const result = await runDispatcherScenario({
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot, [{
        scopeId,
        reason: "Proposed-task onboarding posture",
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
        writes: { mode: "scope-directory" },
      }]),
    });

    const output = dispatcherDecision(result) as {
      actionableCount: number;
      builderTaskIds: string[];
    };
    expect(output.actionableCount).toBe(1);
    expect(output.builderTaskIds).toEqual([]);
    expect(result.emitted.some((event) =>
      event.event === "autonomy.queue.available"
    )).toBe(false);
  });

  it("does not admit builder work when the complete write decision denies it", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-policy-denied.md"),
      taskFixture("task-policy-denied", "open"),
    );
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const result = await runDispatcherScenario({
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot, [{
        scopeId,
        reason: "Autonomy remains selected but local writes now require denial.",
        autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
        writes: { mode: "scope-directory" },
        ownerConfirmation: { localWrite: "deny" },
      }]),
    });

    const output = dispatcherDecision(result) as {
      actionableCount: number;
      builderTaskIds: string[];
    };
    expect(output.actionableCount).toBe(1);
    expect(output.builderTaskIds).toEqual([]);
    expect(result.emitted.some((event) =>
      event.event === "autonomy.queue.available"
    )).toBe(false);
  });

  it("parks malformed improvement config and keeps builder work undispatched", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-malformed-config.md"),
      taskFixture("task-malformed-config", "open"),
    );
    writeProjectFile(
      ".kota/scope-improvement/config.json",
      '{"enabled":"false"}\n',
    );

    const result = await runDispatcherScenario();
    const output = dispatcherDecision(result) as {
      builderTaskIds: string[];
      scopeBoundary: { shouldEmit: boolean; reason: string };
    };

    expect(output.builderTaskIds).toEqual([]);
    expect(output.scopeBoundary).toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("authority cannot be inspected"),
    });
    expect(result.emitted.some((event) =>
      event.event === "autonomy.queue.available"
    )).toBe(false);
  });


  it("dispatches the enabler first and releases its dependent after completion", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-dependent.md"),
      taskFixture("task-dependent", "open", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-enabler.md"),
      taskFixture("task-enabler", "open"),
    );
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(1);
    expect(output.dependencyBlockedTasks).toEqual([
      {
        id: "task-dependent",
        title: "task-dependent",
        state: "open",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ]);
    expect(output.builderTaskIds).toEqual(["task-enabler"]);
    expect(result.emitted.filter((e) => e.event === "autonomy.queue.available")).toMatchObject([
      { payload: { taskId: "task-enabler" } },
    ]);

    moveTaskById(workspaceRoot, "task-enabler", "done");
    const released = await runDispatcherScenario();
    expect(released.status, released.error).toBe("success");
    expect(dispatcherDecision(released)).toMatchObject({
      actionableCount: 1, dependencyBlockedTasks: [], builderTaskIds: ["task-dependent"],
    });
    expect(released.emitted.filter((e) => e.event === "autonomy.queue.available")).toMatchObject([
      { payload: { taskId: "task-dependent" } },
    ]);
  });

  it("emits autonomy.inbox.available when inbox has items", async () => {
    writeFileSync(join(workspaceRoot, "data", "inbox", "idea.md"), "Some idea\n");
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.inboxCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.inbox.available")).toBe(true);
  });

  it("emits autonomy.queue.empty when nothing to do", async () => {
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(output.dispatchableCount).toBe(0);
    expect(output.inboxCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("keeps dependency waits out of builder while allowing independent exploration", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-dependent-a.md"),
      taskFixture("task-dependent-a", "open", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-dependent-b.md"),
      taskFixture("task-dependent-b", "open", { dependsOn: ["task-enabler"] }),
    );
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-enabler.md"),
      taskFixture("task-enabler", "blocked"),
    );
    const result = await runDispatcherScenario();

    const dependencyBlockedTasks = [
      {
        id: "task-dependent-a",
        title: "task-dependent-a",
        state: "open",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
      {
        id: "task-dependent-b",
        title: "task-dependent-b",
        state: "open",
        dependsOn: ["task-enabler"],
        waitingOn: ["task-enabler"],
      },
    ];
    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(output.dependencyBlockedTasks).toEqual(expect.arrayContaining(dependencyBlockedTasks));
    expect(output.dependencyBlockedTasks).toHaveLength(2);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
  });



  it("does not dispatch when only blocked work remains", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-foo.md"),
      taskFixture("task-foo", "blocked"),
    );
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("emits blocked-research attemptable without queue.available for a blocked-only retry candidate", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-research.md"),
      taskFixture("task-research", "blocked", {
        resources: ["https://example.com/research-note"],
      }),
    );
    const unregister = registerTool(webFetchTool, async () => { throw new Error("Admission must not execute sources"); }, "web-access", { effect: networkReadEffect() });
    let result: WorkflowScenarioResult;
    try {
      result = await runDispatcherScenario();
    } finally {
      unregister();
    }

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(0);
    expect(output.researchRetryCandidateCount).toBe(1);
    expect(output.researchRetryAttemptableCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(true);
    const retryEvent = result.emitted.find(
      (e) => e.event === "autonomy.blocked-research.attemptable",
    );
    expect(retryEvent?.payload).toMatchObject({
      candidateCount: 1,
      attemptableCount: 1,
      counts: expect.objectContaining({ open: 0, blocked: 1, done: 0, dropped: 0 }),
    });
  });

  it("emits security-review due when security-sensitive source changed since review", async () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeSecurityReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-dispatcher",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile(
      "src/core/modules/registry-installers.ts",
      [
        "import { spawnSync } from 'node:child_process';",
        "export async function install(url: string): Promise<void> {",
        "  spawnSync('installer', [url]);",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    );
    commitAll("touch registry installer execution");

    const result = await runDispatcherScenario({
      ports: { runCommand: runGitEvidenceCommand },
    });

    const dueEvent = result.emitted.find((event) => event.event === "autonomy.security-review.due");
    expect(dueEvent?.payload).toMatchObject({
      due: true,
      reason: "high-risk-security-sensitive-change",
      changedPaths: ["src/core/modules/registry-installers.ts"],
      changedSurfaceCounts: [
        { surface: "external-fetch", pathCount: 1 },
        { surface: "tool-execution", pathCount: 1 },
      ],
    });
    const output = dispatcherDecision(result) as {
      securityReviewDue: { due: boolean; reason: string };
    };
    expect(output.securityReviewDue).toMatchObject({
      due: true,
      reason: "high-risk-security-sensitive-change",
    });
  });

  it("emits one scope review only for a changed content/policy fingerprint", async () => {
    writeProjectFile(".gitignore", ".kota/\n");
    writeProjectFile("AGENTS.md", "# Scope\n\n- Initial policy.\n");
    commitAll("initial scope policy");
    const scopePolicySnapshot = scopePolicySnapshotForTest(workspaceRoot);
    const initial = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshot.policy,
    );
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"), deriveDirectoryScopeId(workspaceRoot));
    state.compareAndSet(
      SCOPE_IMPROVEMENT_STATE_KEY,
      0,
      {
        ...emptyScopeImprovementState(scopePolicySnapshot.policy.scopeId),
        lastRunAt: "2026-06-19T00:00:00.000Z",
        consumedFingerprint: initial.fingerprint,
      },
    );
    const changedScopePolicySnapshot = scopePolicySnapshotForTest(
      workspaceRoot,
      [{
        scopeId: scopePolicySnapshot.policy.scopeId,
        reason: "Operator restricted writes for this scope.",
        writes: { mode: "none" },
      }],
      1,
    );

    const first = await runDispatcherScenario({
      scopePolicySnapshot: changedScopePolicySnapshot,
      ports: { state },
    });

    const evidenceEvent = first.emitted.find(
      (event) => event.event === scopeImprovementChanged.name,
    );
    expect(evidenceEvent?.payload).toMatchObject({
      automatic: true,
      boundary: "content-policy-changed",
      evidenceRefs: expect.arrayContaining([
        `scope-policy:${scopePolicySnapshot.policy.scopeId}`,
      ]),
    });
    const firstOutput = dispatcherDecision(first) as {
      scopeBoundary: { shouldEmit: boolean; fingerprint: string };
    };
    expect(firstOutput.scopeBoundary).toMatchObject({
      shouldEmit: true,
    });

    const second = await runDispatcherScenario({
      scopePolicySnapshot: changedScopePolicySnapshot,
      ports: { state },
    });

    expect(
      second.emitted.some(
        (event) => event.event === scopeImprovementChanged.name,
      ),
    ).toBe(false);
    const secondOutput = dispatcherDecision(second) as {
      scopeBoundary: { shouldEmit: boolean; reason: string };
    };
    expect(secondOutput.scopeBoundary.shouldEmit).toBe(false);
    expect(secondOutput.scopeBoundary.reason).toContain("already queued");
  });

  it("does not emit blocked-research attemptable when capability is missing", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-research.md"),
      taskFixture("task-research", "blocked", {
        resources: ["https://x.com/example/status/12345"],
      }),
    );
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.researchRetryCandidateCount).toBe(1);
    expect(output.researchRetryAttemptableCount).toBe(0);
    expect(
      result.emitted.some((e) => e.event === "autonomy.blocked-research.attemptable"),
    ).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("does not emit blocked-research attemptable for a recent source attempt with unchanged access", async () => {
    const resources = ["https://example.com/research-note"];
    const marker = renderRetryMarker({
      fingerprint: computeResourceFingerprint(resources),
      attemptedAt: new Date().toISOString(),
      attempts: resources.map((url) => ({
        url,
        attemptedAt: new Date().toISOString(),
        accessFingerprint: sourceAccessFingerprint(url, checkResearchRetryCapability(workspaceRoot, ["web_fetch"])),
        tools: ["web_fetch"],
        outcome: "unavailable",
      })),
    });
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-research.md"),
      taskFixture("task-research", "blocked", { resources, marker }),
    );
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.researchRetryCandidateCount).toBe(1);
    expect(output.researchRetryAttemptableCount).toBe(0);
    expect(
      result.emitted.some((e) => e.event === "autonomy.blocked-research.attemptable"),
    ).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
  });

  it("emits autonomy.queue.thin for a one-item active queue", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-foo.md"),
      taskFixture("task-foo", "open"),
    );
    const result = await runDispatcherScenario();

    const output = dispatcherDecision(result) as Record<string, unknown>;
    expect(output.actionableCount).toBe(1);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(true);
    expect(output.quiescent).toBe(false);
    expect(output.emitted).toContain("autonomy.queue.thin");
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
    expect(result.emitted.filter((e) => e.event === "autonomy.queue.available")).toMatchObject([
      { payload: { taskId: "task-foo" } },
    ]);
  });

  it("does not emit autonomy.queue.thin above the capacity reserve", async () => {
    writeProjectFile("data/tasks/task-d.md", taskFixture("task-d", "open"));
    writeProjectFile("data/tasks/task-e.md", taskFixture("task-e", "open"));
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-a.md"),
      taskFixture("task-a", "open"),
    );
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-b.md"),
      taskFixture("task-b", "open"),
    );
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-c.md"),
      taskFixture("task-c", "open"),
    );
    const result = await runDispatcherScenario();

    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
  });

  it("emits both queue.available and inbox.available when both have items", async () => {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-bar.md"),
      taskFixture("task-bar", "open"),
    );
    writeFileSync(join(workspaceRoot, "data", "inbox", "idea.md"), "Some idea\n");
    const result = await runDispatcherScenario();

    const emittedEvents = result.emitted.map((e) => e.event);
    expect(emittedEvents).toContain("autonomy.queue.available");
    expect(emittedEvents).toContain("autonomy.inbox.available");
    expect(emittedEvents).not.toContain("autonomy.queue.empty");
  });
});
