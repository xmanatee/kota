/**
 * Daemon-control HTTP routes for the `evalHarness` namespace.
 *
 * `GET /eval/list` enumerates fixtures; `GET /eval/calibration` returns
 * the rolling-window evaluator-calibration aggregate. The pre-existing
 * `/api/eval/run` route on the user-facing server stays the run path —
 * the namespace's `run` HTTP impl reuses it through the daemon-control
 * client transport.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { EvalCalibrationOptions } from "./client.js";
import { listEvalFixtures, runEvalCalibration } from "./eval-operations.js";

function parseCalibrationOptions(url: URL): EvalCalibrationOptions {
  const opts: EvalCalibrationOptions = {};
  const win = url.searchParams.get("windowDays");
  if (win) {
    const v = Number.parseFloat(win);
    if (Number.isFinite(v) && v > 0) opts.windowDays = v;
  }
  const fol = url.searchParams.get("followUpDays");
  if (fol) {
    const v = Number.parseFloat(fol);
    if (Number.isFinite(v) && v > 0) opts.followUpDays = v;
  }
  const thr = url.searchParams.get("thresholdRate");
  if (thr) {
    const v = Number.parseFloat(thr);
    if (Number.isFinite(v) && v >= 0 && v <= 1) opts.thresholdRate = v;
  }
  const ms = url.searchParams.get("minSample");
  if (ms) {
    const v = Number.parseInt(ms, 10);
    if (Number.isFinite(v) && v > 0) opts.minSample = v;
  }
  const rd = url.searchParams.get("runsDir");
  if (rd) opts.runsDir = rd;
  return opts;
}

export function evalHarnessControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/eval/list",
      capabilityScope: "read",
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        try {
          jsonResponse(res, 200, listEvalFixtures(ctx.cwd));
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      },
    },
    {
      method: "GET",
      path: "/eval/calibration",
      capabilityScope: "read",
      handler: (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          jsonResponse(res, 200, runEvalCalibration(ctx.cwd, parseCalibrationOptions(url)));
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message });
        }
      },
    },
  ];
}
