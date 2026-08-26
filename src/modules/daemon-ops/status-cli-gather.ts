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
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { resolveWorkflowDispatchPause } from "#core/workflow/dispatch-pause.js";
import { readRunOperationalProjection } from "#core/workflow/run-operational-projection.js";
import type { RunSandbox } from "#core/workflow/run-sandbox.js";
import { readStoredWorkflowRuntimeState } from "#core/workflow/stored-runtime-state.js";
import { resolveDashboardForStatus } from "./status-cli-render.js";
import type {
  DaemonControlIdentity,
  StatusGatherOptions,
  StatusRunProjection,
  StatusRunSandbox,
  StatusSnapshot,
  StatusWorkspaceEvidence,
} from "./status-cli-types.js";

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
      const projectionProjectDir = resolveProjectionProjectDir(
        projectsView,
        options.projectId,
        projectDir,
      );
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
        runProjection: readStatusRunProjection(stateDir, projectionProjectDir),
      });
    }
  }

  return offlineStatusSnapshot(
    projectDir,
    projectName,
    controlFile,
    readStatusRunProjection(stateDir, projectDir),
  );
}

function readWorkspaceEvidence(workspaceDir: string): StatusWorkspaceEvidence {
  const workspace = getRepoWorktreeStatus(workspaceDir);
  if (!workspace.available) {
    return {
      available: false,
      headCommit: null,
      dirty: null,
      dirtySummary: workspace.summary,
    };
  }
  return {
    available: true,
    headCommit: workspace.headSha,
    dirty: workspace.dirty,
    dirtySummary: workspace.summary,
  };
}

function statusRunSandbox(sandbox: RunSandbox | null): StatusRunSandbox | null {
  if (sandbox === null) return null;
  const paths = {
    runId: sandbox.runId,
    rootDir: sandbox.rootDir,
    workspaceDir: sandbox.workspaceDir,
    tempDir: sandbox.tempDir,
    artifactDir: sandbox.artifactDir,
  };
  switch (sandbox.repository) {
    case "none":
      return {
        ...paths,
        repository: "none",
        branch: null,
        baseCommit: null,
        workspace: null,
      };
    case "read":
      return {
        ...paths,
        repository: "read",
        branch: null,
        baseCommit: sandbox.baseCommit,
        workspace: readWorkspaceEvidence(sandbox.workspaceDir),
      };
    case "write":
      return {
        ...paths,
        repository: "write",
        branch: sandbox.branch,
        baseCommit: sandbox.baseCommit,
        workspace: readWorkspaceEvidence(sandbox.workspaceDir),
      };
  }
}

export function readStatusRunProjection(
  stateDir: string,
  projectDir: string,
): StatusRunProjection {
  const projection = readRunOperationalProjection({ stateDir, projectDir });
  return {
    ...projection,
    runs: projection.runs.map((run) => ({
      ...run,
      sandbox: statusRunSandbox(run.sandbox),
    })),
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
  runProjection: StatusRunProjection;
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
    runProjection: args.runProjection,
  };
}

function offlineStatusSnapshot(
  projectDir: string,
  projectName: string,
  controlFile: DaemonControlIdentity,
  runProjection: StatusRunProjection,
): StatusSnapshot {
  const stateDir = join(projectDir, ".kota");
  const queue = getApprovalQueue(join(stateDir, "approvals"));
  const strandedDaemon = detectStrandedDaemonProcess(projectDir);
  const storedState = readStoredWorkflowRuntimeState(projectDir, stateDir);
  const pause = resolveWorkflowDispatchPause({
    operatorPaused: storedState.operatorPaused,
    runtimePaused: false,
  });
  const activeRuns = runProjection.runs.filter(
    (run) => run.state === "running" || run.state === "integrating",
  ).length;
  const queuedRuns = runProjection.runs.filter(
    (run) => run.state === "queued",
  ).length;
  return {
    daemonRunning: false,
    activeRuns,
    queuedRuns,
    workflowPaused: pause.paused,
    sessions: 0,
    pendingApprovals: queue.count("pending"),
    projectDir,
    projectName,
    controlFile,
    ...(pause.paused && { workflowPause: pause }),
    ...(strandedDaemon.kind === "stranded" && {
      strandedDaemon: { pid: strandedDaemon.pid, command: strandedDaemon.command },
    }),
    runProjection,
  };
}

function resolveProjectionProjectDir(
  view:
    | {
        projects: ConfiguredProject[];
        defaultProjectId: string;
        activeProjectId: string | null;
      }
    | null,
  explicitProjectId: string | undefined,
  fallbackProjectDir: string,
): string {
  if (view === null) return fallbackProjectDir;
  const target = explicitProjectId ?? view.activeProjectId ?? view.defaultProjectId;
  const match = view.projects.find((project) => project.projectId === target);
  if (match === undefined) {
    throw new Error(`Configured project "${target}" is missing from the project registry`);
  }
  return match.projectDir;
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
