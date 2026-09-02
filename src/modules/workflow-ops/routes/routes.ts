import { getWorkflowMetricsSource } from "#core/daemon/metrics-source-provider.js";
import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import { assembleCompiledAutomationGraph } from "../graph/index.js";
import { requireWorkflowRunDurableAuthority } from "../runs/workflow-history.js";
import { handleWorkflowSimulation } from "../simulation/routes.js";
import { handleWorkflowExplain } from "./explain.js";
import {
  handleWorkflowAbort,
  handleWorkflowAbortRun,
  handleWorkflowCancel,
  handleWorkflowDefinitions,
  handleWorkflowDisable,
  handleWorkflowDryRun,
  handleWorkflowEnable,
  handleWorkflowPause,
  handleWorkflowReplay,
  handleWorkflowResume,
  handleWorkflowRetry,
  handleWorkflowStatus,
  handleWorkflowTrigger,
} from "./workflow-routes.js";
import {
  handleWorkflowRunArtifacts,
  handleWorkflowRunDetail,
  handleWorkflowRunStream,
  handleWorkflowRuns,
  handleWorkflowRunThinking,
} from "./workflow-run-routes.js";

function canonicalRouteRunStore(
  ctx: ModuleContext | undefined,
  res: Parameters<typeof jsonResponse>[0],
): WorkflowRunStore | null {
  const source = getWorkflowMetricsSource();
  if (source === null) {
    jsonResponse(res, 503, { error: "Workflow authority unavailable" });
    return null;
  }
  const readAuthority = () => {
    const status = source.getWorkflowLiveStatus();
    return requireWorkflowRunDurableAuthority(
      status.authorityCriticalRunIds,
      status.operationallyActiveRunIds,
      status.terminalRunIds,
    );
  };
  try {
    readAuthority();
  } catch {
    jsonResponse(res, 503, { error: "Workflow authority unavailable" });
    return null;
  }
  return new WorkflowRunStore(ctx?.cwd ?? process.cwd(), {
    authorityCriticalRunIds: () => readAuthority().authorityCriticalRunIds,
    operationallyActiveRunIds: () => readAuthority().operationallyActiveRunIds,
    terminalRunIds: () => readAuthority().terminalRunIds,
  });
}

export function workflowRoutes(ctx?: ModuleContext): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/workflow/graph",
      handler: (_req, res) => {
        const definitions = ctx ? getValidatedWorkflowDefinitions(ctx, ctx.cwd) : [];
        const moduleManifests = ctx
          ? ctx.getModuleSummaries().flatMap((summary) =>
              summary.manifest ? [summary.manifest] : []
            )
          : [];
        const graph = assembleCompiledAutomationGraph(definitions, { moduleManifests });
        jsonResponse(res, 200, graph);
      },
    },
    {
      method: "POST",
      path: "/api/workflow/explain",
      handler: (req, res) => {
        const definitions = ctx ? getValidatedWorkflowDefinitions(ctx, ctx.cwd) : [];
        const moduleManifests = ctx
          ? ctx.getModuleSummaries().map((summary) => summary.manifest)
          : [];
        return handleWorkflowExplain(req, res, { definitions, moduleManifests });
      },
    },
    {
      method: "POST",
      path: "/api/workflow/simulate",
      handler: (req, res) => {
        const definitions = ctx ? getValidatedWorkflowDefinitions(ctx, ctx.cwd) : [];
        const moduleManifests = ctx
          ? ctx.getModuleSummaries().map((summary) => summary.manifest)
          : [];
        const toolNames = ctx && typeof ctx.listTools === "function"
          ? new Set(ctx.listTools())
          : undefined;
        return handleWorkflowSimulation(req, res, {
          scopeRoot: ctx?.cwd ?? process.cwd(),
          definitions,
          moduleManifests,
          ...(toolNames ? { availableToolNames: toolNames } : {}),
        });
      },
    },
    {
      method: "GET",
      path: "/api/workflow/status",
      handler: (_req, res) =>
        handleWorkflowStatus(res, getDaemonTransport()),
    },
    {
      method: "GET",
      path: "/api/workflow/definitions",
      handler: (_req, res) =>
        handleWorkflowDefinitions(res, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/definitions/:name/enable",
      handler: (_req, res, params) =>
        handleWorkflowEnable(res, params.name, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/definitions/:name/disable",
      handler: (_req, res, params) =>
        handleWorkflowDisable(res, params.name, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/pause",
      handler: (_req, res) =>
        handleWorkflowPause(res, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/resume",
      handler: (_req, res) =>
        handleWorkflowResume(res, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/abort",
      handler: (_req, res) =>
        handleWorkflowAbort(res, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/retry",
      handler: (req, res) =>
        handleWorkflowRetry(req, res, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/replay",
      handler: (req, res) =>
        handleWorkflowReplay(req, res, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/dry-run",
      handler: (req, res) => {
        const definitions = ctx
          ? getValidatedWorkflowDefinitions(ctx, ctx.cwd)
          : [];
        const availableToolNames = new Set(ctx?.listTools() ?? []);
        return handleWorkflowDryRun(req, res, { definitions, availableToolNames });
      },
    },
    {
      method: "POST",
      path: "/api/workflow/trigger",
      handler: (req, res) =>
        handleWorkflowTrigger(req, res, getDaemonTransport()),
    },
    {
      method: "GET",
      path: "/api/workflow/runs",
      handler: (req, res) => {
        const store = canonicalRouteRunStore(ctx, res);
        if (store === null) return;
        const url = new URL(req.url!, `http://localhost`);
        handleWorkflowRuns(res, url, store);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id/stream",
      handler: (_req, res, params) => {
        const store = canonicalRouteRunStore(ctx, res);
        if (store !== null) handleWorkflowRunStream(res, params.id, store);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id/artifacts",
      handler: (_req, res, params) => {
        const store = canonicalRouteRunStore(ctx, res);
        if (store !== null) handleWorkflowRunArtifacts(res, params.id, store);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id/thinking",
      handler: (_req, res, params) => {
        const store = canonicalRouteRunStore(ctx, res);
        if (store !== null) handleWorkflowRunThinking(res, params.id, store);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id",
      handler: (_req, res, params) => {
        const store = canonicalRouteRunStore(ctx, res);
        if (store !== null) handleWorkflowRunDetail(res, params.id, store);
      },
    },
    {
      method: "DELETE",
      path: "/api/workflow/runs/:id",
      handler: (_req, res, params) =>
        handleWorkflowCancel(res, params.id, getDaemonTransport()),
    },
    {
      method: "POST",
      path: "/api/workflow/runs/:id/abort",
      handler: (_req, res, params) =>
        handleWorkflowAbortRun(res, params.id, getDaemonTransport()),
    },
  ];
}
