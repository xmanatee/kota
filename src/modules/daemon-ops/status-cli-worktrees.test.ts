import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatStatusOutput, type StatusSnapshot } from "./status-cli.js";

function makeSnap(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: true,
    daemonPid: 4242,
    daemonUptimeMs: 60_000,
    activeRuns: 1,
    queuedRuns: 2,
    workflowPaused: false,
    sessions: 1,
    pendingApprovals: 0,
    projectDir: "/Users/op/Desktop/mono/apps/kota",
    projectName: "kota",
    controlFile: { kind: "fresh", pid: 4242, baseURL: "http://127.0.0.1:8765" },
    daemonProjectDir: "/Users/op/Desktop/mono/apps/kota",
    daemonProjectName: "kota",
    dashboard: { available: true, url: "http://127.0.0.1:8765/" },
    ...overrides,
  };
}

function makeWorktree(
  overrides: Partial<NonNullable<StatusSnapshot["worktrees"]>[number]> = {},
): NonNullable<StatusSnapshot["worktrees"]>[number] {
  const taskId = overrides.taskId ?? "task-worktree-fixture";
  const runId = overrides.runId ?? "run-active";
  return {
    taskId,
    runId,
    workflowId: "builder",
    owner: "workflow:builder",
    workspaceDir: `/repo/.worktrees/${taskId}-${runId}`,
    metadataPath: `/repo/.kota/worktrees/${taskId}-${runId}.json`,
    exists: true,
    branch: `kota/task/${taskId}/${runId}`,
    baseCommit: "1111111111111111111111111111111111111111",
    headCommit: "2222222222222222222222222222222222222222",
    state: "active",
    metadataState: "active",
    runState: "active",
    dirtyState: "clean",
    dirtyEntries: [],
    mergeStatus: "not merged",
    cleanupStatus: "blocked",
    cleanupEligible: false,
    cleanupBlockers: ["worktree is locked: builder agent running"],
    nextAction: "wait for lock owner or unlock after verifying: builder agent running",
    ...overrides,
  };
}

function worktreeSnapshot(): StatusSnapshot {
  return makeSnap({
    worktreeSummary: {
      active: 1,
      staleDirty: 0,
      staleClean: 0,
      blocked: 3,
      cleanupEligible: 1,
      removedHidden: 66,
    },
    worktrees: [
      makeWorktree({
        taskId: "task-active-worktree",
        runId: "run-active",
        runtimeResources: {
          profileId: "task-active-worktree:run-active",
          agentRunDir:
            "/repo/.worktrees/task-active-worktree-run-active/.kota/runs/run-active",
          tempRoot: "/repo/.worktrees/task-active-worktree-run-active/.kota/tmp/run-active",
          artifactRoot: "/repo/.kota/runs/run-active/artifacts",
          ports: { start: 41_000, end: 41_019 },
        },
      }),
      makeWorktree({
        taskId: "task-pending-worktree",
        runId: "run-pending",
        state: "pending-merge",
        metadataState: "pending-merge",
        mergeStatus: "pending-merge: text conflicts require review",
        cleanupBlockers: ["worktree is pending merge"],
        nextAction: "review pending merge: text conflicts require review",
      }),
      makeWorktree({
        taskId: "task-conflicted-worktree",
        runId: "run-conflicted",
        state: "conflicted",
        dirtyState: "conflicted",
        dirtyEntries: ["UU README.md"],
        mergeStatus: "conflicted",
        cleanupBlockers: ["worktree has conflicted paths"],
        nextAction: "resolve merge conflicts before merge or cleanup",
      }),
      makeWorktree({
        taskId: "task-merged-worktree",
        runId: "run-merged",
        state: "merged",
        metadataState: "merged",
        mergeStatus: "merged: 3333333333333333333333333333333333333333",
        cleanupStatus: "eligible",
        cleanupEligible: true,
        cleanupBlockers: [],
        nextAction: "cleanup eligible for task-merged-worktree/run-merged",
      }),
      makeWorktree({
        taskId: "task-cleanup-blocked-worktree",
        runId: "run-cleanup-blocked",
        state: "merged",
        metadataState: "merged",
        dirtyState: "dirty",
        cleanupBlockers: ["worktree has untracked files"],
        nextAction: "inspect workspace changes before cleanup",
      }),
    ],
  });
}

function locateRunDir(): string | null {
  const env = process.env.KOTA_RUN_DIR;
  if (env) return env;
  const runs = join(process.cwd(), ".kota", "runs");
  if (!existsSync(runs)) return null;
  const entries = readdirSync(runs)
    .map((name) => ({ name, full: join(runs, name) }))
    .filter((entry) => statSync(entry.full).isDirectory())
    .sort((a, b) => statSync(b.full).mtimeMs - statSync(a.full).mtimeMs);
  return entries[0]?.full ?? null;
}

describe("formatStatusOutput automation worktrees", () => {
  it("renders lifecycle, cleanup, metadata, and next action details", () => {
    const out = formatStatusOutput(worktreeSnapshot());
    expect(out).toContain("Automation worktrees");
    expect(out).toContain("Removed hidden");
    expect(out).toContain("66");
    expect(out).toContain("task-active-worktree");
    expect(out).toContain("pending-merge");
    expect(out).toContain("conflicted");
    expect(out).toContain("Cleanup");
    expect(out).toContain("Run");
    expect(out).toContain("active");
    expect(out).toContain("eligible");
    expect(out).toContain("blocked: worktree has untracked files");
    expect(out).toContain("Runtime resources");
    expect(out).toContain("profile task-active-worktree:run-active");
    expect(out).toContain("ports 41000-41019");
    expect(out).toContain("temp /repo/.worktrees/task-active-worktree-run-active/.kota/tmp/run-active");
    expect(out).toContain("artifacts /repo/.kota/runs/run-active/artifacts");
    expect(out).toContain("Metadata");
    expect(out).toContain("Next");
  });

  it("can render only the compact summary when removed worktree metadata is hidden", () => {
    const out = formatStatusOutput(makeSnap({
      worktrees: [],
      worktreeSummary: {
        active: 0,
        staleDirty: 0,
        staleClean: 0,
        blocked: 0,
        cleanupEligible: 0,
        removedHidden: 66,
      },
    }));
    expect(out).toContain("Automation worktrees");
    expect(out).toContain("Removed hidden");
    expect(out).toContain("66");
    expect(out).not.toContain("Workspace");
  });

  it("does not render historical runtime resources for non-active worktrees", () => {
    const out = formatStatusOutput(makeSnap({
      worktrees: [
        makeWorktree({
          taskId: "task-stale-worktree",
          runId: "run-stale",
          state: "stale",
          runState: "finished",
          runtimeResources: {
            profileId: "task-stale-worktree:run-stale",
            agentRunDir: "/repo/.worktrees/task-stale-worktree/.kota/runs/run-stale",
            ports: { start: 42_000, end: 42_019 },
          },
        }),
      ],
    }));
    expect(out).toContain("task-stale-worktree");
    expect(out).not.toContain("Runtime resources");
    expect(out).not.toContain("ports 42000-42019");
  });

  it("writes a deterministic CLI transcript with active, merged, and cleanup-blocked worktrees", () => {
    const transcript = [
      "# CLI transcript: kota status automation worktrees",
      "# Generated by status-cli-worktrees.test.ts (deterministic, no daemon spawn).",
      "",
      "$ kota status",
      formatStatusOutput(worktreeSnapshot()),
      "",
    ].join("\n");
    expect(transcript).toContain("task-active-worktree");
    expect(transcript).toContain("task-merged-worktree");
    expect(transcript).toContain("blocked: worktree has untracked files");
    expect(transcript).toContain("Runtime resources");

    const runDir = locateRunDir();
    if (!runDir) return;
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "cli-worktree-status-transcript.txt"), transcript);
  });
});
