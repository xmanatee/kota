/**
 * Daemon-control HTTP routes for the `harnessParity` namespace.
 *
 * Both list and run reuse the same shared helpers the local handler does
 * so daemon-up and daemon-down callers see the same scenario set and run
 * shape. Routes live on the daemon-control surface under bearer auth.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { HarnessParityRunOptions } from "#core/server/kota-client.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  type HarnessParityDeps,
  listHarnessParityScenarios,
  runHarnessParity,
} from "./harness-parity-operations.js";

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    out.push(entry);
  }
  return out;
}

async function handleRun(
  deps: HarnessParityDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const options: HarnessParityRunOptions = {};
  const scenarios = asStringArray(body.scenarios);
  if (scenarios !== undefined) options.scenarios = scenarios;
  const harnesses = asStringArray(body.harnesses);
  if (harnesses !== undefined) options.harnesses = harnesses;
  if (typeof body.model === "string") options.model = body.model;
  if (typeof body.maxTurns === "number") options.maxTurns = body.maxTurns;
  if (typeof body.outDir === "string") options.outDir = body.outDir;
  if (typeof body.keepWorkingDir === "boolean") options.keepWorkingDir = body.keepWorkingDir;

  const result = await runHarnessParity(deps, options);
  if (!result.ok) {
    jsonResponse(res, 400, result);
    return;
  }
  jsonResponse(res, 200, result);
}

export function harnessParityControlRoutes(
  deps: HarnessParityDeps,
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/harness-parity/scenarios",
      capabilityScope: "read",
      handler: (_req, res) =>
        jsonResponse(res, 200, listHarnessParityScenarios(deps)),
    },
    {
      method: "POST",
      path: "/harness-parity/run",
      capabilityScope: "control",
      handler: (req, res) => handleRun(deps, req, res),
    },
  ];
}
