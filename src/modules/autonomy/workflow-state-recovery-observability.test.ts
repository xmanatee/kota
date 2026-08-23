import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deadLetterStoreForProject } from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import type { WorkflowStateRecoveryWorktreeEvidence } from "#modules/workflow-ops/state-recovery-provider.js";
import {
  claimTask,
  markTaskClaimPendingMerge,
  type TaskClaim,
  taskClaimPath,
} from "./task-claims.js";
import {
  claimInput,
  makeProject,
  writeOwnerRunMetadata,
  writeTask,
} from "./task-claims-test-support.js";
import { createWorkflowStateRecoveryProvider } from "./workflow-state-recovery.js";
import {
  readWorktreeEvidence,
  recommendedActionFor,
} from "./workflow-state-recovery-worktree.js";

describe("workflow state recovery observability", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function createPendingMergeClaim(
    taskId: string,
    runId: string,
    evidence: string,
  ): TaskClaim {
    writeTask(projectDir, "ready", taskId, "2026-06-27T00:00:00.000Z");
    const claimed = claimTask(
      claimInput(projectDir, taskId, runId, new Date("2026-06-27T00:01:00.000Z")),
    );
    expect(claimed.claimed).toBe(true);
    const pending = markTaskClaimPendingMerge({
      projectDir,
      taskId,
      runId,
      workflowId: "builder",
      evidence,
      now: new Date("2026-06-27T00:02:00.000Z"),
    });
    expect(pending.changed).toBe(true);
    if (pending.claim === null) throw new Error("expected pending-merge claim");
    return pending.claim;
  }

  function worktreeEvidence(
    state: string,
    runState: string | null,
  ): WorkflowStateRecoveryWorktreeEvidence {
    return {
      found: true,
      metadataPath: ".kota/worktrees/task-run.json",
      workspaceDir: ".worktrees/task-run",
      branch: "kota/task/task-run",
      state,
      runState,
      dirtyState: "clean",
      dirtyEntries: [],
      cleanupBlockers: [],
      mergeStatus: state,
      headCommit: null,
      uniqueCommits: [],
      uniqueCommitCount: 0,
      branchAhead: 0,
      branchBehind: 0,
    };
  }

  it("reports active instead of releasing while the owner appears active", () => {
    const claim = createPendingMergeClaim("task-active", "run-active", "owner still active");

    expect(recommendedActionFor(claim, "running", worktreeEvidence("merged", null))).toMatchObject({
      kind: "active",
    });
    expect(recommendedActionFor(claim, null, worktreeEvidence("removed", "active"))).toMatchObject({
      kind: "active",
    });
  });

  it("distinguishes preserved dirty work from branch integration blockers", () => {
    const claim = createPendingMergeClaim("task-dirty", "run-dirty", "owner run failed");
    const evidence = worktreeEvidence("active", null);
    evidence.dirtyState = "dirty";
    evidence.dirtyEntries = ["M src/example.ts"];

    expect(recommendedActionFor(claim, "failed", evidence)).toMatchObject({
      kind: "needs-review",
      reason: "worktree contains preserved uncommitted changes that need recovery review",
    });
  });

  it("does not inspect deleted branches for removed worktree metadata", () => {
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectDir });
    execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "initial"], {
      cwd: projectDir,
    });
    const claim = createPendingMergeClaim(
      "task-removed",
      "run-removed",
      "worktree already cleaned",
    );
    const worktreeDir = join(projectDir, ".kota", "worktrees");
    mkdirSync(worktreeDir, { recursive: true });
    writeFileSync(
      join(worktreeDir, "task-removed-run-removed.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        taskId: claim.taskId,
        runId: claim.runId,
        workflowId: claim.workflowId,
        owner: claim.owner,
        workspaceDir: join(projectDir, ".worktrees", "task-removed-run-removed"),
        branch: "kota/task/task-removed/run-removed",
        baseCommit: "HEAD",
        createdAt: "2026-06-27T00:01:00.000Z",
        updatedAt: "2026-06-27T00:03:00.000Z",
        state: "removed",
        copiedSetupFiles: [],
        removedAt: "2026-06-27T00:03:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const evidence = readWorktreeEvidence(projectDir, claim);

    expect(evidence).toMatchObject({
      found: false,
      state: "removed",
      uniqueCommits: [],
      uniqueCommitCount: 0,
      branchAhead: null,
      branchBehind: null,
    });
    expect(evidence.uniqueCommitError).toBeUndefined();
  });

  it("isolates resolution by project directory", () => {
    createPendingMergeClaim("task-shared", "run-shared", "owner run completed after merge");
    writeOwnerRunMetadata(projectDir, "run-shared", "builder", "success");
    const otherProject = makeProject();
    try {
      writeTask(otherProject, "ready", "task-shared", "2026-06-27T00:00:00.000Z");
      const otherClaim = claimTask(
        claimInput(otherProject, "task-shared", "run-shared", new Date("2026-06-27T00:01:00.000Z")),
      );
      expect(otherClaim.claimed).toBe(true);
      markTaskClaimPendingMerge({
        projectDir: otherProject,
        taskId: "task-shared",
        runId: "run-shared",
        workflowId: "builder",
        evidence: "owner run completed after merge",
        now: new Date("2026-06-27T00:02:00.000Z"),
      });
      writeOwnerRunMetadata(otherProject, "run-shared", "builder", "success");

      const provider = createWorkflowStateRecoveryProvider();
      const resolved = provider.resolve({
        projectDir,
        taskId: "task-shared",
        runId: "run-shared",
        action: "release",
        rationale: "release only this project",
        artifactRunId: "run-scope-a",
      });

      expect(resolved.ok).toBe(true);
      expect(existsSync(taskClaimPath(projectDir, "task-shared"))).toBe(false);
      expect(existsSync(taskClaimPath(otherProject, "task-shared"))).toBe(true);
    } finally {
      rmSync(otherProject, { recursive: true, force: true });
    }
  });

  it("links related open dead letters to existing dismiss and redrive commands", () => {
    createPendingMergeClaim("task-dlq", "run-dlq", "builder run failed after validation");
    writeOwnerRunMetadata(projectDir, "run-dlq", "builder", "failed");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const deadLetter = deadLetterStoreForProject(projectDir).record({
      type: "workflow-dispatch",
      scopeId,
      projectId: scopeId,
      owningModule: "workflow-runtime",
      sourceEventIds: [],
      affectedWorkflowNames: ["builder"],
      failure: {
        reason: "run-dlq failed before workflow dispatch completed",
        lastErrorClass: "execution",
        failedAt: "2026-06-27T00:03:00.000Z",
      },
      source: {
        kind: "workflow-dispatch",
        workflowName: "builder",
        triggerEvent: "autonomy.queue.available",
        triggerSchemaRef: null,
        failedRunId: "run-dlq",
        runDir: ".kota/runs/run-dlq",
      },
      redrive: {
        kind: "workflow",
        workflowName: "builder",
        source: {
          kind: "run-trigger",
          runId: "run-dlq",
        },
      },
      redactedProjection: {
        workflowName: "builder",
        runId: "run-dlq",
      },
      retention: { kind: "retain" },
    });
    const bus = new EventBus();
    const changed: Array<Record<string, unknown>> = [];
    bus.on("workflow.dead-letter.changed", (payload) => changed.push(payload));
    const provider = createWorkflowStateRecoveryProvider(makeStubEventProxy(bus));

    const listed = provider.list({ projectDir });

    expect(listed.ok).toBe(true);
    expect(listed.ok ? listed.worktrees : null).toEqual([]);
    expect(listed.ok ? listed.deadLetters : null).toEqual([
      expect.objectContaining({
        id: deadLetter.id,
      }),
    ]);
    const claim = listed.ok ? listed.claims[0] : null;
    expect(claim?.recommendedAction).toMatchObject({ kind: "supersede" });
    expect(claim?.relatedDeadLetters).toEqual([
      expect.objectContaining({
        id: deadLetter.id,
        status: "open",
        dismissCommand: `pnpm kota workflow dlq dismiss ${deadLetter.id} --reason "<reason>"`,
        redriveCommand: `pnpm kota workflow dlq redrive ${deadLetter.id} --reason "<reason>"`,
      }),
    ]);

    const resolved = provider.resolve({
      projectDir,
      taskId: "task-dlq",
      runId: "run-dlq",
      action: "supersede",
      rationale: "the failed owner run is terminal",
      dismissDeadLetters: true,
      artifactRunId: "run-dlq-recovery",
    });

    expect(resolved).toMatchObject({
      ok: true,
      artifact: { dismissedDeadLetterIds: [deadLetter.id] },
    });
    expect(changed).toEqual([
      expect.objectContaining({
        id: deadLetter.id,
        status: "dismissed",
        scopeId,
        projectId: scopeId,
      }),
    ]);
  });
});
