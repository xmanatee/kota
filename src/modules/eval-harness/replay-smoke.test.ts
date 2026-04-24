/**
 * Replay-fixture smoke gate that runs inside the standard `pnpm test` pass.
 *
 * The cadence workflow runs every shipped fixture weekly; the CLI runs them on
 * demand. Until this test landed, neither path was reachable from the autonomy
 * builder's own `pnpm test` repair-loop check, so a workflow-layer regression
 * (replay adapter, subprocess executor, gather-run-data, repair loop, commit
 * step) could ship and only surface in a real autonomy run that paid a live
 * LLM bill. This test closes that gap by replaying a representative shipped
 * fixture end-to-end through the same `runFixture` + subprocess executor path
 * the cadence uses, asserting predicate pass.
 *
 * One fixture is enough — `improver-agent-call-replay` covers the
 * load-bearing surfaces in a single replay: workflow-step prompt routing,
 * judge-prompt routing (`semantic-gate-review` recording), gather-run-data
 * aggregation, the full repair-loop survival, the commit step's `git add -A`,
 * and the restart request. Adding the builder/decomposer fixtures here would
 * roughly double the smoke runtime without exercising additional workflow-
 * runtime branches; both stay in cadence-only coverage.
 *
 * The subprocess executor invokes `node bin/kota.mjs workflow exec ...`,
 * which loads `dist/cli.js`. The autonomy builder's repair loop runs
 * `pnpm build` before `pnpm test`, so dist matches source under autonomy.
 * Local devs who run `pnpm test` against a stale dist will see this test
 * surface that gap loudly rather than silently — which is the point.
 *
 * `pnpm test` sets `NODE_OPTIONS=--conditions=source` so vitest itself
 * imports the TypeScript sources. That env var would propagate to the
 * subprocess and make `dist/cli.js`'s `#core/*` imports resolve to
 * `.ts` files that plain `node` cannot load, so the subprocess crashes
 * before producing a run. The test clears `NODE_OPTIONS` for the child
 * to keep the production resolution path (default → `dist/*.js`) the
 * cadence and CLI subprocess paths use.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import type { ResourceProfile } from "./fixture-run.js";
import { cleanupFixtureWorkingDir, runFixture } from "./runner.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";

const PROJECT_DIR = fileURLToPath(new URL("../../..", import.meta.url));

const SMOKE_PROFILE: ResourceProfile = {
  hostClass: "pnpm-test-smoke",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const SMOKE_FIXTURE_ID = "improver-agent-call-replay";

describe("eval-harness shipped replay-fixture smoke gate", () => {
  it(
    `replays ${SMOKE_FIXTURE_ID} end-to-end through the subprocess executor`,
    async () => {
      const fixturesRoot = join(
        PROJECT_DIR,
        "src/modules/eval-harness/fixtures",
      );
      const fixture = loadFixture(fixturesRoot, SMOKE_FIXTURE_ID);
      const runArtifactBaseDir = mkdtempSync(
        join(tmpdir(), `kota-replay-smoke-${SMOKE_FIXTURE_ID}-`),
      );
      const executor = createSubprocessExecutor({
        kotaBinaryPath: resolve(join(PROJECT_DIR, "bin/kota.mjs")),
        extraEnv: { NODE_OPTIONS: "" },
      });
      const report = await runFixture({
        fixture,
        executor,
        resourceProfile: SMOKE_PROFILE,
        runArtifactBaseDir,
        runIndex: 0,
        repeatCount: 1,
      });
      try {
        const failingPredicates = report.predicateResults.filter(
          (r) => !r.passed,
        );
        expect(
          report.run.outcome,
          `replay smoke run did not pass: ${JSON.stringify(
            {
              executionOutcome: report.executionOutcome,
              failingPredicates,
            },
            null,
            2,
          )}`,
        ).toBe("pass");
        expect(failingPredicates).toHaveLength(0);
      } finally {
        cleanupFixtureWorkingDir(report.workingDir);
        rmSync(runArtifactBaseDir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
