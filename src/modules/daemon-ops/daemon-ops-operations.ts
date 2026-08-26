/**
 * Local-side helpers for the `daemonOps` namespace.
 *
 * The selector picks the daemon-control transport when a daemon is
 * reachable, so these helpers run only on the daemon-down path. They
 * read `.kota/daemon-control.json` (the daemon's published address) and
 * detect "not running" vs "stale control file" states without re-doing
 * that filesystem logic in the CLI handler.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import type { DaemonControlAddress, DaemonLiveStatus } from "#core/daemon/daemon-control.js";
import {
  isDaemonControlAddressReachable,
  readLiveDaemonControlAddress,
} from "#core/server/daemon-control-address.js";
import {
  type DaemonTransport,
  daemonTransportFromAddress,
} from "#core/server/daemon-transport.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import type {
  DaemonOpsClient,
  DaemonOpsPidResult,
  DaemonOpsReloadResult,
  DaemonOpsStatusResult,
  DaemonOpsStopResult,
} from "./client.js";
import { isServiceUnitInstalled } from "./service-install.js";

type DaemonOpsScopeOptions = {
  scopeRoot?: string;
};

export const DAEMON_STOP_ATTEMPTS_RELATIVE_PATH = join(
  ".kota",
  "daemon-ops",
  "stop-attempts.jsonl",
);

export type DaemonStopAttemptRecord = {
  kind: "daemon-stop-attempt";
  attemptedAt: string;
  timeoutSec: number;
  result: DaemonOpsStopResult;
};

export function recordDaemonStopAttempt(args: {
  scopeRoot: string;
  timeoutSec: number;
  result: DaemonOpsStopResult;
  attemptedAt?: string;
}): string {
  const path = join(args.scopeRoot, DAEMON_STOP_ATTEMPTS_RELATIVE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const record: DaemonStopAttemptRecord = {
    kind: "daemon-stop-attempt",
    attemptedAt: args.attemptedAt ?? new Date().toISOString(),
    timeoutSec: args.timeoutSec,
    result: args.result,
  };
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");
  return path;
}

function readControlAddress(options: DaemonOpsScopeOptions = {}): DaemonControlAddress | null {
  return readOptionalJsonFile<DaemonControlAddress>(
    join(resolveScopeRoot(options.scopeRoot), ".kota", "daemon-control.json"),
  );
}

export function localDaemonStatus(options: DaemonOpsScopeOptions = {}): DaemonOpsStatusResult {
  const serviceInstalled = isServiceUnitInstalled();
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") {
    return { state: "not_running", serviceInstalled };
  }
  if (!isProcessAlive(address.pid)) {
    return { state: "stale", serviceInstalled, pid: address.pid };
  }
  // The selector would have picked the daemon transport when it could
  // actually reach the daemon. Reaching here means the control file is
  // present but the daemon HTTP probe failed; preserve the live pid and
  // distinguish an unreachable daemon from a stale process.
  return { state: "unreachable", serviceInstalled, pid: address.pid };
}

export function localDaemonPid(options: DaemonOpsScopeOptions = {}): DaemonOpsPidResult {
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") return { state: "not_running" };
  if (!isProcessAlive(address.pid)) return { state: "stale", pid: address.pid };
  return { state: "running", pid: address.pid };
}

export async function stopDaemonPid(
  pid: number,
  timeoutSec = 90,
): Promise<DaemonOpsStopResult> {
  if (!isProcessAlive(pid)) return { ok: false, reason: "stale", pid };
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + Math.max(1, timeoutSec) * 1000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 500));
    if (!isProcessAlive(pid)) return { ok: true };
  }
  return { ok: false, reason: "timeout", pid };
}

async function verifyLocalStopTarget(
  address: DaemonControlAddress,
): Promise<DaemonOpsStopResult | null> {
  if (!isProcessAlive(address.pid)) return { ok: false, reason: "stale", pid: address.pid };
  if (typeof address.port !== "number" || typeof address.token !== "string") {
    return { ok: false, reason: "unavailable", pid: address.pid };
  }

  const status = await daemonTransportFromAddress(address).request<DaemonLiveStatus>(
    "GET",
    "/status",
  );
  if (!status || typeof status.pid !== "number" || status.pid !== address.pid) {
    return { ok: false, reason: "unavailable", pid: address.pid };
  }
  return null;
}

export async function localDaemonStop(
  options?: { timeoutSec?: number; scopeRoot?: string },
): Promise<DaemonOpsStopResult> {
  const scopeRoot = resolveScopeRoot(options?.scopeRoot);
  const timeoutSec = options?.timeoutSec ?? 90;
  const address = readControlAddress({ scopeRoot });
  let result: DaemonOpsStopResult;
  if (!address || typeof address.pid !== "number") {
    result = { ok: false, reason: "not_running" };
  } else {
    result = await verifyLocalStopTarget(address) ?? await stopDaemonPid(address.pid, timeoutSec);
  }
  if (!result.ok && result.reason !== "not_running") {
    recordDaemonStopAttempt({ scopeRoot, timeoutSec, result });
  }
  return result;
}

export function localDaemonReload(options: DaemonOpsScopeOptions = {}): DaemonOpsReloadResult {
  // Reload requires a live daemon HTTP endpoint; the local handler can
  // only honestly surface "not running" because the daemon is the
  // process that owns the reload pipeline.
  const address = readControlAddress(options);
  if (!address || typeof address.pid !== "number") return { ok: false, reason: "not_running" };
  if (!isProcessAlive(address.pid)) return { ok: false, reason: "not_running" };
  return { ok: false, reason: "reload_failed" };
}

export async function daemonOpsClientForScope(
  scopeRoot: string,
  buildDaemonClient: (link: DaemonTransport) => DaemonOpsClient,
): Promise<DaemonOpsClient> {
  const address = readLiveDaemonControlAddress(join(scopeRoot, ".kota"));
  if (address && await isDaemonControlAddressReachable(address)) {
    return buildDaemonClient(daemonTransportFromAddress(address));
  }
  return {
    status: async () => localDaemonStatus({ scopeRoot }),
    pid: async () => localDaemonPid({ scopeRoot }),
    stop: async (options) => localDaemonStop({ ...options, scopeRoot }),
    reload: async () => localDaemonReload({ scopeRoot }),
  };
}
