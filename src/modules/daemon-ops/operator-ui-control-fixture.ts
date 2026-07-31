import {
  action,
  resultSpec,
} from "#core/daemon/ui-surface-builders.js";
import {
  launchDefaultParameters,
  launchWorkflowParameters,
  sessionLaunchParameters,
} from "./operator-ui-launch-controls.js";
import type {
  UiAction,
  UiLogEntry,
  UiMetric,
  UiTableRow,
} from "./operator-ui-types.js";

export function demoActions(scopeId: string): UiAction[] {
  return [
    action({
      surfaceId: "operator-control",
      actionId: "ui.refresh",
      scopeId,
      label: "Refresh shared UI",
      operation: { kind: "daemon-route", method: "GET", path: "/ui/surfaces" },
      result: resultSpec("Shared UI surfaces refreshed."),
    }),
    action({
      surfaceId: "operator-control",
      actionId: "workflow.launch",
      scopeId,
      label: "Launch workflow run",
      effect: "write",
      operation: { kind: "daemon-route", method: "POST", path: "/workflow/trigger" },
      parameters: launchWorkflowParameters(),
      confirmation: {
        mode: "required",
        title: "Launch workflow",
        detail: "This can start a new autonomous run in the selected scope.",
        confirmLabel: "Launch run",
        risk: "medium",
      },
      result: {
        success: {
          message: "Workflow queued.",
          schema: {
            type: "object",
            required: ["runId"],
            properties: { runId: { type: "string" } },
            additionalProperties: false,
          },
        },
        errors: [
          { reason: "workflow-disabled", message: "The selected workflow is not enabled." },
          { reason: "invalid-input", message: "The launch parameters were invalid." },
        ],
      },
    }),
    action({
      surfaceId: "operator-control",
      actionId: "session.launch",
      scopeId,
      label: "Start session",
      effect: "write",
      operation: { kind: "daemon-route", method: "POST", path: "/sessions" },
      parameters: sessionLaunchParameters(),
      result: resultSpec("Session started."),
    }),
    action({
      surfaceId: "operator-control",
      actionId: "launch.defaults.configure",
      scopeId,
      label: "Configure launch defaults",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "config", method: "set" },
      parameters: launchDefaultParameters(),
      readiness: {
        state: "disabled",
        reason: "controller-unavailable",
        message: "Preset, model, and effort defaults are configured through config/default preset selection; this shared surface records the controls until a multi-key config controller is contributed.",
      },
      result: resultSpec("Launch defaults updated."),
    }),
    action({
      surfaceId: "operator-control",
      actionId: "setup.oauth.start",
      scopeId,
      label: "Start OAuth setup",
      effect: "external",
      operation: { kind: "daemon-route", method: "POST", path: "/setup/requirements/google-workspace/oauth-credentials/start" },
      readiness: {
        state: "needs-setup",
        moduleName: "google-workspace",
        requirementId: "oauth-credentials",
        message: "OAuth credentials are not complete.",
      },
      result: resultSpec("OAuth setup started."),
    }),
    action({
      surfaceId: "operator-control",
      actionId: "approval.resolve",
      scopeId,
      label: "Resolve approval",
      effect: "external",
      operation: { kind: "daemon-route", method: "PATCH", path: "/approvals/a1b2c3d4" },
      confirmation: {
        mode: "required",
        title: "Resolve external approval",
        detail: "Approving an external-write tool call may affect a third-party service.",
        confirmLabel: "Resolve approval",
        risk: "high",
      },
      result: resultSpec("Approval resolved."),
    }),
  ];
}

export function demoMetrics(): UiMetric[] {
  return [
    { label: "Modules", value: "42", role: "info" },
    { label: "Capabilities ready", value: "37", role: "success" },
    { label: "Setup gaps", value: "2", role: "warn" },
    { label: "Pending requests", value: "3", role: "warn" },
  ];
}

export function capabilityRows(): UiTableRow[] {
  return [
    { id: "dashboard", cells: [
      { columnId: "capability", value: "dashboard" },
      { columnId: "module", value: "web" },
      { columnId: "state", value: "ready", role: "success" },
    ] },
    { id: "workflow.trigger", cells: [
      { columnId: "capability", value: "workflow.trigger" },
      { columnId: "module", value: "daemon" },
      { columnId: "state", value: "ready", role: "success" },
    ] },
    { id: "knowledge.semantic_search", cells: [
      { columnId: "capability", value: "knowledge.semantic_search" },
      { columnId: "module", value: "knowledge-semantic" },
      { columnId: "state", value: "unavailable", role: "warn" },
    ] },
  ];
}

export function demoLogEntries(): UiLogEntry[] {
  return [
    {
      timestamp: "2026-06-18T19:36:34.590Z",
      level: "info",
      source: "workflow.builder",
      message: "Builder picked up shared UI contribution protocol work.",
    },
    {
      timestamp: "2026-06-18T20:31:53.000Z",
      level: "warn",
      source: "approval.queue",
      message: "One external approval is waiting for operator review.",
    },
    {
      timestamp: "2026-06-18T21:08:12.000Z",
      level: "info",
      source: "daemon.events",
      message: "UI surface fixture rendered for client conformance.",
    },
  ];
}
