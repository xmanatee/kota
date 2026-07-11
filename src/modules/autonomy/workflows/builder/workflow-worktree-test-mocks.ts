import { vi } from "vitest";

type WorktreeSelector = {
  projectDir: string;
  taskId: string;
  runId: string;
};

type CreateWorktreeInput = WorktreeSelector & {
  workflowId: string;
  owner: string;
  baseRef?: string;
};

type WorktreeState = "active" | "removed";

function workspaceDir(selector: WorktreeSelector): string {
  return `${selector.projectDir}/.worktrees/${selector.taskId}-${selector.runId}`;
}

function branchName(selector: WorktreeSelector): string {
  return `kota/task/${selector.taskId}/${selector.runId}`;
}

function makeMetadata(
  selector: WorktreeSelector,
  state: WorktreeState,
  overrides: {
    workflowId?: string;
    owner?: string;
    baseCommit?: string;
  } = {},
) {
  return {
    schemaVersion: 1,
    taskId: selector.taskId,
    runId: selector.runId,
    workflowId: overrides.workflowId ?? "builder",
    owner: overrides.owner ?? "workflow:builder",
    workspaceDir: workspaceDir(selector),
    branch: branchName(selector),
    baseCommit: overrides.baseCommit ?? "abc1234",
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    state,
    copiedSetupFiles: [],
  };
}

function cleanDirtyState() {
  return {
    dirty: false,
    trackedDirty: false,
    untracked: false,
    conflicted: false,
    entries: [],
  };
}

function cleanPushState() {
  return {
    hasLocalCommits: false,
    remoteUpstream: null,
    aheadCount: 0,
    unpushed: false,
  };
}

vi.mock("#modules/git/worktree-lifecycle.js", () => ({
  cleanupAutomationWorktree: vi.fn((selector: WorktreeSelector) => ({
    removed: true,
    inspection: {
      metadata: makeMetadata(selector, "removed"),
      metadataPath: `${selector.projectDir}/.kota/worktrees/${selector.taskId}-${selector.runId}.json`,
      cleanup: { eligible: true, blockers: [] },
    },
  })),
  inspectAutomationWorktree: vi.fn((selector: WorktreeSelector) => ({
    metadata: makeMetadata(selector, "active"),
    metadataPath: `${selector.projectDir}/.kota/worktrees/${selector.taskId}-${selector.runId}.json`,
    exists: true,
    branch: branchName(selector),
    baseCommit: "abc1234",
    headCommit: "abc1234",
    dirty: cleanDirtyState(),
    lock: { locked: true, reason: "builder agent running" },
    push: cleanPushState(),
    cleanup: {
      eligible: false,
      blockers: ["worktree is locked: builder agent running"],
    },
  })),
  listAutomationWorktreeUniqueCommits: vi.fn(() => ({
    commits: [],
    branchAhead: 0,
    branchBehind: 0,
  })),
  reconcileAutomationWorktrees: vi.fn(() => ({
    inspected: 0,
    active: 0,
    unlocked: 0,
    removed: 0,
    preserved: 0,
    preservedDirty: 0,
    preservedBlocked: 0,
    items: [],
  })),
  unlockAutomationWorktree: vi.fn((selector: WorktreeSelector) => ({
    metadata: makeMetadata(selector, "active"),
    metadataPath: `${selector.projectDir}/.kota/worktrees/${selector.taskId}-${selector.runId}.json`,
    exists: true,
    branch: branchName(selector),
    baseCommit: "abc1234",
    headCommit: "abc1234",
    dirty: cleanDirtyState(),
    lock: { locked: false, reason: null },
    push: cleanPushState(),
    cleanup: { eligible: true, blockers: [] },
  })),
  createAutomationWorktree: vi.fn((input: CreateWorktreeInput) => {
    const baseCommit = input.baseRef ?? "abc1234";
    return {
      metadata: makeMetadata(input, "active", {
        workflowId: input.workflowId,
        owner: input.owner,
        baseCommit,
      }),
      metadataPath: `${input.projectDir}/.kota/worktrees/${input.taskId}-${input.runId}.json`,
      exists: true,
      branch: branchName(input),
      baseCommit,
      headCommit: baseCommit,
      dirty: cleanDirtyState(),
      lock: { locked: false, reason: null },
      push: cleanPushState(),
      cleanup: { eligible: true, blockers: [] },
    };
  }),
  lockAutomationWorktree: vi.fn((selector: WorktreeSelector) => ({
    metadata: makeMetadata(selector, "active"),
    metadataPath: `${selector.projectDir}/.kota/worktrees/${selector.taskId}-${selector.runId}.json`,
    exists: true,
    branch: branchName(selector),
    baseCommit: "abc1234",
    headCommit: "abc1234",
    dirty: cleanDirtyState(),
    lock: { locked: true, reason: "builder agent running" },
    push: cleanPushState(),
    cleanup: { eligible: false, blockers: ["worktree is locked: builder agent running"] },
  })),
  updateAutomationWorktreeRuntimeResources: vi.fn(
    (selector: WorktreeSelector, runtimeResources: object) => ({
      metadata: {
        ...makeMetadata(selector, "active"),
        runtimeResources,
      },
      metadataPath: `${selector.projectDir}/.kota/worktrees/${selector.taskId}-${selector.runId}.json`,
      exists: true,
      branch: branchName(selector),
      baseCommit: "abc1234",
      headCommit: "abc1234",
      dirty: cleanDirtyState(),
      lock: { locked: true, reason: "builder agent running" },
      push: cleanPushState(),
      cleanup: {
        eligible: false,
        blockers: ["worktree is locked: builder agent running"],
      },
    }),
  ),
}));
