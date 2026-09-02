import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import {
  handleAbortWorkflow,
  handleAbortWorkflowRun,
  handleCancelWorkflowRun,
  handleDisableWorkflow,
  handleEnableWorkflow,
  handleGetWorkflowDefinitions,
  handleGetWorkflowRun,
  handleGetWorkflowStatus,
  handleListWorkflowRuns,
  handlePauseAgentForQuality,
  handlePauseWorkflow,
  handleReloadConfig,
  handleReloadWorkflow,
  handleResumeWorkflow,
  handleTriggerWorkflow,
} from "./daemon-control-workflow.js";

const requestUrl = (raw: string | undefined) => new URL(raw ?? "/", "http://127.0.0.1");

export function buildDaemonWorkflowControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  const h = deps.handle;
  return [
    {
      method: "GET",
      path: "/workflow/status",
      capabilityScope: "read",
      handler: (req, res) => handleGetWorkflowStatus(h, res, requestUrl(req.url)),
    },
    {
      method: "GET",
      path: "/workflow/definitions",
      capabilityScope: "read",
      handler: (req, res) => handleGetWorkflowDefinitions(h, res, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/definitions/:name/disable",
      capabilityScope: "control",
      handler: (req, res, params) => handleDisableWorkflow(h, res, params, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/definitions/:name/enable",
      capabilityScope: "control",
      handler: (req, res, params) => handleEnableWorkflow(h, res, params, requestUrl(req.url)),
    },
    {
      method: "GET",
      path: "/workflow/runs",
      capabilityScope: "read",
      handler: (req, res) => handleListWorkflowRuns(h, res, requestUrl(req.url)),
    },
    {
      method: "GET",
      path: "/workflow/runs/:id",
      capabilityScope: "read",
      handler: (req, res, params) => handleGetWorkflowRun(h, res, params, requestUrl(req.url)),
    },
    {
      method: "DELETE",
      path: "/workflow/runs/:id",
      capabilityScope: "control",
      handler: (req, res, params) => handleCancelWorkflowRun(h, res, params, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/runs/:id/abort",
      capabilityScope: "control",
      handler: (req, res, params) => handleAbortWorkflowRun(h, res, params, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/pause",
      capabilityScope: "control",
      handler: (req, res) => handlePauseWorkflow(h, res, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/agent/quality-pause",
      capabilityScope: "control",
      handler: (req, res) =>
        handlePauseAgentForQuality(h, req, res, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/resume",
      capabilityScope: "control",
      handler: (req, res) => handleResumeWorkflow(h, res, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/abort",
      capabilityScope: "control",
      handler: (req, res) => handleAbortWorkflow(h, res, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/workflow/reload",
      capabilityScope: "control",
      handler: (req, res) => handleReloadWorkflow(h, res, requestUrl(req.url)),
    },
    {
      method: "POST",
      path: "/reload",
      capabilityScope: "control",
      handler: (_req, res) => handleReloadConfig(h, res),
    },
    {
      method: "POST",
      path: "/workflow/trigger",
      capabilityScope: "control",
      handler: (req, res) => handleTriggerWorkflow(h, req, res, requestUrl(req.url)),
    },
  ];
}
