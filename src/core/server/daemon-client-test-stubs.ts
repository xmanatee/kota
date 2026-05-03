/**
 * Shared test helpers for constructing a `DaemonControlClient` whose
 * non-namespace surface (transport, SSE, registerSession, ...) is the only
 * thing under test.
 *
 * As `KotaClient` namespaces migrate from the core stub into their owning
 * module's `daemonClient(link)` factory, those namespaces stop appearing in
 * `buildCoreStubDaemonClientHandlers`. A test that constructs a daemon
 * client purely to exercise an unrelated method must contribute a stub for
 * each migrated namespace; otherwise `assembleDaemonClientHandlers` fails
 * loudly. This module exports a single canonical stub builder so each
 * such test does not have to redeclare the throwing/no-op shapes itself.
 *
 * The stubs return empty results from the methods they implement. They
 * should never be invoked from a test that asserts namespace behavior; if
 * a test needs real behavior for a namespace, contribute a handler that
 * exercises it instead of relying on the stub.
 */
import type { DaemonClientHandlers } from "./kota-client.js";

/**
 * Build a `Partial<DaemonClientHandlers>` covering every namespace that
 * has migrated out of `buildCoreStubDaemonClientHandlers`. Tests that
 * exercise non-namespace daemon behavior should pass this map as the
 * `contributedHandlers` argument to `DaemonControlClient.fromAddress` (or
 * the `assembleDaemonHandlers` factory threaded through `startServer`)
 * so the assembly coverage check is satisfied.
 */
export function buildMigratedNamespaceTestStubs(): Partial<DaemonClientHandlers> {
  return {
    doctor: {
      run: async () => ({ checks: [] }),
      fix: async () => ({ repairs: [] }),
    },
    harnessParity: {
      list: async () => ({ scenarios: [] }),
      run: async () => ({ ok: true, outBaseDir: "", artifacts: [] }),
    },
  };
}
