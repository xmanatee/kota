/**
 * Replay-fixture smoke gate that runs inside the standard `pnpm test` pass.
 *
 * The cadence workflow runs every shipped fixture weekly; the CLI runs them on
 * demand. Until this test landed, neither path was reachable from the autonomy
 * builder's own `pnpm test` repair-loop check, so a workflow-layer regression
 * (replay adapter, subprocess executor, gather-run-data, repair loop, commit
 * step) could ship and only surface in a real autonomy run that paid a live
 * LLM bill. This test closes that gap by replaying representative shipped
 * fixtures end-to-end through the same `runFixture` + subprocess executor path
 * the cadence uses, asserting predicate pass.
 *
 * Six fixtures cover the full set of workflow-runtime branches we want to
 * gate at `pnpm test` time:
 *   - `decomposer-agent-call-replay` is the smallest fixture and is the only
 *     one whose repair loop runs `pnpm run validate-tasks` against the
 *     fixture's tmp project root, so it gates the task-validator-as-repair-
 *     check path against silent regression.
 *   - `improver-agent-call-replay` covers judge-prompt routing
 *     (`semantic-gate-review` recording) and gather-run-data aggregation in
 *     a way the other shipped replay fixtures do not.
 *   - `explorer-agent-call-replay` covers the explorer's post-agent plumbing
 *     (the `record-exploration` state-file rewrite, the
 *     `apply-watchlist-updates` reader's empty-apply path, the five explorer
 *     repair checks, and the `{{NOW_MINUS_HOURS:N}}` templating hook for the
 *     `explorer-state.json` seed) that none of the other shipped replays
 *     exercise.
 *   - `inbox-sorter-agent-call-replay` covers the `autonomy.inbox.available`
 *     trigger receipt path, the `inspect-inbox` `needsAttention` gating
 *     shape (a `getRepoTaskQueueSnapshot` + tracked-changes-outside-inbox
 *     guard before the agent step), and the inbox-sorter-specific
 *     repair-check tuple (`task-queue-valid` with `--min-ready 0`).
 *   - `research-retry-agent-call-replay` covers the
 *     `inspect-candidates` selection-and-evaluation path
 *     (`runtime-detect.isPlaywrightAvailable` + `readBrowserConfig`,
 *     `candidates.listResearchRetryCandidates`,
 *     `precondition.evaluateCandidate`'s URL classification + marker
 *     fingerprint), the `mark-attempt` post-agent fingerprint-marker
 *     writeback, and the research-retry repair-check tuple
 *     (`task-queue-valid` with default `min-ready`,
 *     `no-scratch-artifacts`, `commit-message-exists`, `commit-stageable`)
 *     — none of which the other four replays exercise.
 *   - `pr-reviewer-agent-call-replay` covers the new `external-call-log`
 *     predicate + fake-binary shim mechanism wired through the runner
 *     and subprocess executor, the `assess-pr` webhook-payload
 *     assessment path (action / kota-task branch / fork gating), the
 *     `outputFormat: "json"` + `outputSchema` extraction the `review`
 *     step now declares, and the typed `workflow.pr.review.posted`
 *     emission shape — none of which the other shipped replays
 *     exercise.
 * The builder fixture stays in cadence-only coverage because its surfaces
 * (workflow-step prompt routing, repair-loop survival, commit step's
 * `git add -A`, restart request) are already exercised by the gated
 * fixtures.
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
import { cleanupFixtureWorkingDir, runFixture } from "./runner.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
} from "./subprocess-executor.js";

const PROJECT_DIR = fileURLToPath(new URL("../../..", import.meta.url));

const SMOKE_FIXTURE_IDS = [
  "decomposer-agent-call-replay",
  "improver-agent-call-replay",
  "explorer-agent-call-replay",
  "inbox-sorter-agent-call-replay",
  "research-retry-agent-call-replay",
  "pr-reviewer-agent-call-replay",
] as const;

describe("eval-harness shipped replay-fixture smoke gate", () => {
  for (const fixtureId of SMOKE_FIXTURE_IDS) {
    it(
      `replays ${fixtureId} end-to-end through the subprocess executor`,
      async () => {
        const fixturesRoot = join(
          PROJECT_DIR,
          "src/modules/eval-harness/fixtures",
        );
        const fixture = loadFixture(fixturesRoot, fixtureId);
        const runArtifactBaseDir = mkdtempSync(
          join(tmpdir(), `kota-replay-smoke-${fixtureId}-`),
        );
        const executor = createSubprocessExecutor({
          kotaBinaryPath: resolve(join(PROJECT_DIR, "bin/kota.mjs")),
          extraEnv: { NODE_OPTIONS: "" },
        });
        const executionProfile = executor.preflight(
          detectHostSubprocessResourceProfile("pnpm-test-smoke"),
        );
        const report = await runFixture({
          fixture,
          executor,
          executionProfile,
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
  }
});
