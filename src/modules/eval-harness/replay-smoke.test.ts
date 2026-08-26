/**
 * Replay-fixture smoke gate that runs inside the standard `pnpm test` pass.
 *
 * The cadence workflow runs every shipped fixture weekly; the CLI runs them on
 * demand. Until this test landed, neither path was reachable from the autonomy
 * builder's own `pnpm test` repair-loop check, so a workflow-layer regression
 * (replay adapter, subprocess executor, gather-run-data, repair loop, writer
 * integration) could ship and only surface in a real autonomy run that paid a live
 * LLM bill. This test closes that gap by replaying representative shipped
 * fixtures end-to-end through the same `runFixture` + subprocess executor path
 * the cadence uses, asserting predicate pass.
 *
 * Five fixtures cover the full set of workflow-runtime branches we want to
 * gate at `pnpm test` time:
 *   - `decomposer-agent-call-replay` is the smallest fixture and is the only
 *     one whose repair loop runs `pnpm run validate-tasks` against the
 *     fixture's tmp project root, so it gates the task-validator-as-repair-
 *     check path against silent regression. Its `review-decomposition`
 *     recording also covers judge-prompt routing.
 *   - `explorer-agent-call-replay` covers the explorer's post-agent plumbing
 *     (the staged explorer publication request, the
 *     `apply-watchlist-updates` reader's empty-apply path, and the task-queue
 *     and watchlist commit-message repair checks) that none of the other
 *     shipped replays exercise.
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
 *     (`task-queue-valid` with default `min-ready`)
 *     — none of which the other four replays exercise.
 *   - `pr-reviewer-agent-call-replay` covers the `assess-pr`
 *     webhook-payload assessment path (action / kota-task branch / fork
 *     gating), passive agent access to registered read-only GitHub tools,
 *     the `outputFormat: "json"` + `outputSchema` extraction on `review`,
 *     the deterministic `github_comment` output step via the eval module's
 *     local replay tools, and the typed `workflow.pr.review.posted` emission shape —
 *     none of which the other shipped replays exercise.
 * The builder fixture stays cadence-only. The retired source-editing improver
 * replay is intentionally absent: the issue-driven improver no longer has
 * that workflow shape.
 *
 * The subprocess executor invokes `node bin/kota.mjs workflow exec ...`,
 * which loads `dist/cli.js`. The autonomy builder's repair loop runs
 * `pnpm build` before `pnpm test`, so dist matches source under autonomy.
 * Local devs who run `pnpm test` against a stale dist will see this test
 * surface that gap loudly rather than silently — which is the point.
 *
 * The subprocess executor strips source-mode `NODE_OPTIONS` before launching
 * `dist/cli.js`, so this test exercises the same production resolution path
 * the cadence and CLI subprocess paths use.
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
