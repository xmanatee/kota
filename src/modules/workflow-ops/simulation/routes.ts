import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import { simulateAutomation } from "./engine.js";
import type { WorkflowSimulationRequest } from "./types.js";

type SimulationBody = Awaited<ReturnType<typeof readBody>>;

export type WorkflowSimulationDeps = {
  projectDir: string;
  definitions: readonly WorkflowDefinition[];
  moduleManifests: ReturnType<ModuleContext["getModuleSummaries"]>[number]["manifest"][];
  availableToolNames?: ReadonlySet<string>;
};

function simulationRequestFromBody(body: SimulationBody): WorkflowSimulationRequest {
  return body as WorkflowSimulationRequest;
}

export async function handleWorkflowSimulation(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WorkflowSimulationDeps,
): Promise<void> {
  let body: SimulationBody;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    const result = await simulateAutomation({
      projectDir: deps.projectDir,
      definitions: deps.definitions,
      moduleManifests: deps.moduleManifests.flatMap((manifest) => manifest ? [manifest] : []),
      ...(deps.availableToolNames ? { availableToolNames: deps.availableToolNames } : {}),
      request: simulationRequestFromBody(body),
    });
    const hasDlq = result.inputs.some((input) => input.outcome === "would-dlq");
    jsonResponse(res, hasDlq ? 422 : 200, result);
  } catch (err) {
    jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function workflowSimulationControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/workflow/simulate",
      capabilityScope: "read",
      handler: (req, res) =>
        handleWorkflowSimulation(req, res, {
          projectDir: ctx.cwd,
          definitions: getValidatedWorkflowDefinitions(ctx, ctx.cwd),
          moduleManifests: ctx.getModuleSummaries().map((summary) => summary.manifest),
          availableToolNames: new Set(ctx.listTools()),
        }),
    },
  ];
}
