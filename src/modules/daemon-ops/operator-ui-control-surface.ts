import {
  action,
  resultSpec,
} from "./operator-ui-builder-common.js";
import {
  launchDefaultParameters,
  launchWorkflowParameters,
  sessionLaunchParameters,
} from "./operator-ui-launch-controls.js";
import type {
  UiAction,
  UiLogEntry,
  UiMetric,
  UiSurface,
  UiTableColumn,
  UiTableRow,
} from "./operator-ui-types.js";

function demoActions(scopeId: string): UiAction[] {
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

function demoMetrics(): UiMetric[] {
  return [
    { label: "Modules", value: "42", role: "info" },
    { label: "Capabilities ready", value: "37", role: "success" },
    { label: "Setup gaps", value: "2", role: "warn" },
    { label: "Pending requests", value: "3", role: "warn" },
  ];
}

function capabilityRows(): UiTableRow[] {
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

function demoLogEntries(): UiLogEntry[] {
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

export function buildOperatorControlUiSurface(scopeId = "p-kota-fixture-default"): UiSurface {
  const actions = demoActions(scopeId);
  const columns: UiTableColumn[] = [
    { id: "name", label: "Name" },
    { id: "type", label: "Type" },
    { id: "state", label: "State" },
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "operator-control",
    extensionId: "demo.operator-control",
    title: "Operator Control",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 30,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    conditions: [{ kind: "capability", capabilityId: "workflow.trigger", status: "ready" }],
    nodes: [
      { kind: "metrics", title: "Capability overview", metrics: demoMetrics() },
      {
        kind: "text",
        title: "Shared contribution graph",
        body: "Modules declare these operator controls once. CLI, web, Apple, and mobile render the same semantic nodes.",
        role: "info",
      },
      {
        kind: "link",
        label: "Open shared UI surface route",
        target: { kind: "daemon-route", path: "/ui/surfaces" },
        role: "info",
      },
      {
        kind: "tabs",
        title: "Operator workspaces",
        activeTabId: "requests",
        tabs: [
          {
            id: "requests",
            label: "Requests",
            nodes: [
              {
                kind: "detail",
                title: "Requests",
                body: "Approvals, owner questions, setup requirements, and blocked work share one inbox projection.",
              },
            ],
          },
          {
            id: "runs",
            label: "Runs",
            nodes: [
              {
                kind: "detail",
                title: "Runs",
                body: "Workflow launch controls and live run summaries stay in the same typed surface graph.",
              },
            ],
          },
          {
            id: "setup",
            label: "Setup",
            nodes: [
              {
                kind: "detail",
                title: "Setup",
                body: "Setup/auth controls carry readiness and effect metadata before clients render or execute them.",
              },
            ],
          },
        ],
      },
      {
        kind: "table",
        title: "Pending requests",
        columns,
        rows: [
          {
            id: "approval-a1b2c3d4",
            cells: [
              { columnId: "name", value: "shell.exec" },
              { columnId: "type", value: "approval" },
              { columnId: "state", value: "pending", role: "warn" },
            ],
            action: actions.find((candidate) => candidate.actionId === "approval.resolve"),
          },
          {
            id: "owner-question-q1",
            cells: [
              { columnId: "name", value: "Select calendar provider" },
              { columnId: "type", value: "owner-question" },
              { columnId: "state", value: "pending", role: "warn" },
            ],
          },
        ],
      },
      {
        kind: "table",
        title: "Workflow definitions",
        columns: [
          { id: "workflow", label: "Workflow" },
          { id: "trigger", label: "Trigger" },
          { id: "state", label: "State" },
        ],
        rows: [
          { id: "builder", cells: [
            { columnId: "workflow", value: "builder" },
            { columnId: "trigger", value: "autonomy.queue.available" },
            { columnId: "state", value: "enabled", role: "success" },
          ] },
          { id: "decomposer", cells: [
            { columnId: "workflow", value: "decomposer" },
            { columnId: "trigger", value: "task.created" },
            { columnId: "state", value: "enabled", role: "success" },
          ] },
        ],
      },
      { kind: "progress", label: "Run queue saturation", value: 2, max: 10, role: "info" },
      {
        kind: "log",
        title: "Recent run log",
        entries: demoLogEntries(),
      },
      {
        kind: "log-stream",
        title: "Live daemon events",
        streamId: "daemon-events",
        source: {
          kind: "sse",
          path: "/events",
          eventTypes: ["workflow.run.completed", "approval.created"],
        },
        entries: demoLogEntries().slice(0, 2),
      },
      {
        kind: "form",
        title: "Launch workflow run",
        fields: launchWorkflowParameters().fields,
        submit: actions.find((candidate) => candidate.actionId === "workflow.launch")!,
      },
      {
        kind: "form",
        title: "Start session",
        fields: sessionLaunchParameters().fields,
        submit: actions.find((candidate) => candidate.actionId === "session.launch")!,
      },
      {
        kind: "form",
        title: "Launch defaults",
        fields: launchDefaultParameters().fields,
        submit: actions.find((candidate) => candidate.actionId === "launch.defaults.configure")!,
      },
      {
        kind: "table",
        title: "Setup requirements",
        columns,
        rows: [
          { id: "google-oauth", cells: [
            { columnId: "name", value: "google-workspace/oauth-credentials" },
            { columnId: "type", value: "oauth" },
            { columnId: "state", value: "missing", role: "warn" },
          ], action: actions.find((candidate) => candidate.actionId === "setup.oauth.start") },
          { id: "telegram-secret", cells: [
            { columnId: "name", value: "telegram/bot-credentials" },
            { columnId: "type", value: "secret" },
            { columnId: "state", value: "ready", role: "success" },
          ] },
        ],
      },
      {
        kind: "table",
        title: "Module capability status",
        columns: [
          { id: "capability", label: "Capability" },
          { id: "module", label: "Module" },
          { id: "state", label: "State" },
        ],
        rows: capabilityRows(),
      },
      {
        kind: "action-list",
        title: "Typed daemon actions",
        actions,
      },
    ],
    actions,
  };
}
