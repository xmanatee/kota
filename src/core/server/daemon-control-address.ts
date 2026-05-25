import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { isProcessAlive } from "#core/util/process-alive.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";

/**
 * Read the published daemon-control address only when it still points at a
 * live process. Startup owns cleanup of stale files; CLI selection should
 * simply fall back to local handlers when the published pid is dead.
 */
export function readLiveDaemonControlAddress(
  stateDir?: string,
): DaemonControlAddress | null {
  const dir = stateDir ?? join(resolveProjectDir(), ".kota");
  const address = readOptionalJsonFile<DaemonControlAddress>(
    join(dir, "daemon-control.json"),
  );
  if (
    !address ||
    typeof address.port !== "number" ||
    typeof address.pid !== "number" ||
    !isProcessAlive(address.pid)
  ) {
    return null;
  }
  return address;
}

export async function isDaemonControlAddressReachable(
  address: DaemonControlAddress,
  timeoutMs = 500,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
