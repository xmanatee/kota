/**
 * Resolves the active `KotaClient` exactly once per CLI invocation.
 *
 * Policy:
 *   - If `.kota/daemon-control.json` is present and reachable, return the
 *     `DaemonControlClient` for that daemon.
 *   - Otherwise build a `LocalKotaClient` from the local namespace
 *     handlers registered by modules during load.
 *
 * Subcommand-level dispatch never re-evaluates this decision.
 */
import { join } from "node:path";
import { resolveProjectDir } from "#core/config/project-dir.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { setActiveKotaClient } from "./client-holder.js";
import { DaemonControlClient } from "./daemon-client.js";
import type { KotaClient, LocalClientHandlers } from "./kota-client.js";
import { buildLocalKotaClient } from "./local-kota-client.js";

export type ClientSelection =
  | { kind: "daemon"; client: DaemonControlClient; baseUrl: string }
  | { kind: "local"; client: KotaClient };

export type ResolveKotaClientOptions = {
  /** Override the `.kota/` state directory (default: `<projectDir>/.kota`). */
  stateDir?: string;
  /** Local-side handlers contributed by modules during load. */
  localHandlers: Partial<LocalClientHandlers>;
};

/**
 * Inspect `.kota/daemon-control.json` and return the daemon address when
 * one is published.
 */
export function readDaemonAddress(stateDir?: string): DaemonControlAddress | null {
  const dir = stateDir ?? join(resolveProjectDir(), ".kota");
  const address = readOptionalJsonFile<DaemonControlAddress>(
    join(dir, "daemon-control.json"),
  );
  if (!address || typeof address.port !== "number") return null;
  return address;
}

/**
 * Build the active KotaClient for the current CLI invocation. Stores the
 * result in the module-level holder so `ModuleContext.client` resolves
 * to it.
 */
export function resolveKotaClient(
  opts: ResolveKotaClientOptions,
): ClientSelection {
  const address = readDaemonAddress(opts.stateDir);
  if (address) {
    const client = DaemonControlClient.fromAddress(address);
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
