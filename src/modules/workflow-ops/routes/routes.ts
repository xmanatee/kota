import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import { assembleWorkflowGraph } from "../graph/index.js";
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

export function workflowRoutes(ctx?: ModuleContext): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/workflow/graph",
      handler: (_req, res) => {
        const definitions = ctx ? getValidatedWorkflowDefinitions(ctx, ctx.cwd) : [];
        const graph = assembleWorkflowGraph(definitions);
        jsonResponse(res, 200, graph);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/status",
      handler: (_req, res) =>
        handleWorkflowStatus(res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "GET",
      path: "/api/workflow/definitions",
      handler: (_req, res) =>
        handleWorkflowDefinitions(res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/definitions/:name/enable",
      handler: (_req, res, params) =>
        handleWorkflowEnable(res, params.name, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/definitions/:name/disable",
      handler: (_req, res, params) =>
        handleWorkflowDisable(res, params.name, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/pause",
      handler: (_req, res) =>
        handleWorkflowPause(res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/resume",
      handler: (_req, res) =>
        handleWorkflowResume(res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/abort",
      handler: (_req, res) =>
        handleWorkflowAbort(res, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/retry",
      handler: (req, res) =>
        handleWorkflowRetry(req, res, new WorkflowRunStore(), DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/replay",
      handler: (req, res) =>
        handleWorkflowReplay(req, res, new WorkflowRunStore()),
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
        handleWorkflowTrigger(req, res, new WorkflowRunStore(), DaemonControlClient.fromStateDir()),
    },
    {
      method: "GET",
      path: "/api/workflow/runs",
      handler: (req, res) => {
        const url = new URL(req.url!, `http://localhost`);
        handleWorkflowRuns(res, url);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id/stream",
      handler: (_req, res, params) => handleWorkflowRunStream(res, params.id),
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id/artifacts",
      handler: (_req, res, params) => handleWorkflowRunArtifacts(res, params.id),
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id/thinking",
      handler: (_req, res, params) => handleWorkflowRunThinking(res, params.id),
    },
    {
      method: "GET",
      path: "/api/workflow/runs/:id",
      handler: (_req, res, params) => handleWorkflowRunDetail(res, params.id),
    },
    {
      method: "DELETE",
      path: "/api/workflow/runs/:id",
      handler: (_req, res, params) =>
        handleWorkflowCancel(res, params.id, DaemonControlClient.fromStateDir()),
    },
    {
      method: "POST",
      path: "/api/workflow/runs/:id/abort",
      handler: (_req, res, params) =>
        handleWorkflowAbortRun(res, params.id, DaemonControlClient.fromStateDir()),
    },
  ];
}
