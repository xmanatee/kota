/**
 * Resolves the active `KotaClient` exactly once per CLI invocation.
 *
 * Policy:
 *   - If `.kota/daemon-control.json` is present and reachable, return the
 *     `DaemonControlClient` for that daemon. Module-contributed
 *     `daemonClient(link)` handlers override the same namespace in the
 *     core stub.
 *   - Otherwise build a `LocalKotaClient` from the local namespace
 *     handlers registered by modules during load.
 *
 * Subcommand-level dispatch never re-evaluates this decision.
 */
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { setActiveKotaClient } from "./client-holder.js";
import { DaemonControlClient } from "./daemon-client.js";
import {
  isDaemonControlAddressReachable,
  readLiveDaemonControlAddress,
} from "./daemon-control-address.js";
import { type DaemonTransport, daemonTransportFromAddress } from "./daemon-transport.js";
import type {
  DaemonClientHandlers,
  KotaClient,
  LocalClientHandlers,
} from "./kota-client.js";
import { buildLocalKotaClient } from "./local-kota-client.js";

export type ClientSelection =
  | { kind: "daemon"; client: DaemonControlClient; baseUrl: string }
  | { kind: "local"; client: KotaClient };

export type ResolveKotaClientOptions = {
  /** Override the `.kota/` state directory (default: `<projectDir>/.kota`). */
  stateDir?: string;
  /** Local-side handlers contributed by modules during load. */
  localHandlers: Partial<LocalClientHandlers>;
  /**
   * Daemon-side handler factory. Invoked with the resolved transport when
   * the daemon is reachable; the returned partial map overrides the same
   * namespaces in the core stub. The selector still falls back to the
   * fully-stubbed `DaemonControlClient.fromAddress(address)` shape when
   * the caller does not provide this hook.
   */
  assembleDaemonHandlers?: (
    transport: DaemonTransport,
  ) => Partial<DaemonClientHandlers>;
  /** Timeout for the daemon `/health` probe used before selecting daemon mode. */
  daemonReachabilityTimeoutMs?: number;
};

/**
 * Inspect `.kota/daemon-control.json` and return the daemon address when
 * one is published.
 */
export function readDaemonAddress(stateDir?: string): DaemonControlAddress | null {
  return readLiveDaemonControlAddress(stateDir);
}

/**
 * Build the active KotaClient for the current CLI invocation. Stores the
 * result in the module-level holder so `ModuleContext.client` resolves
 * to it.
 */
export async function resolveKotaClient(
  opts: ResolveKotaClientOptions,
): Promise<ClientSelection> {
  const address = readDaemonAddress(opts.stateDir);
  if (
    address &&
    (await isDaemonControlAddressReachable(
      address,
      opts.daemonReachabilityTimeoutMs,
    ))
  ) {
    const transport = daemonTransportFromAddress(address);
    const contributed = opts.assembleDaemonHandlers?.(transport);
    const client = DaemonControlClient.fromTransport(transport, contributed);
    setActiveKotaClient(client);
    return {
      kind: "daemon",
      client,
      baseUrl: `http://127.0.0.1:${address.port}`,
    };
  }
  const local = buildLocalKotaClient(opts.localHandlers);
  setActiveKotaClient(local);
  return { kind: "local", client: local };
}
