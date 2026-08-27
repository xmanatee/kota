const scopeId = "scope-fixture";
const surfaceId = "operator-control";

function result(message) {
  return { success: { message }, errors: [] };
}

function action(overrides) {
  return {
    surfaceId,
    scopeId,
    effect: "read",
    operation: { kind: "daemon-route", method: "GET", path: "/status" },
    confirmation: { mode: "none" },
    readiness: { state: "ready" },
    result: result("Completed."),
    ...overrides,
  };
}

const refresh = action({
  actionId: "ui.refresh",
  label: "Refresh shared UI",
  operation: { kind: "daemon-route", method: "GET", path: "/ui/surfaces" },
  result: result("UI refreshed."),
});

const launch = action({
  actionId: "workflow.launch",
  label: "Launch workflow run",
  effect: "external",
  operation: { kind: "client-namespace", namespace: "workflow", method: "run" },
  parameters: {
    schema: {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string", default: "builder" },
        tags: { type: "array", items: { type: "string" } },
        payload: { type: "object", properties: {}, additionalProperties: true },
      },
    },
    fields: [
      { id: "name", label: "Workflow", input: "text", required: true, schema: { type: "string", default: "builder" } },
      { id: "tags", label: "Run tags JSON", input: "text", required: false, schema: { type: "array", items: { type: "string" } } },
      { id: "payload", label: "Payload JSON", input: "multiline", required: false, schema: { type: "object", properties: {}, additionalProperties: true } },
    ],
  },
  confirmation: {
    mode: "required",
    title: "Launch workflow run",
    detail: "This can start a new autonomous run in the selected scope.",
    confirmLabel: "Launch run",
    risk: "high",
  },
  result: result("Workflow queued."),
});

const launchSession = action({
  actionId: "session.launch",
  label: "Start session",
  effect: "external",
  operation: { kind: "client-namespace", namespace: "sessions", method: "create" },
  parameters: {
    schema: {
      type: "object",
      required: ["autonomy_mode"],
      additionalProperties: false,
      properties: { autonomy_mode: { type: "string", enum: ["passive", "supervised", "autonomous"], default: "supervised" } },
    },
    fields: [{
      id: "autonomy_mode",
      label: "Autonomy mode",
      input: "select",
      required: true,
      options: [
        { label: "Passive", value: "passive" },
        { label: "Supervised", value: "supervised" },
        { label: "Autonomous", value: "autonomous" },
      ],
      schema: { type: "string", enum: ["passive", "supervised", "autonomous"], default: "supervised" },
    }],
  },
  result: result("Session started."),
});

const disabled = action({
  actionId: "launch.defaults.configure",
  label: "Configure launch defaults",
  effect: "write",
  operation: { kind: "client-namespace", namespace: "config", method: "set" },
  readiness: {
    state: "disabled",
    reason: "managed-setting",
    message: "Launch defaults are configured through config/default preset selection.",
  },
});

const needsSetup = action({
  actionId: "setup.oauth.start",
  label: "Connect provider",
  effect: "external",
  operation: { kind: "client-namespace", namespace: "setup", method: "start" },
  readiness: {
    state: "needs-setup",
    moduleName: "example-provider",
    requirementId: "oauth",
    message: "Provider setup is required.",
  },
});

const approve = action({
  actionId: "approval.resolve",
  label: "Approve change",
  effect: "write",
  operation: { kind: "daemon-route", method: "POST", path: "/approvals/example/approve" },
  confirmation: {
    mode: "required",
    title: "Approve change",
    detail: "Approve this external change.",
    confirmLabel: "Approve",
    risk: "medium",
  },
});

function simpleSurface({ id, extensionId, title, intent, order }) {
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: id,
    extensionId,
    title,
    intent,
    scopeId,
    attachmentPoint: { kind: "root" },
    order,
    nodes: [{ kind: "text", title, body: `${title} behavior vector.` }],
    actions: [action({ surfaceId: id, actionId: `${id}.open`, label: `Open ${title}` })],
  };
}

export function buildUiBehaviorVectors() {
  const operator = {
    protocolVersion: "ui.surface.v1",
    surfaceId,
    extensionId: "core.operator-control",
    title: "Operator Control",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "root" },
    order: 30,
    refreshEvents: ["workflow.run.completed", "task.changed"],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      { kind: "status-summary", entries: [{ label: "workflow.trigger", value: "ready", role: "success" }] },
      { kind: "metrics", title: "Queue", metrics: [{ label: "Open", value: "2", role: "info" }] },
      { kind: "text", title: "Action unavailable", body: "One action is intentionally unavailable.", role: "warn" },
      { kind: "link", label: "Open shared UI surface route", target: { kind: "daemon-route", path: "/ui/surfaces" }, role: "info" },
      {
        kind: "tabs",
        title: "Details",
        activeTabId: "list",
        tabs: [
          { id: "list", label: "List", nodes: [{ kind: "list", title: "Items", items: [{ id: "one", title: "First", detail: "Representative item", role: "neutral" }] }] },
          { id: "detail", label: "Detail", nodes: [{ kind: "detail", title: "Detail", body: "Representative detail" }] },
        ],
      },
      { kind: "table", title: "Tasks", columns: [{ id: "name", label: "Name" }], rows: [{ id: "builder", cells: [{ columnId: "name", value: "Builder" }] }] },
      { kind: "progress", label: "Migration", value: 3, max: 4, role: "info" },
      { kind: "log", title: "Recent events", entries: [{ timestamp: "2026-08-23T16:00:00.000Z", level: "info", message: "Ready." }] },
      {
        kind: "log-stream",
        title: "Live daemon events",
        streamId: "daemon-events",
        source: { kind: "sse", path: "/events", eventTypes: ["workflow.run.completed", "task.changed"] },
        entries: [],
      },
      { kind: "form", title: "Launch workflow run", fields: launch.parameters.fields, submit: launch },
      { kind: "form", title: "Start session", fields: launchSession.parameters.fields, submit: launchSession },
      { kind: "form", title: "Configure launch defaults", fields: [], submit: disabled },
      { kind: "action-list", title: "Actions", actions: [refresh, needsSetup, approve] },
      { kind: "navigation", label: "Surfaces", items: [{ surfaceId: "status", label: "Status" }] },
      { kind: "command", action: refresh },
      { kind: "empty", title: "Nothing pending", detail: "No work is pending.", action: refresh },
      { kind: "error", title: "Example error", detail: "A recoverable error.", action: refresh },
    ],
    actions: [refresh, launch, launchSession, disabled, needsSetup, approve],
  };

  return {
    operatorBundle: {
      protocolVersion: "ui.surface.v1",
      surfaces: [
        simpleSurface({ id: "status", extensionId: "core.status", title: "Status", intent: "Status", order: 10 }),
        simpleSurface({ id: "inbox", extensionId: "core.inbox", title: "Inbox", intent: "Inbox", order: 20 }),
        operator,
        simpleSurface({ id: "setup", extensionId: "core.setup", title: "Setup", intent: "Setup", order: 40 }),
      ],
    },
  };
}
