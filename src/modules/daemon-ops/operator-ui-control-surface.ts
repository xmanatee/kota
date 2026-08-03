import {
  capabilityRows,
  demoActions,
  demoLogEntries,
  demoMetrics,
} from "./operator-ui-control-fixture.js";
import {
  launchDefaultParameters,
  launchWorkflowParameters,
  sessionLaunchParameters,
} from "./operator-ui-launch-controls.js";
import type {
  UiSurface,
  UiTableColumn,
} from "./operator-ui-types.js";

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
    refreshEvents: [
      "workflow.started",
      "workflow.completed",
      "approval.created",
      "approval.changed",
      "daemon.config.reload",
    ],
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
