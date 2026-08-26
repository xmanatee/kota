import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control-types.js";
import type { ConfiguredScope } from "#core/daemon/scope-registry.js";
import { detectStrandedDaemonProcess } from "#core/daemon/stranded-daemon.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { resolveWorkflowDispatchPause } from "#core/workflow/dispatch-pause.js";
import { readRunOperationalProjection } from "#core/workflow/run-operational-projection.js";
import type { RunSandbox } from "#core/workflow/run-sandbox.js";
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
  scopeRoot: string,
  options: { processIsAlive?: (pid: number) => boolean } = {},
): DaemonControlIdentity {
  const { processIsAlive = isProcessAlive } = options;
  const controlPath = join(scopeRoot, ".kota", "daemon-control.json");
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
  scopeRoot: string,
  options: StatusGatherOptions = {},
): Promise<StatusSnapshot> {
  const stateDir = join(scopeRoot, ".kota");
  const link = getDaemonTransport(stateDir);
  const controlFile = classifyDaemonControlFile(scopeRoot);
  const scopeName = basename(scopeRoot) || scopeRoot;

  if (link) {
    const statusPath = options.scopeId
      ? `/status?scopeId=${encodeURIComponent(options.scopeId)}`
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
      const scopesView = await link.request<{
        scopes: ConfiguredScope[];
        defaultScopeId: string;
        activeScopeId: string | null;
      }>("GET", "/scopes");
      const projectionScopeRoot = resolveProjectionScopeRoot(
        scopesView,
        options.scopeId,
        scopeRoot,
      );
      return liveStatusSnapshot({
        scopeRoot,
        scopeName,
        controlFile,
        status,
        uptimeMs,
        pendingApprovals: approvalResult
          ? approvalResult.approvals.filter((a) => a.status === "pending").length
          : 0,
        identity,
        scopesView,
        explicitScopeId: options.scopeId,
        runProjection: readStatusRunProjection(stateDir, projectionScopeRoot),
      });
    }
  }

  return offlineStatusSnapshot(
    scopeRoot,
    scopeName,
    controlFile,
    readStatusRunProjection(stateDir, scopeRoot),
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
  scopeRoot: string,
): StatusRunProjection {
  const projection = readRunOperationalProjection({ stateDir, scopeRoot: scopeRoot });
  return {
    ...projection,
    runs: projection.runs.map((run) => ({
      ...run,
      sandbox: statusRunSandbox(run.sandbox),
    })),
  };
}

function liveStatusSnapshot(args: {
  scopeRoot: string;
  scopeName: string;
  controlFile: DaemonControlIdentity;
  status: DaemonLiveStatus;
  uptimeMs: number | undefined;
  pendingApprovals: number;
  identity: ClientIdentity | null;
  scopesView: {
    scopes: ConfiguredScope[];
    defaultScopeId: string;
    activeScopeId: string | null;
  } | null;
  explicitScopeId: string | undefined;
  runProjection: StatusRunProjection;
}): StatusSnapshot {
  const daemonScopeRoot = args.identity?.scopeRoot;
  const wrongScope = daemonScopeRoot != null && daemonScopeRoot !== args.scopeRoot;
  const baseURL =
    args.controlFile.kind === "fresh" || args.controlFile.kind === "stale"
      ? args.controlFile.baseURL
      : null;
  const dashboard =
    args.identity != null && baseURL != null
      ? resolveDashboardForStatus(args.identity.dashboard, baseURL)
      : undefined;
  const selectedScope = resolveSelectedScope(args.scopesView, args.explicitScopeId);

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
    scopeRoot: args.scopeRoot,
    scopeName: args.scopeName,
    controlFile: args.controlFile,
    ...(daemonScopeRoot != null && { daemonScopeRoot }),
    ...(args.identity?.scopeName != null && { daemonScopeName: args.identity.scopeName }),
    ...(selectedScope != null && { selectedScope }),
    ...(wrongScope && { wrongScope }),
    ...(dashboard != null && { dashboard }),
    runProjection: args.runProjection,
  };
}

function offlineStatusSnapshot(
  scopeRoot: string,
  scopeName: string,
  controlFile: DaemonControlIdentity,
  runProjection: StatusRunProjection,
): StatusSnapshot {
  const stateDir = join(scopeRoot, ".kota");
  const queue = getApprovalQueue(join(stateDir, "approvals"));
  const strandedDaemon = detectStrandedDaemonProcess(scopeRoot);
  const pause = resolveWorkflowDispatchPause({
    scopeRoot: scopeRoot,
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
    scopeRoot,
    scopeName,
    controlFile,
    ...(pause.paused && { workflowPause: pause }),
    ...(strandedDaemon.kind === "stranded" && {
      strandedDaemon: { pid: strandedDaemon.pid, command: strandedDaemon.command },
    }),
    runProjection,
  };
}

function resolveProjectionScopeRoot(
  view:
    | {
        scopes: ConfiguredScope[];
        defaultScopeId: string;
        activeScopeId: string | null;
      }
    | null,
  explicitScopeId: string | undefined,
  fallbackScopeRoot: string,
): string {
  if (view === null) return fallbackScopeRoot;
  const target = explicitScopeId ?? view.activeScopeId ?? view.defaultScopeId;
  const match = view.scopes.find((scope) => scope.scopeId === target);
  if (match === undefined) {
    throw new Error(`Configured scope "${target}" is missing from the scope registry`);
  }
  if (match.directoryRoot === undefined) {
    throw new Error(`Configured scope "${target}" is not directory-backed`);
  }
  return match.directoryRoot;
}

function resolveSelectedScope(
  view:
    | {
        scopes: ConfiguredScope[];
        defaultScopeId: string;
        activeScopeId: string | null;
      }
    | null,
  explicitScopeId: string | undefined,
): { scopeId: string; scopeRoot: string; displayName: string } | undefined {
  if (!view || view.scopes.length <= 1) return undefined;
  const target = explicitScopeId ?? view.activeScopeId ?? view.defaultScopeId;
  const match = view.scopes.find((p) => p.scopeId === target);
  if (!match?.directoryRoot) return undefined;
  return {
    scopeId: match.scopeId,
    scopeRoot: match.directoryRoot,
    displayName: match.displayName,
  };
}
