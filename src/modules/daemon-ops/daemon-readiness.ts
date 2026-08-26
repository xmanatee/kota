import { join } from "node:path";
import {
  isDaemonControlAddressReachable,
  readLiveDaemonControlAddress,
} from "#core/server/daemon-control-address.js";

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_READY_POLL_MS = 100;

export async function isDaemonControlPlaneReady(projectDir: string): Promise<boolean> {
  const address = readLiveDaemonControlAddress(join(projectDir, ".kota"));
  return address !== null && await isDaemonControlAddressReachable(address);
}

export async function waitForDaemonControlPlane(
  projectDir: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_READY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  do {
    if (await isDaemonControlPlaneReady(projectDir)) return true;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollMs, remainingMs));
    });
  } while (Date.now() < deadline);
  return false;
}
