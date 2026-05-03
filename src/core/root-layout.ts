/**
 * Authoritative whitelist for the `src/` root layout.
 *
 * `src/` has two layers (see `src/AGENTS.md`): entrypoint sources with their
 * paired unit tests, and cross-subsystem integration/e2e/repo-wide tests
 * with the shared fixtures they need. Every other unit test belongs next to
 * the code it exercises under `src/core/<area>/` or `src/modules/<module>/`.
 *
 * Three places consume this policy: the layout guard test
 * (`src/root-layout.test.ts`), the queue validator's
 * `listRootKernelHelperDebt` (`src/modules/repo-tasks/task-queue-validation.ts`),
 * and the autonomy module-boundary repair check
 * (`src/modules/autonomy/workflows/builder/repair-checks.ts`). They all
 * import from this single set so adding a new authorized root file requires
 * editing exactly one place.
 */

export const ROOT_ENTRYPOINT_SOURCES: ReadonlySet<string> = new Set([
  "cli.ts",
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
  "task-files.test.ts",
]);

/**
 * Shared fixtures co-located with cross-cutting integration tests when they
 * span multiple subsystems and have no single owning module to live under.
 * The `.integration.ts` extension (no `.test`) signals that the file is a
 * fixture consumed by other tests, not a test itself.
 */
export const ROOT_CROSS_CUTTING_FIXTURES: ReadonlySet<string> = new Set([
  "conversational-cross-store-fixture.integration.ts",
]);
