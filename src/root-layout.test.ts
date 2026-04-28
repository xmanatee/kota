/**
 * Guard: `src/*.ts` must hold only entrypoint sources, their paired unit
 * tests, and cross-subsystem integration/e2e/repo-wide tests. Subsystem-
 * owned unit tests belong next to the code they exercise under
 * `src/core/<area>/` or `src/modules/<module>/`.
 *
 * This test enumerates the allowed cross-cutting entries explicitly and
 * fails if a new non-whitelisted `src/*.test.ts` lands at the root. See
 * `src/AGENTS.md` for the convention rationale.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = import.meta.dirname;

const ENTRYPOINT_SOURCES = new Set([
  "cli.ts",
  "init.ts",
  "module-api.ts",
  "validate-queue.ts",
  // The guard file itself counts as a repo-wide check, co-located with the
  // whitelist it enforces.
  "root-layout.ts",
]);

const ENTRYPOINT_PAIRED_TESTS = new Set([
  "cli.test.ts",
  "init.test.ts",
  "root-layout.test.ts",
]);

const CROSS_CUTTING_TESTS = new Set([
  "distributable-surfaces.test.ts",
  "docs-surface.test.ts",
  "e2e-advanced.test.ts",
  "e2e.test.ts",
  "integration.test.ts",
  "module-e2e.test.ts",
  "task-files.test.ts",
]);

// Shared fixtures co-located with the cross-cutting integration tests
// they support. Limited to fixtures that span multiple subsystems and
// therefore have no single owning module to live under.
const CROSS_CUTTING_FIXTURES = new Set([
  "conversational-cross-store-fixture.integration.ts",
]);

function listTopLevelTsFiles(): string[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const full = join(SRC_DIR, name);
      return statSync(full).isFile();
    });
}

describe("src/ root layout", () => {
  it("root .ts files match the enforced two-layer convention", () => {
    const files = listTopLevelTsFiles();
    const unexpected: string[] = [];

    for (const name of files) {
      if (ENTRYPOINT_SOURCES.has(name)) continue;
      if (ENTRYPOINT_PAIRED_TESTS.has(name)) continue;
      if (CROSS_CUTTING_TESTS.has(name)) continue;
      if (CROSS_CUTTING_FIXTURES.has(name)) continue;
      if (name.endsWith(".integration.test.ts")) continue;
      unexpected.push(name);
    }

    if (unexpected.length > 0) {
      const list = unexpected.map((n) => `  - ${n}`).join("\n");
      throw new Error(
        `src/ root may only contain entrypoint sources, their paired unit tests, ` +
          `and cross-subsystem integration/e2e/repo-wide tests.\n` +
          `Unexpected entries found:\n${list}\n` +
          `Move subsystem-owned unit tests beside their code under ` +
          `src/core/<area>/ or src/modules/<module>/. If the test legitimately ` +
          `spans multiple subsystems, rename it to *.integration.test.ts or ` +
          `extend the whitelist in src/root-layout.test.ts with a short reason.`,
      );
    }

    expect(unexpected).toEqual([]);
  });

  it("every whitelisted entrypoint source has a matching file on disk", () => {
    const files = new Set(listTopLevelTsFiles());
    const missing: string[] = [];
    for (const name of ENTRYPOINT_SOURCES) {
      if (!files.has(name)) missing.push(name);
    }
    // `root-layout.ts` is reserved for potential future non-test companion
    // code and may legitimately be absent.
    const stillMissing = missing.filter((n) => n !== "root-layout.ts");
    expect(stillMissing).toEqual([]);
  });
});
