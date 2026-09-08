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

import { EventBus } from "#core/events/event-bus.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { runAgyModelEvaluationSuite } from "./agy-model-evaluation.js";
import evalHarnessCadence from "./cadence-workflow.js";
import { buildEvalCommand } from "./cli-command.js";
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
import { evalHarnessRoutes } from "./routes.js";

export * from "./public-surface.js";

const evalHarnessModule: KotaModule = {
  name: "eval-harness",
  version: "0.2.0",
  description:
    "Autonomy eval harness: fixture-run contract, scoring, regression gate, fixture runner, CLI + HTTP route, and weekly cadence workflow.",
  dependencies: [
    "antigravity-cli-agent-harness",
    "autonomy",
    "rendering",
    "repo-tasks",
  ],
  events: [evalHarnessSetCompleted],
  commands: (ctx) => [buildEvalCommand(ctx)],
  routes: (ctx) => evalHarnessRoutes(ctx),
  controlRoutes: (ctx) => evalHarnessControlRoutes(ctx),
  workflows: [evalHarnessCadence, evalHarnessRegressionNotify],
  localClient: (ctx) => {
    const evalHarness: EvalHarnessClient = {
      async list() {
        return listEvalFixtures();
      },
      async run(options) {
        return runEvalHarness(ctx.cwd, options ?? {}, new EventBus());
      },
      async runAgyModels(options) {
        return runAgyModelEvaluationSuite(ctx.cwd, options);
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
    runAgyModels: async (options) => {
      return link.requestStrict(
        "POST",
        "/api/eval/agy-models",
        options,
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
