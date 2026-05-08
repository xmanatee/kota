import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ClientDashboardAvailability, ClientIdentity } from "#core/daemon/client-identity.js";
import type { DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control-types.js";
import type { ConfiguredProject } from "#core/daemon/project-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { kvBlock, type RenderNode } from "#modules/rendering/primitives.js";
import { print, renderToString } from "#modules/rendering/transport.js";
import { formatUptime as formatUptimeFromIso } from "./format-utils.js";

/**
 * Operator-facing identity classification for the daemon-control file at
 * `<projectDir>/.kota/daemon-control.json`. Mirrors the Swift
 * `DaemonConnectionDiagnostic` arms: `kota status` and the macOS menu
 * bar should reach the same vocabulary for the same on-disk state so an
 * operator can diagnose a wrong-project mismatch without learning two
 * different vocabularies.
 */
export type DaemonControlIdentity =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "stale"; pid: number; baseURL: string }
  | { kind: "fresh"; pid: number; baseURL: string };

export type StatusSnapshot = {
  daemonRunning: boolean;
  daemonPid?: number;
  daemonUptimeMs?: number;
  activeRuns: number;
  queuedRuns: number;
  sessions: number;
  pendingApprovals: number;
  /** Project directory the CLI resolved before talking to the daemon. */
  projectDir: string;
  /** Display name (basename of `projectDir`). */
  projectName: string;
  /** Classification of `<projectDir>/.kota/daemon-control.json`. */
  controlFile: DaemonControlIdentity;
  /**
   * The daemon's own view of the project (from `GET /identity`). Present
   * only when the daemon answered the identity probe.
   */
  daemonProjectDir?: string;
  daemonProjectName?: string;
  /**
   * Multi-project daemon: the project the status snapshot is scoped to,
   * named alongside its absolute path. Present only when the daemon hosts
   * more than one configured project. Single-project daemons render the
   * existing `Project` line and skip this one.
   */
  scopedProject?: { projectId: string; projectDir: string; displayName: string };
  /**
   * True when the daemon answered `/identity` but its `projectDir` does
   * not match the CLI-resolved `projectDir`. The classic "wrong project"
   * mismatch from the 2026-04-28 incident.
   */
  wrongProject?: boolean;
  /**
   * Dashboard availability the daemon reports through `GET /identity`,
   * paired with the daemon base URL so the CLI surfaces the exact URL
   * an operator can open instead of guessing `localhost:3000`. Present
   * only when the identity probe succeeded; the field is omitted when
   * the daemon is unreachable so the CLI never renders a stale verdict.
   */
  dashboard?: StatusDashboard;
};

/**
 * Resolved dashboard verdict for one snapshot. The `available` arm
 * carries the fully qualified URL (daemon base URL joined with the
 * advertised path) so the CLI can render an exact target instead of
 * teaching every reader to splice base+path themselves. The
 * `unavailable` arm preserves the same `reason` / `message` the
 * daemon emitted so the CLI can explain *why* the dashboard is missing
 * (web UI not built, module disabled, init failed, …) without ad-hoc
 * string parsing.
 */
export type StatusDashboard =
  | { available: true; url: string }
  | { available: false; reason: string; message?: string };

function formatUptime(ms: number): string {
  return formatUptimeFromIso(new Date(Date.now() - ms).toISOString());
}

function describeControlFile(identity: DaemonControlIdentity): {
  value: string;
  role: "success" | "warn" | "error" | "muted";
} {
  switch (identity.kind) {
    case "missing":
      return { value: "missing  (no .kota/daemon-control.json)", role: "muted" };
    case "unreadable":
      return { value: "unreadable  (could not parse .kota/daemon-control.json)", role: "warn" };
    case "stale":
      return {
        value: `stale  (pid ${identity.pid} not alive — run \`kota doctor --fix\`)`,
        role: "warn",
      };
    case "fresh":
      return { value: `fresh  (pid ${identity.pid})`, role: "success" };
  }
}

/**
 * Derive the CLI-facing dashboard verdict from the daemon's typed
 * {@link ClientDashboardAvailability} payload and the daemon base URL.
 *
 * The daemon advertises `path` relative to its own base URL because the
 * request host the client used to reach the daemon (loopback, LAN IP,
 * remote tunnel) is the same host that should serve the dashboard. The
 * CLI joins the two so `kota status` prints a fully qualified URL — the
 * exact target an operator should paste into a browser, never a guessed
 * `localhost:3000`. Absolute URLs in `path` (e.g. an external dev server)
 * pass through unchanged because `new URL(absolute, base).toString()`
 * returns the absolute URL.
 */
export function resolveDashboardForStatus(
  dashboard: ClientDashboardAvailability,
  baseURL: string,
): StatusDashboard {
  if (dashboard.available) {
    const url = new URL(dashboard.path, baseURL).toString();
    return { available: true, url };
  }
  return {
    available: false,
    reason: dashboard.reason,
    ...(dashboard.message !== undefined && { message: dashboard.message }),
  };
}

function describeDashboard(dashboard: StatusDashboard): {
  value: string;
  role: "success" | "warn" | "muted";
} {
  if (dashboard.available) {
    return { value: `available  (${dashboard.url})`, role: "success" };
  }
  const suffix = dashboard.message ? `  — ${dashboard.message}` : "";
  return {
    value: `not available  (${dashboard.reason})${suffix}`,
    role: "warn",
  };
}

export function buildStatusNode(snap: StatusSnapshot): RenderNode {
  const daemonValue = snap.daemonRunning && snap.daemonPid != null
    ? `running  (pid ${snap.daemonPid}${snap.daemonUptimeMs != null ? `, up ${formatUptime(snap.daemonUptimeMs)}` : ""})`
    : "not running  (offline mode)";

  const approvalSuffix = snap.pendingApprovals > 0 ? "  ← requires attention" : "";

  const projectValue = `${snap.projectName}  (${snap.projectDir})`;
  const controlFile = describeControlFile(snap.controlFile);
  const baseURL = snap.controlFile.kind === "fresh" || snap.controlFile.kind === "stale"
    ? snap.controlFile.baseURL
    : null;

  const entries = [
    { label: "Project", value: projectValue, role: "info" as const },
    { label: "Control file", value: controlFile.value, role: controlFile.role },
  ];
  if (baseURL) {
    entries.push({ label: "Daemon URL", value: baseURL, role: "muted" as const });
  }
  if (snap.daemonProjectDir && snap.wrongProject) {
    entries.push({
      label: "Daemon project",
      value: `${snap.daemonProjectName ?? basename(snap.daemonProjectDir)}  (${snap.daemonProjectDir})  ← MISMATCH with selected project`,
      role: "warn" as const,
    });
  } else if (snap.daemonProjectDir) {
    entries.push({
      label: "Daemon project",
      value: `${snap.daemonProjectName ?? basename(snap.daemonProjectDir)}  (${snap.daemonProjectDir})`,
      role: "muted" as const,
    });
  }
  if (snap.scopedProject) {
    entries.push({
      label: "Active project",
      value: `${snap.scopedProject.displayName}  (${snap.scopedProject.projectDir})`,
      role: "info" as const,
    });
  }
  if (snap.dashboard) {
    const dash = describeDashboard(snap.dashboard);
    entries.push({ label: "Dashboard", value: dash.value, role: dash.role });
  }
  entries.push(
    { label: "Daemon", value: daemonValue, role: snap.daemonRunning ? "success" as const : "muted" as const },
    { label: "Runs", value: `${snap.activeRuns} active, ${snap.queuedRuns} queued`, role: "muted" as const },
    { label: "Sessions", value: `${snap.sessions} interactive`, role: "muted" as const },
    {
      label: "Approvals",
      value: `${snap.pendingApprovals} pending${approvalSuffix}`,
      role: snap.pendingApprovals > 0 ? "warn" as const : "muted" as const,
    },
  );

  return kvBlock(entries);
}

export function formatStatusOutput(snap: StatusSnapshot): string {
  return renderToString(buildStatusNode(snap));
}

/**
 * Pure classification of a `<projectDir>/.kota/daemon-control.json` on
 * disk. Mirrors the Swift `classifyDaemonControlFile` helper so both
 * surfaces map a missing / unreadable / stale / fresh control file to
 * the same operator-facing identity. Pid liveness is injected so unit
 * tests can simulate a stale lock without depending on a real OS pid.
 */
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

type StatusGatherOptions = {
  /**
   * Explicit `projectId` scope passed via `--project`. When omitted, the
   * daemon's `?projectId=` resolution falls back to the active selection
   * (and then to the registry default), so single-project setups behave
   * exactly as before.
   */
  projectId?: string;
};

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
      const pendingApprovals = approvalResult
        ? approvalResult.approvals.filter((a: PendingApproval) => a.status === "pending").length
        : 0;

      const identity = await link.request<ClientIdentity>("GET", "/identity");
      const projectsView = await link.request<{
        projects: ConfiguredProject[];
        defaultProjectId: string;
        activeProjectId: string | null;
      }>("GET", "/projects");
      const daemonProjectDir = identity?.projectDir;
      const daemonProjectName = identity?.projectName;
      const wrongProject = daemonProjectDir != null && daemonProjectDir !== projectDir;
      const baseURL =
        controlFile.kind === "fresh" || controlFile.kind === "stale"
          ? controlFile.baseURL
          : null;
      const dashboard =
        identity != null && baseURL != null
          ? resolveDashboardForStatus(identity.dashboard, baseURL)
          : undefined;

      const scopedProject = resolveScopedProject(projectsView, options.projectId);

      return {
        daemonRunning: true,
        daemonPid: status.pid ?? undefined,
        daemonUptimeMs: uptimeMs,
        activeRuns: status.workflow.activeRuns.length,
        queuedRuns: status.workflow.queueLength,
        sessions: status.sessions.length,
        pendingApprovals,
        projectDir,
        projectName,
        controlFile,
        ...(daemonProjectDir != null && { daemonProjectDir }),
        ...(daemonProjectName != null && { daemonProjectName }),
        ...(scopedProject != null && { scopedProject }),
        ...(wrongProject && { wrongProject }),
        ...(dashboard != null && { dashboard }),
      };
    }
  }

  const store = new WorkflowRunStore(projectDir);
  const state = store.readState();
  const queue = getApprovalQueue(join(stateDir, "approvals"));
  const pendingApprovals = queue.count("pending");

  return {
    daemonRunning: false,
    activeRuns: (state.activeRuns ?? []).length,
    queuedRuns: (state.pendingRuns ?? []).length,
    sessions: 0,
    pendingApprovals,
    projectDir,
    projectName,
    controlFile,
  };
}

/**
 * Resolve the project the snapshot is scoped to in a multi-project daemon.
 *
 * Returns `undefined` when the daemon hosts a single project (the existing
 * `Project` line already captures the only project), when the daemon did
 * not return a projects projection, or when the resolved id is not in the
 * registry. When the operator passes `--project <id>` we honor that
 * verbatim; otherwise we use the daemon's active selection, falling back
 * to the registry default so the line is always populated for
 * multi-project hosts.
 */
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

export function buildStatusCommand(_ctx: ModuleContext): Command {
  return new Command("status")
    .description("Show a concise operational snapshot: daemon, active runs, approvals, and cost")
    .option(
      "--project <id>",
      "Scope the snapshot to one configured project (default: daemon's active project)",
    )
    .action(async (opts: { project?: string }) => {
      const projectDir = resolveProjectDir();
      const snap = await gatherStatus(
        projectDir,
        opts.project ? { projectId: opts.project } : {},
      );
      print(buildStatusNode(snap));
      if (snap.pendingApprovals > 0) process.exit(1);
    });
}
