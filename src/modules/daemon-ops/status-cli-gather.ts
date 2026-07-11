import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control-types.js";
import type { ConfiguredProject } from "#core/daemon/scope-registry.js";
import { detectStrandedDaemonProcess } from "#core/daemon/stranded-daemon.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import {
  reconcileWorkflowRecovery,
  resolveWorkflowDispatchPause,
} from "#core/workflow/recovery-status.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { listAutomationWorktreeStatuses } from "#modules/git/worktree-lifecycle.js";
import { resolveDashboardForStatus } from "./status-cli-render.js";
import type {
  DaemonControlIdentity,
  StatusGatherOptions,
  StatusSnapshot,
} from "./status-cli-types.js";

type WorktreeStatus = ReturnType<typeof listAutomationWorktreeStatuses>[number];

export function classifyDaemonControlFile(
  projectDir: string,
  options: { processIsAlive?: (pid: number) => boolean } = {},
): DaemonControlIdentity {
  const { processIsAlive = isProcessAlive } = options;
  const controlPath = join(projectDir, ".kota", "daemon-control.json");
  if (!existsSync(controlPath)) {
    return { kind: "missing" };
  }
  let parsed: DaemonControlAddress;
  try {
    parsed = JSON.parse(readFileSync(controlPath, "utf-8")) as DaemonControlAddress;
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof parsed.port !== "number" || typeof parsed.pid !== "number") {
    return { kind: "unreadable" };
  }
  const baseURL = `http://127.0.0.1:${parsed.port}`;
  if (processIsAlive(parsed.pid)) {
    return { kind: "fresh", pid: parsed.pid, baseURL };
  }
  return { kind: "stale", pid: parsed.pid, baseURL };
}

export async function gatherStatus(
  projectDir: string,
  options: StatusGatherOptions = {},
): Promise<StatusSnapshot> {
  const stateDir = join(projectDir, ".kota");
  const link = getDaemonTransport(stateDir);
  const controlFile = classifyDaemonControlFile(projectDir);
  const projectName = basename(projectDir) || projectDir;
  const allWorktrees = sortWorktreeStatuses(listAutomationWorktreeStatuses(projectDir));
  const worktreeSummary = summarizeWorktrees(allWorktrees, options.includeRemovedWorktrees === true);
  const worktrees = allWorktrees.filter(
    (worktree) => options.includeRemovedWorktrees === true || worktree.state !== "removed",
  );

  if (link) {
    const statusPath = options.projectId
      ? `/status?projectId=${encodeURIComponent(options.projectId)}`
      : "/status";
    const status = await link.request<DaemonLiveStatus>("GET", statusPath);
    if (status) {
      const uptimeMs = status.startedAt
        ? Date.now() - new Date(status.startedAt).getTime()
        : undefined;
      const approvalResult = await link.request<{ approvals: PendingApproval[] }>(
        "GET",
        "/approvals?status=pending",
      );
      const identity = await link.request<ClientIdentity>("GET", "/identity");
      const projectsView = await link.request<{
        projects: ConfiguredProject[];
        defaultProjectId: string;
        activeProjectId: string | null;
      }>("GET", "/projects");
      return liveStatusSnapshot({
        projectDir,
        projectName,
        controlFile,
        status,
        uptimeMs,
        pendingApprovals: approvalResult
          ? approvalResult.approvals.filter((a) => a.status === "pending").length
          : 0,
        identity,
        projectsView,
        explicitProjectId: options.projectId,
        worktrees,
        worktreeSummary,
      });
    }
  }

  return offlineStatusSnapshot(projectDir, projectName, controlFile, worktrees, worktreeSummary);
}

function sortWorktreeStatuses(worktrees: WorktreeStatus[]): WorktreeStatus[] {
  return [...worktrees].sort((a, b) => {
    const byPriority = worktreePriority(a) - worktreePriority(b);
    return byPriority !== 0 ? byPriority : b.runId.localeCompare(a.runId);
  });
}

function worktreePriority(worktree: WorktreeStatus): number {
  if (worktree.state === "active") return 0;
  if (worktree.state === "stale" && worktree.dirtyState !== "clean") return 1;
  if (worktree.state === "stale") return 2;
  if (
    worktree.cleanupStatus === "blocked" ||
    worktree.state === "pending-merge" ||
    worktree.state === "conflicted"
  ) return 3;
  if (worktree.cleanupEligible || worktree.state === "merged") return 4;
  return 5;
}

function summarizeWorktrees(
  worktrees: WorktreeStatus[],
  includeRemoved: boolean,
): NonNullable<StatusSnapshot["worktreeSummary"]> | undefined {
  if (worktrees.length === 0) return undefined;
  return {
    active: worktrees.filter((worktree) => worktree.state === "active").length,
    staleDirty: worktrees.filter(
      (worktree) => worktree.state === "stale" && worktree.dirtyState !== "clean",
    ).length,
    staleClean: worktrees.filter(
      (worktree) => worktree.state === "stale" && worktree.dirtyState === "clean",
    ).length,
    blocked: worktrees.filter(
      (worktree) => worktree.cleanupStatus === "blocked" && worktree.state !== "removed",
    ).length,
    cleanupEligible: worktrees.filter((worktree) => worktree.cleanupEligible).length,
    removedHidden: includeRemoved ? 0 : worktrees.filter((worktree) => worktree.state === "removed").length,
  };
}

function liveStatusSnapshot(args: {
  projectDir: string;
  projectName: string;
  controlFile: DaemonControlIdentity;
  status: DaemonLiveStatus;
  uptimeMs: number | undefined;
  pendingApprovals: number;
  identity: ClientIdentity | null;
  projectsView: {
    projects: ConfiguredProject[];
    defaultProjectId: string;
    activeProjectId: string | null;
  } | null;
  explicitProjectId: string | undefined;
  worktrees: WorktreeStatus[];
  worktreeSummary: NonNullable<StatusSnapshot["worktreeSummary"]> | undefined;
}): StatusSnapshot {
  const daemonProjectDir = args.identity?.projectDir;
  const wrongProject = daemonProjectDir != null && daemonProjectDir !== args.projectDir;
  const baseURL =
    args.controlFile.kind === "fresh" || args.controlFile.kind === "stale"
      ? args.controlFile.baseURL
      : null;
  const dashboard =
    args.identity != null && baseURL != null
      ? resolveDashboardForStatus(args.identity.dashboard, baseURL)
      : undefined;
  const scopedProject = resolveScopedProject(args.projectsView, args.explicitProjectId);

  return {
    daemonRunning: true,
    daemonPid: args.status.pid ?? undefined,
    daemonUptimeMs: args.uptimeMs,
    activeRuns: args.status.workflow.activeRuns.length,
    queuedRuns: args.status.workflow.queueLength,
    workflowPaused: args.status.workflow.paused,
    ...(args.status.workflow.pause && { workflowPause: args.status.workflow.pause }),
    sessions: args.status.sessions.length,
    pendingApprovals: args.pendingApprovals,
    projectDir: args.projectDir,
    projectName: args.projectName,
    controlFile: args.controlFile,
    ...(daemonProjectDir != null && { daemonProjectDir }),
    ...(args.identity?.projectName != null && { daemonProjectName: args.identity.projectName }),
    ...(scopedProject != null && { scopedProject }),
    ...(wrongProject && { wrongProject }),
    ...(dashboard != null && { dashboard }),
    ...(args.status.workflow.recovery &&
      args.status.workflow.recovery.status !== "none" && {
        pendingRecovery: args.status.workflow.recovery,
      }),
    ...(args.worktrees.length > 0 && { worktrees: args.worktrees }),
    ...(args.worktreeSummary !== undefined && { worktreeSummary: args.worktreeSummary }),
  };
}

function offlineStatusSnapshot(
  projectDir: string,
  projectName: string,
  controlFile: DaemonControlIdentity,
  worktrees: WorktreeStatus[],
  worktreeSummary: NonNullable<StatusSnapshot["worktreeSummary"]> | undefined,
): StatusSnapshot {
  const stateDir = join(projectDir, ".kota");
  const store = new WorkflowRunStore(projectDir);
  const state = store.readState();
  const queue = getApprovalQueue(join(stateDir, "approvals"));
  const strandedDaemon = detectStrandedDaemonProcess(projectDir);
  const recovery = reconcileWorkflowRecovery({
    projectDir,
    store,
  });
  const pause = resolveWorkflowDispatchPause({
    projectDir,
    runtimePaused: false,
    recovery,
  });
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: queue.count("pending"),
    projectDir,
    projectName,
    controlFile,
    historicalWorkflow: {
      activeRuns: (state.activeRuns ?? []).length,
      queuedRuns: (state.pendingRuns ?? []).length,
      workflowPaused: pause.paused,
    },
    ...(pause.paused && { workflowPause: pause }),
    ...(recovery.status !== "none" && { pendingRecovery: recovery }),
    ...(strandedDaemon.kind === "stranded" && {
      strandedDaemon: { pid: strandedDaemon.pid, command: strandedDaemon.command },
    }),
    ...(worktrees.length > 0 && { worktrees }),
    ...(worktreeSummary !== undefined && { worktreeSummary }),
  };
}

function resolveScopedProject(
  view:
    | {
        projects: ConfiguredProject[];
        defaultProjectId: string;
        activeProjectId: string | null;
      }
    | null,
  explicitProjectId: string | undefined,
): { projectId: string; projectDir: string; displayName: string } | undefined {
  if (!view || view.projects.length <= 1) return undefined;
  const target = explicitProjectId ?? view.activeProjectId ?? view.defaultProjectId;
  const match = view.projects.find((p) => p.projectId === target);
  if (!match) return undefined;
  return {
    projectId: match.projectId,
    projectDir: match.projectDir,
    displayName: match.displayName,
  };
}
