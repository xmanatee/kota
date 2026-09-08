import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { Scheduler } from "#core/daemon/scheduler.js";
import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { completeDaemonClientHandlers } from "#core/server/daemon-client-test-support.js";
import { daemonTransportFromAddress } from "#core/server/daemon-transport.js";
import { buildScopesDaemonHandler } from "#modules/daemon-ops/scopes-daemon.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

export const SCOPE_A: DirectoryScope = {
  scopeId: "scope-a",
  scopeRoot: "/tmp/scope-a",
  displayName: "Scope A",
};

export const SCOPE_B: DirectoryScope = {
  scopeId: "scope-b",
  scopeRoot: "/tmp/scope-b",
  displayName: "Scope B",
};

export function makeScopeRuntime(
  scope: DirectoryScope,
): ScopeRuntime {
  return {
    scope,
    scheduler: new Scheduler(scope.scopeRoot, null),
  } as unknown as ScopeRuntime;
}

export function readControlAddress(
  stateDir: string,
): DaemonControlAddress {
  return JSON.parse(
    readFileSync(join(stateDir, "daemon-control.json"), "utf-8"),
  ) as DaemonControlAddress;
}

export function buildDaemonScopeClient(
  address: DaemonControlAddress,
): KotaClient {
  const transport = daemonTransportFromAddress(address);
  return DaemonControlClient.fromTransport(
    transport,
    completeDaemonClientHandlers({ scopes: buildScopesDaemonHandler(transport) }),
  );
}
