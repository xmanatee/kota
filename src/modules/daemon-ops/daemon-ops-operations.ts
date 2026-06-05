/**
 * Local-side helpers for the `daemonOps` namespace.
 *
 * The selector picks the daemon-control transport when a daemon is
 * reachable, so these helpers run only on the daemon-down path. They
 * read `.kota/daemon-control.json` (the daemon's published address) and
 * detect "not running" vs "stale control file" states without re-doing
 * that filesystem logic in the CLI handler.
 */
import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import type {
  DaemonOpsPidResult,
  DaemonOpsReloadResult,
  DaemonOpsStatusResult,
  DaemonOpsStopResult,
} from "./client.js";
import { isServiceInstalled } from "./service-install.js";

type DaemonOpsProjectOptions = {
  projectDir?: string;
};

function readControlAddress(options: DaemonOpsProjectOptions = {}): DaemonControlAddress | null {
  return readOptionalJsonFile<DaemonControlAddress>(
    join(resolveProjectDir(options.projectDir), ".kota", "daemon-control.json"),
  );
}

export function localDaemonStatus(options: DaemonOpsProjectOptions = {}): DaemonOpsStatusResult {
  const managed = isServiceInstalled();
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") {
    return { state: "not_running", managed };
  }
  if (!isProcessAlive(address.pid)) {
    return { state: "stale", managed, pid: address.pid };
  }
  // The selector would have picked the daemon transport when it could
  // actually reach the daemon. Reaching here means the control file is
  // present but the daemon HTTP probe failed; surface that as stale-ish
  // by reporting not_running with the live pid recorded so the operator
  // can investigate.
  return { state: "stale", managed, pid: address.pid };
}

export function localDaemonPid(options: DaemonOpsProjectOptions = {}): DaemonOpsPidResult {
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") return { state: "not_running" };
  if (!isProcessAlive(address.pid)) return { state: "stale", pid: address.pid };
  return { state: "running", pid: address.pid };
}

export async function localDaemonStop(
  options?: { timeoutSec?: number; projectDir?: string },
): Promise<DaemonOpsStopResult> {
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") return { ok: false, reason: "not_running" };
  const pid = address.pid;
  if (!isProcessAlive(pid)) return { ok: false, reason: "stale", pid };
  process.kill(pid, "SIGTERM");
  const timeoutSec = Math.max(1, options?.timeoutSec ?? 90);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 500));
    if (!isProcessAlive(pid)) return { ok: true };
  }
  return { ok: false, reason: "timeout", pid };
}

export function localDaemonReload(options: DaemonOpsProjectOptions = {}): DaemonOpsReloadResult {
  // Reload requires a live daemon HTTP endpoint; the local handler can
  // only honestly surface "not running" because the daemon is the
  // process that owns the reload pipeline.
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") return { ok: false, reason: "not_running" };
  if (!isProcessAlive(address.pid)) return { ok: false, reason: "not_running" };
  return { ok: false, reason: "reload_failed" };
}
