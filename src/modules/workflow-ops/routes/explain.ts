import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import {
  type AutomationExplainOptions,
  type AutomationExplainSampleEvent,
  explainAutomation,
} from "../graph/index.js";

type ExplainBody = Awaited<ReturnType<typeof readBody>>;

export type WorkflowExplainDeps = {
  definitions: readonly WorkflowDefinition[];
  moduleManifests: ReturnType<ModuleContext["getModuleSummaries"]>[number]["manifest"][];
};

function stringField(body: ExplainBody, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function payloadField(body: ExplainBody): WorkflowRunTrigger["payload"] | undefined {
  const payload = body.payload;
  if (payload === undefined || payload === null) return undefined;
  if (typeof payload !== "object" || Array.isArray(payload)) return undefined;
  return payload as WorkflowRunTrigger["payload"];
}

function explainOptionsFromBody(body: ExplainBody): AutomationExplainOptions {
  const workflowName = stringField(body, "workflow") ?? stringField(body, "workflowName");
  const eventName = stringField(body, "event") ?? stringField(body, "eventName");
  const payload = payloadField(body);
  const eventId = stringField(body, "eventId");
  const sampleEvent: AutomationExplainSampleEvent | undefined =
    eventName && payload
      ? {
          event: eventName,
          payload,
          ...(eventId ? { eventId } : {}),
        }
      : undefined;
  return {
    ...(workflowName ? { workflowName } : {}),
    ...(eventName ? { eventName } : {}),
    ...(sampleEvent ? { sampleEvent } : {}),
  };
}

export async function handleWorkflowExplain(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WorkflowExplainDeps,
): Promise<void> {
  let body: ExplainBody;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const options = explainOptionsFromBody(body);
  const result = explainAutomation(deps.definitions, {
    moduleManifests: deps.moduleManifests.flatMap((manifest) => manifest ? [manifest] : []),
    ...options,
  });
  const status = result.outcome === "dead-letter" ? 422 : 200;
  jsonResponse(res, status, result);
}

export function workflowExplainControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/workflow/explain",
      capabilityScope: "read",
      handler: (req, res) =>
        handleWorkflowExplain(req, res, {
          definitions: getValidatedWorkflowDefinitions(ctx, ctx.cwd),
          moduleManifests: ctx.getModuleSummaries().map((summary) => summary.manifest),
        }),
    },
  ];
}
