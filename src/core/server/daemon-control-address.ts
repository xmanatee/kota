import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { OUTBOUND_HTTP_PROFILES, outboundHttp } from "#core/outbound-http/index.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { isProcessAlive } from "#core/util/process-alive.js";

/**
 * Read the published daemon-control address only when it still points at a
 * live process. Startup owns cleanup of stale files; CLI selection should
 * simply fall back to local handlers when the published pid is dead.
 */
export function readLiveDaemonControlAddress(stateDir?: string): DaemonControlAddress | null {
  const dir = stateDir ?? join(resolveProjectDir(), ".kota");
  const address = readOptionalJsonFile<DaemonControlAddress>(join(dir, "daemon-control.json"));
  if (!address || typeof address.port !== "number" || typeof address.pid !== "number" || !isProcessAlive(address.pid)) {
    return null;
  }
  return address;
}

export async function isDaemonControlAddressReachable(
  address: DaemonControlAddress,
  timeoutMs = 500,
): Promise<boolean> {
  try {
    const { response } = await outboundHttp.request({
      profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
      operation: "daemon-control.health-probe",
      url: `http://127.0.0.1:${address.port}/health`,
      limits: {
        timeoutMs,
        responseBytes: 64 * 1024,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
