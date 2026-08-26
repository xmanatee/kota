import type { IncomingMessage, ServerResponse } from "node:http";
import type { Command } from "commander";
import type { ControlRouteRegistration, ModuleContext } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import type {
  WorkflowTrialOptions,
  WorkflowTrialResult,
  WorkflowTrialSummary,
} from "../client.js";
import { isJsonObject, parseJsonObject } from "./trial-options.js";
import { runLocalWorkflowTrial } from "./trial-runtime.js";

type TrialRequestBody = Awaited<ReturnType<typeof readBody>>;

function parseTrialOptionsFromBody(body: TrialRequestBody): {
  name?: string;
  options: WorkflowTrialOptions;
} {
  const name = typeof body.name === "string" ? body.name : undefined;
  const payload = isJsonObject(body.payload) ? body.payload : undefined;
  const repeat = body.repeat !== undefined && typeof body.repeat === "number"
    ? body.repeat
    : undefined;
  const compareWorkflows = Array.isArray(body.compareWorkflows)
    && body.compareWorkflows.every((entry) => typeof entry === "string")
    ? body.compareWorkflows
    : undefined;
  const comparePayloads = Array.isArray(body.comparePayloads)
    && body.comparePayloads.every(isJsonObject)
    ? body.comparePayloads
    : undefined;
  const scopeId = typeof body.scopeId === "string" ? body.scopeId : undefined;
  return {
    name,
    options: {
      ...(payload !== undefined && { payload }),
      ...(repeat !== undefined && { repeat }),
      ...(compareWorkflows !== undefined && { compareWorkflows }),
      ...(comparePayloads !== undefined && { comparePayloads }),
      ...(scopeId !== undefined && { scopeId }),
    },
  };
}

export async function handleWorkflowTrialControl(
  ctx: ModuleContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: TrialRequestBody;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }
  const { name, options } = parseTrialOptionsFromBody(body);
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
    return;
  }
  const result = await runLocalWorkflowTrial(ctx, name, options);
  if (!result.ok) {
    if (result.reason === "unknown_scope") {
      jsonResponse(res, 404, {
        error: "Unknown scope",
        reason: "unknown_scope",
        scopeId: options.scopeId,
      });
      return;
    }
    jsonResponse(res, result.reason === "unknown_workflow" ? 404 : 400, {
      error: result.message,
      reason: result.reason,
    });
    return;
  }
  jsonResponse(res, 200, result);
}

export function workflowTrialControlRoutes(
  ctx: ModuleContext,
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/workflow/trial",
      capabilityScope: "control",
      handler: (req, res) => handleWorkflowTrialControl(ctx, req, res),
    },
  ];
}

function collectValue<T>(value: T, previous: T[]): T[] {
  return [...previous, value];
}

function parseTrialCliOptions(opts: {
  payload?: string;
  repeat?: string;
  compareWorkflow: string[];
  comparePayload: string[];
}): WorkflowTrialOptions {
  const payload = opts.payload ? parseJsonObject(opts.payload, "--payload") : undefined;
  const repeat = opts.repeat === undefined ? undefined : Number.parseInt(opts.repeat, 10);
  if (opts.repeat !== undefined && Number.isNaN(repeat)) {
    throw new Error("--repeat must be an integer");
  }
  const comparePayloads = opts.comparePayload.map((raw) =>
    parseJsonObject(raw, "--compare-payload"));
  return {
    ...(payload !== undefined && { payload }),
    ...(repeat !== undefined && { repeat }),
    ...(opts.compareWorkflow.length > 0 && { compareWorkflows: opts.compareWorkflow }),
    ...(comparePayloads.length > 0 && { comparePayloads }),
  };
}

export function formatWorkflowTrialSummary(summary: WorkflowTrialSummary): string {
  const lines = [
    `Workflow trial ${summary.runId}: ${summary.status}`,
    `Report: ${summary.reportDir}/summary.json`,
    `Attempts: ${summary.passed} passed, ${summary.failed} failed, ${summary.blocked} blocked`,
  ];
  for (const attempt of summary.attempts) {
    const run = attempt.workflowRunId ? ` run=${attempt.workflowRunId}` : "";
    const changed = ` changed=${attempt.changedFiles.length}`;
    const events = ` events=${attempt.busEvents.length}`;
    lines.push(`- ${attempt.id} ${attempt.workflow}: ${attempt.status}${run}${changed}${events}`);
  }
  return lines.join("\n");
}

export function registerTrialCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("trial <name>")
    .description("Execute a real workflow run against an isolated temporary project and write a trial report")
    .option("--payload <json>", "JSON object merged into the trial trigger payload")
    .option("--repeat <n>", "Run each trial variant N times", "1")
    .option(
      "--compare-workflow <name>",
      "Additional workflow to run with the same payload",
      collectValue,
      [] as string[],
    )
    .option(
      "--compare-payload <json>",
      "Additional JSON payload variant to run against the primary workflow",
      collectValue,
      [] as string[],
    )
    .action(async (
      name: string,
      opts: {
        payload?: string;
        repeat?: string;
        compareWorkflow: string[];
        comparePayload: string[];
      },
    ) => {
      let options: WorkflowTrialOptions;
      try {
        options = parseTrialCliOptions(opts);
      } catch (err) {
        printWorkflowError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      let result: WorkflowTrialResult;
      try {
        result = await ctx.client.workflow.trial(name, options);
      } catch {
        result = await runLocalWorkflowTrial(ctx, name, options);
      }
      if (!result.ok && result.reason === "daemon_required") {
        result = await runLocalWorkflowTrial(ctx, name, options);
      }
      if (!result.ok) {
        printWorkflowError(result.message);
        process.exit(1);
      }
      printWorkflowText(formatWorkflowTrialSummary(result.summary));
      if (result.summary.status !== "passed") process.exitCode = 1;
    });
}
