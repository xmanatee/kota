/**
 * Authoritative whitelist for the `src/` root layout.
 *
 * `src/` has two layers (see `src/AGENTS.md`): entrypoint sources with their
 * paired unit tests, and cross-subsystem integration/e2e/repo-wide tests
 * with the shared fixtures they need. Every other unit test belongs next to
 * the code it exercises under `src/core/<area>/` or `src/modules/<module>/`.
 *
 * The layout guard test (`src/root-layout.test.ts`) consumes the complete
 * policy. The autonomy module-boundary repair check shares the production
 * entrypoint and cross-cutting fixture sets.
 */

export const ROOT_ENTRYPOINT_SOURCES: ReadonlySet<string> = new Set([
  "cli.ts",
  "check-hygiene.ts",
  "init.ts",
  "module-api.ts",
  "validate-queue.ts",
]);

export const ROOT_ENTRYPOINT_PAIRED_TESTS: ReadonlySet<string> = new Set([
  "cli.test.ts",
  "init.test.ts",
  "root-layout.test.ts",
]);

export const ROOT_CROSS_CUTTING_TESTS: ReadonlySet<string> = new Set([
  "distributable-surfaces.test.ts",
  "docs-surface.test.ts",
  "e2e-advanced.test.ts",
  "e2e.test.ts",
  "integration.test.ts",
  "module-e2e.test.ts",
]);

/**
 * Shared fixtures co-located with cross-cutting integration tests when they
 * span multiple subsystems and have no single owning module to live under.
 * The `.integration.ts` extension (no `.test`) signals that the file is a
 * fixture consumed by other tests, not a test itself.
 */
export const ROOT_CROSS_CUTTING_FIXTURES: ReadonlySet<string> = new Set([
  "conversational-cross-store-fixture.integration.ts",
  "daemon-test-support.integration.ts",
  "daemon-runtime-event-fixture.integration.ts",
  "daemon-runtime-routing-fixture.integration.ts",
  "daemon-remote-reconnect-client-fixture.integration.ts",
  "daemon-remote-reconnect-handle-fixture.integration.ts",
  "operator-authorization-boundary-fixture.integration.ts",
  "server-e2e-basic-cases.integration.ts",
  "server-e2e-runtime-cases.integration.ts",
  "workflow-step-executor-fixture.integration.ts",
]);
