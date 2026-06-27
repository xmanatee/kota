/**
 * Daemon-control HTTP routes for the `harnessParity` namespace.
 *
 * Both list and run reuse the same shared helpers the local handler does
 * so daemon-up and daemon-down callers see the same scenario set and run
 * shape. Routes live on the daemon-control surface under bearer auth.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type {
  HarnessParityMatrixModelInput,
  HarnessParityMatrixOptions,
  HarnessParityMatrixProvider,
  HarnessParityRunOptions,
} from "./client.js";
import {
  type HarnessParityDeps,
  listHarnessParityScenarios,
  runHarnessParity,
  runHarnessParityMatrix,
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

type RouteRawValue = Parameters<typeof asStringArray>[0];
type RouteBody = { [key: string]: RouteRawValue };

function asMatrixProvider(
  value: string | undefined,
): HarnessParityMatrixProvider | undefined {
  if (value === undefined) return undefined;
  if (
    value === "active-preset" ||
    value === "anthropic" ||
    value === "local" ||
    value === "openai" ||
    value === "openrouter" ||
    value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function asMatrixModels(
  value: RouteRawValue,
): HarnessParityMatrixModelInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: HarnessParityMatrixModelInput[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push({ model: entry });
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const raw = entry as {
      model?: string;
      label?: string;
      provider?: string;
    };
    if (typeof raw.model !== "string" || raw.model.length === 0) continue;
    const provider = asMatrixProvider(raw.provider);
    out.push({
      model: raw.model,
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
      ...(provider !== undefined ? { provider } : {}),
    });
  }
  return out;
}

function asEffort(value: RouteRawValue): HarnessParityMatrixOptions["effort"] {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  ) {
    return value;
  }
  return undefined;
}

async function handleRun(
  deps: HarnessParityDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: RouteBody;
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

async function handleMatrix(
  deps: HarnessParityDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: RouteBody;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const options: HarnessParityMatrixOptions = {};
  const scenarios = asStringArray(body.scenarios);
  if (scenarios !== undefined) options.scenarios = scenarios;
  const harnesses = asStringArray(body.harnesses);
  if (harnesses !== undefined) options.harnesses = harnesses;
  const candidateSets = asStringArray(body.candidateSets);
  if (candidateSets !== undefined) options.candidateSets = candidateSets;
  const evalFixtures = asStringArray(body.evalFixtures);
  if (evalFixtures !== undefined) options.evalFixtures = evalFixtures;
  const baselines = asMatrixModels(body.baselines);
  if (baselines !== undefined) options.baselines = baselines;
  const candidates = asMatrixModels(body.candidates);
  if (candidates !== undefined) options.candidates = candidates;
  if (typeof body.repeats === "number") options.repeats = body.repeats;
  if (typeof body.maxTurns === "number") options.maxTurns = body.maxTurns;
  const effort = asEffort(body.effort);
  if (effort !== undefined) options.effort = effort;
  if (typeof body.outDir === "string") options.outDir = body.outDir;
  if (typeof body.hostClass === "string") options.hostClass = body.hostClass;
  if (typeof body.cpuAllocationCores === "number") {
    options.cpuAllocationCores = body.cpuAllocationCores;
  }
  if (typeof body.cpuKillThresholdCores === "number") {
    options.cpuKillThresholdCores = body.cpuKillThresholdCores;
  }
  if (typeof body.memoryAllocationMB === "number") {
    options.memoryAllocationMB = body.memoryAllocationMB;
  }
  if (typeof body.memoryKillThresholdMB === "number") {
    options.memoryKillThresholdMB = body.memoryKillThresholdMB;
  }
  if (typeof body.keepWorkingDir === "boolean") {
    options.keepWorkingDir = body.keepWorkingDir;
  }

  const result = await runHarnessParityMatrix(deps, options);
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
    {
      method: "POST",
      path: "/harness-parity/matrix",
      capabilityScope: "control",
      handler: (req, res) => handleMatrix(deps, req, res),
    },
  ];
}
