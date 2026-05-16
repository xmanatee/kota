/**
 * Non-namespace daemon-side transport functions.
 *
 * `DaemonControlClient` exposes these as instance methods by thin
 * delegation. Every other daemon RPC reaches the daemon through its
 * owning module's `KotaClient` namespace; the four functions here are
 * the residual transport primitives the daemon-side server plumbing
 * (`kota serve`'s HTTP API) holds against a `DaemonControlClient`
 * directly. They have no namespace counterpart by design — operators
 * never call them from the CLI.
 *
 * Each function takes the typed `DaemonTransport` as its first argument
 * and matches the daemon HTTP wire shape exactly.
 */
import type {
  DaemonLiveStatus,
  DaemonSseStreamEvent,
} from "#core/daemon/daemon-control.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonTransport } from "./daemon-transport.js";

export function getDaemonStatus(
  transport: DaemonTransport,
): Promise<DaemonLiveStatus | null> {
  return transport.request("GET", "/status");
}

export async function registerSession(
  transport: DaemonTransport,
  id: string,
  createdAt: string,
  autonomyMode: AutonomyMode,
): Promise<boolean> {
  try {
    const resp = await transport.fetchRaw("/sessions/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, createdAt, autonomyMode }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function unregisterSession(
  transport: DaemonTransport,
  id: string,
): Promise<boolean> {
  try {
    const resp = await transport.fetchRaw(
      `/sessions/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return resp.ok || resp.status === 204;
  } catch {
    return false;
  }
}

export function events(transport: DaemonTransport): AsyncGenerator<DaemonSseStreamEvent> {
  return transport.events();
}
