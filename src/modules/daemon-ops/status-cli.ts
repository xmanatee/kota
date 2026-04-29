import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
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
   * True when the daemon answered `/identity` but its `projectDir` does
   * not match the CLI-resolved `projectDir`. The classic "wrong project"
   * mismatch from the 2026-04-28 incident.
   */
  wrongProject?: boolean;
};

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

export async function gatherStatus(projectDir: string): Promise<StatusSnapshot> {
  const stateDir = join(projectDir, ".kota");
  const client = DaemonControlClient.fromStateDir(stateDir);
  const controlFile = classifyDaemonControlFile(projectDir);
  const projectName = basename(projectDir) || projectDir;

  if (client) {
    const status = await client.getDaemonStatus();
    if (status) {
      const uptimeMs = status.startedAt
        ? Date.now() - new Date(status.startedAt).getTime()
        : undefined;
      const approvalResult = await client.listApprovals();
      const pendingApprovals = approvalResult
        ? approvalResult.approvals.filter((a) => a.status === "pending").length
        : 0;

      const identity = await client.getIdentity();
      const daemonProjectDir = identity?.projectDir;
      const daemonProjectName = identity?.projectName;
      const wrongProject = daemonProjectDir != null && daemonProjectDir !== projectDir;

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
        ...(wrongProject && { wrongProject }),
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

export function buildStatusCommand(): Command {
  return new Command("status")
    .description("Show a concise operational snapshot: daemon, active runs, approvals, and cost")
    .action(async () => {
      const projectDir = resolveProjectDir();
      const snap = await gatherStatus(projectDir);
      print(buildStatusNode(snap));
      if (snap.pendingApprovals > 0) process.exit(1);
    });
}
