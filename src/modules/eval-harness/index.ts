/**
 * Eval-harness module — owns the autonomy eval contract AND the fixture
 * runner that applies it.
 *
 * Scope:
 *   - Typed fixture-run contract, `pass@k` / `pass^k` scoring, and the
 *     regression-gate decision (noise-band rule).
 *   - Fixture format, isolated-worktree runner, CLI entry, HTTP route, and
 *     the weekly cadence workflow.
 *
 * Aggregate scores flow back through the shared event bus
 * (`eval-harness.set.completed`). Per-run evidence lives as run artifacts.
 * There is no parallel metrics store.
 */

import { registerAgentHarness } from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { line, span } from "#modules/rendering/primitives.js";
import { printToStderr } from "#modules/rendering/transport.js";
import evalHarnessCadence from "./cadence-workflow.js";
import { buildEvalCommand } from "./cli.js";
import type {
  EvalCalibrationOptions,
  EvalCalibrationResult,
  EvalHarnessClient,
  EvalListResult,
  EvalRunOptions,
  EvalRunResult,
} from "./client.js";
import { evalHarnessControlRoutes } from "./eval-control-routes.js";
import {
  listEvalFixtures,
  runEvalCalibration,
  runEvalHarness,
} from "./eval-operations.js";
import { evalHarnessSetCompleted } from "./events.js";
import evalHarnessRegressionNotify from "./regression-notify-workflow.js";
import {
  createReplayAgentHarness,
  resolveReplayRootFromEnv,
} from "./replay-harness.js";
import { evalHarnessRoutes } from "./routes.js";

// Register the replay adapter at import time when the env-gated seam is
// armed. This has to happen outside `onLoad` because the CLI surface loads
// modules in `"commands"` lifecycle mode (onLoad skipped), and the
// subprocess executor invokes `kota workflow exec` through that same CLI
// surface.
// Module discovery imports project modules in alphabetical directory order
// — `claude-agent-harness` < `eval-harness` — so this registration runs
// after the claude adapter's import-time `registerAgentHarness` and the
// `Map.set` override lands cleanly. Production paths leave the env unset
// and skip registration.
(() => {
  const replayRoot = resolveReplayRootFromEnv();
  if (replayRoot === null) return;
  registerAgentHarness(createReplayAgentHarness(replayRoot));
  // Parent eval-harness CLI forwards child stderr to the operator, so this
  // diagnostic surfaces in `pnpm kota eval run` output when replay is on.
  printToStderr(line(span(
    `[eval-harness] replay adapter active; claude-agent-sdk overridden from ${replayRoot}`,
    "warn",
  )));
})();

export * from "./public-surface.js";

const evalHarnessModule: KotaModule = {
  name: "eval-harness",
  version: "0.2.0",
  description:
    "Autonomy eval harness: fixture-run contract, scoring, regression gate, fixture runner, CLI + HTTP route, and weekly cadence workflow.",
  // Depend on claude-agent-harness so its top-level registerAgentHarness
  // runs first; the replay adapter below then overwrites the
  // "claude-agent-sdk" slot when KOTA_EVAL_HARNESS_REPLAY_ROOT is set. The
  // subprocess executor is the only production caller that sets that env,
  // so operator and daemon runs are unaffected.
  dependencies: ["autonomy", "rendering", "claude-agent-harness", "repo-tasks"],
  events: [evalHarnessSetCompleted],
  commands: (ctx) => [buildEvalCommand(ctx)],
  routes: (ctx) => evalHarnessRoutes(ctx),
  controlRoutes: (ctx) => evalHarnessControlRoutes(ctx),
  workflows: [evalHarnessCadence, evalHarnessRegressionNotify],
  localClient: (ctx) => {
    const evalHarness: EvalHarnessClient = {
      async list() {
        return listEvalFixtures(ctx.cwd);
      },
      async run(options) {
        return runEvalHarness(ctx.cwd, options ?? {}, new EventBus());
      },
      async calibration(options) {
        return runEvalCalibration(ctx.cwd, options ?? {});
      },
    };
    return { evalHarness };
  },

  daemonClient: (link) => ({ evalHarness: buildEvalHarnessDaemonHandler(link) }),
};

/**
 * Daemon-side `EvalHarnessClient` backed by the typed `DaemonTransport`.
 * Calls the same `/eval/list`, `/api/eval/run`, and `/eval/calibration`
 * HTTP routes the eval-harness module registers through
 * `evalHarnessControlRoutes` and `evalHarnessRoutes`. The transport surface
 * owns the bearer token, base URL, and timeout policy — this factory only
 * encodes the wire shape.
 *
 * The two-stem route layout (`/eval/list` and `/eval/calibration` for
 * control-plane reads, `/api/eval/run` for the long-running run on the API
 * server) matches today's daemon contract.
 *
 * `list()` issues `GET /eval/list` through `requestStrict<T>`.
 *
 * `run(options)` issues `POST /api/eval/run` through `requestStrict<T>`
 * with a finite one-day timeout — eval runs frequently exceed the typed
 * link's 2s default timeout because they invoke the subprocess executor
 * and stream fixture runs end-to-end, while `Number.MAX_SAFE_INTEGER`
 * overflows Node timers and aborts immediately. The daemon route was
 * reshaped from the prior `400 + { error }` typed-failure shape to a
 * uniform `200 + EvalRunResult` discriminated body, matching the skills
 * migration precedent (`f62bbb65`'s "first multi-status-code → 200
 * alignment for a typed mutation result"). The factory then passes the
 * decoded body through unchanged.
 *
 * `calibration(options)` builds the optional `windowDays` / `followUpDays`
 * / `thresholdRate` / `minSample` / `runsDir` `URLSearchParams` shape
 * (omitting the query string entirely when no key produces a value) and
 * issues `GET /eval/calibration${query}` through `requestStrict<T>`.
 */
const EVAL_RUN_DAEMON_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function buildEvalHarnessDaemonHandler(link: DaemonTransport): EvalHarnessClient {
  return {
    list: async (): Promise<EvalListResult> => {
      return link.requestStrict<EvalListResult>("GET", "/eval/list");
    },
    run: async (options?: EvalRunOptions): Promise<EvalRunResult> => {
      return link.requestStrict<EvalRunResult>(
        "POST",
        "/api/eval/run",
        options ?? {},
        { timeoutMs: EVAL_RUN_DAEMON_TIMEOUT_MS },
      );
    },
    calibration: async (
      options?: EvalCalibrationOptions,
    ): Promise<EvalCalibrationResult> => {
      const params = new URLSearchParams();
      if (options?.windowDays !== undefined) params.set("windowDays", String(options.windowDays));
      if (options?.followUpDays !== undefined) params.set("followUpDays", String(options.followUpDays));
      if (options?.thresholdRate !== undefined) params.set("thresholdRate", String(options.thresholdRate));
      if (options?.minSample !== undefined) params.set("minSample", String(options.minSample));
      if (options?.runsDir) params.set("runsDir", options.runsDir);
      const query = params.toString() ? `?${params.toString()}` : "";
      return link.requestStrict<EvalCalibrationResult>(
        "GET",
        `/eval/calibration${query}`,
      );
    },
  };
}

export default evalHarnessModule;
