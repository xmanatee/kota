import type { RouteRegistration } from "../../core/modules/module-types.js";
import { DaemonControlClient } from "../../server/daemon-client.js";
import { WorkflowRunStore } from "../../core/workflow/run-store.js";
import {
  handleWorkflowAbort,
  handleWorkflowAbortRun,
  handleWorkflowCancel,
  handleWorkflowDefinitions,
  handleWorkflowDisable,
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

const DEFINITION_ENABLE_PATTERN = /^\/api\/workflow\/definitions\/([^/]+)\/enable$/;
const DEFINITION_DISABLE_PATTERN = /^\/api\/workflow\/definitions\/([^/]+)\/disable$/;
const RUN_STREAM_PATTERN = /^\/api\/workflow\/runs\/([^/]+)\/stream$/;
const RUN_ARTIFACTS_PATTERN = /^\/api\/workflow\/runs\/([^/]+)\/artifacts$/;
const RUN_THINKING_PATTERN = /^\/api\/workflow\/runs\/([^/]+)\/thinking$/;
const RUN_ABORT_PATTERN = /^\/api\/workflow\/runs\/([^/]+)\/abort$/;
const RUN_MATCH_PATTERN = /^\/api\/workflow\/runs\/([^/]+)$/;

export function workflowRoutes(): RouteRegistration[] {
  return [
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
      path: "/api/workflow/definitions/",
      pathPattern: DEFINITION_ENABLE_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(DEFINITION_ENABLE_PATTERN);
        return handleWorkflowEnable(res, decodeURIComponent(match![1]), DaemonControlClient.fromStateDir());
      },
    },
    {
      method: "POST",
      path: "/api/workflow/definitions/",
      pathPattern: DEFINITION_DISABLE_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(DEFINITION_DISABLE_PATTERN);
        return handleWorkflowDisable(res, decodeURIComponent(match![1]), DaemonControlClient.fromStateDir());
      },
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
      path: "/api/workflow/runs/",
      pathPattern: RUN_STREAM_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(RUN_STREAM_PATTERN);
        handleWorkflowRunStream(res, match![1]);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/",
      pathPattern: RUN_ARTIFACTS_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(RUN_ARTIFACTS_PATTERN);
        handleWorkflowRunArtifacts(res, match![1]);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/",
      pathPattern: RUN_THINKING_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(RUN_THINKING_PATTERN);
        handleWorkflowRunThinking(res, match![1]);
      },
    },
    {
      method: "GET",
      path: "/api/workflow/runs/",
      pathPattern: RUN_MATCH_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(RUN_MATCH_PATTERN);
        handleWorkflowRunDetail(res, match![1]);
      },
    },
    {
      method: "DELETE",
      path: "/api/workflow/runs/",
      pathPattern: RUN_MATCH_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(RUN_MATCH_PATTERN);
        return handleWorkflowCancel(res, match![1], DaemonControlClient.fromStateDir());
      },
    },
    {
      method: "POST",
      path: "/api/workflow/runs/",
      pathPattern: RUN_ABORT_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(RUN_ABORT_PATTERN);
        return handleWorkflowAbortRun(res, match![1], DaemonControlClient.fromStateDir());
      },
    },
  ];
}
