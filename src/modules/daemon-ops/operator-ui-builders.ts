import { buildUiSurfaceBundle } from "#core/daemon/ui-surface.js";
import {
  getPreset,
  listShippedPresets,
  SHIPPED_DEFAULT_PRESET_ID,
} from "#core/model/preset.js";
import type { OperatorInboxItem, OperatorInboxSnapshot } from "./operator-inbox.js";
import type {
  UiAction,
  UiActionEffect,
  UiActionOperation,
  UiActionParameterSpec,
  UiActionReadiness,
  UiActionResultSpec,
  UiConfirmation,
  UiFieldOption,
  UiFormField,
  UiListItem,
  UiLogEntry,
  UiMetric,
  UiPermission,
  UiRole,
  UiStatusEntry,
  UiSurface,
  UiSurfaceBundle,
  UiTableColumn,
  UiTableRow,
} from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

type ActionArgs = {
  surfaceId: string;
  actionId: string;
  scopeId: string;
  label: string;
  effect?: UiActionEffect;
  operation: UiActionOperation;
  parameters?: UiActionParameterSpec;
  confirmation?: UiConfirmation;
  readiness?: UiActionReadiness;
  result?: UiActionResultSpec;
  permissions?: readonly UiPermission[];
};

function resultSpec(message: string): UiActionResultSpec {
  return {
    success: { message },
    errors: [
      { reason: "unavailable", message: "The daemon action is currently unavailable." },
      { reason: "invalid-input", message: "The action parameters did not match the declared schema." },
    ],
  };
}

function action(args: ActionArgs): UiAction {
  const effect = args.effect ?? "read";
  return {
    surfaceId: args.surfaceId,
    actionId: args.actionId,
    scopeId: args.scopeId,
    label: args.label,
    effect,
    operation: args.operation,
    parameters: args.parameters,
    confirmation: args.confirmation ?? { mode: "none" },
    readiness: args.readiness ?? { state: "ready" },
    result: args.result ?? resultSpec(`${args.label} completed.`),
    permissions: args.permissions ?? [
      { kind: "effect", effect },
      { kind: "capability-scope", scope: effect === "read" ? "read" : "control" },
    ],
  };
}

function scopeIdForStatus(snapshot: StatusSnapshot): string {
  return snapshot.scopedProject?.projectId ?? `dir:${snapshot.projectDir}`;
}

function statusEntries(snapshot: StatusSnapshot, explain: boolean): UiStatusEntry[] {
  const entries: UiStatusEntry[] = [
    {
      label: "Daemon",
      value: snapshot.daemonRunning && snapshot.daemonPid !== undefined
        ? `running (pid ${snapshot.daemonPid})`
        : "not running (offline mode)",
      role: snapshot.daemonRunning ? "success" : "warn",
    },
    {
      label: "Dispatch",
      value: snapshot.daemonRunning
        ? snapshot.workflowPaused ? "paused" : "running"
        : "offline",
      role: snapshot.daemonRunning && !snapshot.workflowPaused ? "success" : "warn",
    },
    {
      label: "Runs",
      value: snapshot.daemonRunning
        ? `${snapshot.activeRuns} active, ${snapshot.queuedRuns} queued`
        : "offline (live run state unavailable)",
      role: snapshot.daemonRunning ? "neutral" : "muted",
    },
    {
      label: "Approvals",
      value: `${snapshot.pendingApprovals} pending`,
      role: snapshot.pendingApprovals > 0 ? "warn" : "muted",
    },
  ];

  if (snapshot.historicalWorkflow && !snapshot.daemonRunning) {
    entries.push({
      label: "Historical run store",
      value: `${snapshot.historicalWorkflow.activeRuns} active, ${snapshot.historicalWorkflow.queuedRuns} queued from offline files`,
      role: "warn",
    });
  }

  if (explain) {
    entries.push({
      label: "Runtime source",
      value: snapshot.daemonRunning
        ? "daemon control API"
        : "local files only; daemon API and event stream unavailable",
      role: snapshot.daemonRunning ? "success" : "warn",
    });
  }

  return entries;
}

function statusWarnings(snapshot: StatusSnapshot, scopeId: string): UiListItem[] {
  const warnings: UiListItem[] = [];
  if (!snapshot.daemonRunning) {
    warnings.push({
      id: "daemon-offline",
      title: "Daemon is offline",
      detail: "Dispatch, event stream, live sessions, and live run state are unavailable.",
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "daemon.start",
        scopeId,
        label: "Start daemon",
        effect: "write",
        operation: { kind: "client-namespace", namespace: "daemonOps", method: "start" },
        result: resultSpec("Daemon start requested."),
      }),
    });
  }
  if (snapshot.controlFile.kind === "stale") {
    warnings.push({
      id: "daemon-control-stale",
      title: "Daemon control file is stale",
      detail: `Recorded pid ${snapshot.controlFile.pid} is no longer alive.`,
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "doctor.fix",
        scopeId,
        label: "Run doctor",
        effect: "write",
        operation: { kind: "client-namespace", namespace: "doctor", method: "fix" },
        confirmation: {
          mode: "required",
          title: "Run doctor fix",
          detail: "This can modify local daemon control files.",
          confirmLabel: "Run fix",
          risk: "medium",
        },
      }),
    });
  }
  if (snapshot.pendingApprovals > 0) {
    warnings.push({
      id: "pending-approvals",
      title: "Approvals require attention",
      detail: `${snapshot.pendingApprovals} approval(s) are waiting for operator review.`,
      role: "warn",
      action: action({
        surfaceId: "status",
        actionId: "inbox.open",
        scopeId,
        label: "Open inbox",
        operation: { kind: "daemon-route", method: "GET", path: "/attention" },
      }),
    });
  }
  return warnings;
}

export function buildStatusUiSurface(
  snapshot: StatusSnapshot,
  options: { explain?: boolean } = {},
): UiSurface {
  const scopeId = scopeIdForStatus(snapshot);
  const actions = [
    action({
      surfaceId: "status",
      actionId: "daemon.start",
      scopeId,
      label: "Start daemon",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "daemonOps", method: "start" },
      result: resultSpec("Daemon start requested."),
    }),
    action({
      surfaceId: "status",
      actionId: "status.explain",
      scopeId,
      label: "Explain status",
      operation: { kind: "daemon-route", method: "GET", path: "/status" },
      result: resultSpec("Daemon status loaded."),
    }),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "status",
    extensionId: "core.status",
    title: "Status",
    intent: "Status",
    scopeId,
    attachmentPoint: { kind: "root" },
    order: 10,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      { kind: "status-summary", entries: statusEntries(snapshot, options.explain === true) },
      { kind: "list", title: "Warnings", items: statusWarnings(snapshot, scopeId) },
    ],
    actions,
  };
}

function actionIdForInboxItem(item: OperatorInboxItem): string {
  switch (item.kind) {
    case "runtime":
      return "runtime.open";
    case "approval":
      return "approval.open";
    case "owner-question":
      return "owner-question.open";
    case "blocked-task":
      return "blocked-task.open";
    case "setup":
      return "setup.open";
    case "failed-run":
      return "failed-run.open";
  }
}

function operationForInboxItem(item: OperatorInboxItem): UiActionOperation {
  switch (item.kind) {
    case "runtime":
      return { kind: "daemon-route", method: "GET", path: "/status" };
    case "approval":
      return { kind: "daemon-route", method: "GET", path: "/approvals?status=pending" };
    case "owner-question":
      return { kind: "daemon-route", method: "GET", path: "/owner-questions?status=pending" };
    case "blocked-task":
      return { kind: "daemon-route", method: "GET", path: "/tasks?state=blocked" };
    case "setup":
      return { kind: "daemon-route", method: "GET", path: "/setup/requirements" };
    case "failed-run":
      return { kind: "daemon-route", method: "GET", path: "/workflow/runs?status=failed" };
  }
}

function inboxRole(role: OperatorInboxItem["role"]): UiRole {
  return role === "accent" || role === "tool" || role === "agent" ? "neutral" : role;
}

function inboxSummaryEntries(snapshot: OperatorInboxSnapshot): UiStatusEntry[] {
  return [
    { label: "Runtime", value: `${snapshot.counts.runtime}`, role: snapshot.counts.runtime > 0 ? "warn" : "muted" },
    { label: "Approvals", value: `${snapshot.counts.approval}`, role: snapshot.counts.approval > 0 ? "warn" : "muted" },
    {
      label: "Owner questions",
      value: `${snapshot.counts["owner-question"]}`,
      role: snapshot.counts["owner-question"] > 0 ? "warn" : "muted",
    },
    { label: "Blocked", value: `${snapshot.counts["blocked-task"]}`, role: snapshot.counts["blocked-task"] > 0 ? "warn" : "muted" },
    { label: "Setup", value: `${snapshot.counts.setup}`, role: snapshot.counts.setup > 0 ? "warn" : "muted" },
    { label: "Failed runs", value: `${snapshot.counts["failed-run"]}`, role: snapshot.counts["failed-run"] > 0 ? "error" : "muted" },
  ];
}

function uniqueActions(actions: readonly (UiAction | undefined)[]): UiAction[] {
  const seen = new Set<string>();
  const out: UiAction[] = [];
  for (const action of actions) {
    if (!action) continue;
    const key = `${action.surfaceId}:${action.actionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

export function buildInboxUiSurface(snapshot: OperatorInboxSnapshot): UiSurface {
  const scopeId = `dir:${snapshot.projectDir}`;
  const refresh = action({
    surfaceId: "inbox",
    actionId: "inbox.refresh",
    scopeId,
    label: "Refresh inbox",
    operation: { kind: "daemon-route", method: "GET", path: "/attention" },
    result: resultSpec("Inbox refreshed."),
  });
  const items: UiListItem[] = snapshot.items.map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    role: inboxRole(item.role),
    action: action({
      surfaceId: "inbox",
      actionId: actionIdForInboxItem(item),
      scopeId,
      label: item.title,
      operation: operationForInboxItem(item),
    }),
  }));
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "inbox",
    extensionId: "core.inbox",
    title: "Inbox",
    intent: "Inbox",
    scopeId,
    attachmentPoint: { kind: "root" },
    order: 20,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: items.length === 0
      ? [{ kind: "empty", title: "Operator inbox is clear", detail: snapshot.projectDir, action: refresh }]
      : [
          { kind: "status-summary", entries: inboxSummaryEntries(snapshot) },
          { kind: "list", title: "Attention items", items },
        ],
    actions: uniqueActions([refresh, ...items.map((item) => item.action)]),
  };
}

function launchWorkflowParameters(): UiActionParameterSpec {
  const fields: UiFormField[] = [
    {
      id: "name",
      label: "Workflow",
      input: "select",
      required: true,
      options: [
        { label: "Builder", value: "builder" },
        { label: "Decomposer", value: "decomposer" },
      ],
    },
    {
      id: "tags",
      label: "Run tags JSON",
      input: "text",
      required: false,
      schema: {
        type: "array",
        description: "Optional workflow run tags sent as a JSON string array.",
        items: { type: "string" },
      },
    },
    {
      id: "payload",
      label: "Payload JSON",
      input: "text",
      required: false,
      schema: {
        type: "object",
        description: "Optional workflow payload object.",
        properties: {},
        additionalProperties: true,
      },
    },
  ];
  return {
    fields,
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", enum: ["builder", "decomposer"], default: "builder" },
        tags: {
          type: "array",
          description: "Optional workflow run tags.",
          items: { type: "string" },
        },
        payload: {
          type: "object",
          description: "Optional workflow trigger payload.",
          properties: {},
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  };
}

function sessionLaunchParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "autonomy_mode",
        label: "Autonomy mode",
        input: "select",
        required: true,
        options: [
          { label: "Passive", value: "passive" },
          { label: "Supervised", value: "supervised" },
          { label: "Autonomous", value: "autonomous" },
        ],
      },
      {
        id: "session_id",
        label: "Resume session id",
        input: "text",
        required: false,
      },
      {
        id: "conversation_id",
        label: "Resume conversation id",
        input: "text",
        required: false,
      },
    ],
    schema: {
      type: "object",
      required: ["autonomy_mode"],
      properties: {
        autonomy_mode: { type: "string", enum: ["passive", "supervised", "autonomous"], default: "supervised" },
        session_id: { type: "string" },
        conversation_id: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

function shippedPresetOptions(): UiFieldOption[] {
  return listShippedPresets().map((preset) => ({
    label: preset.id,
    value: preset.id,
  }));
}

function shippedModelOptions(): UiFieldOption[] {
  const seen = new Set<string>();
  const options: UiFieldOption[] = [];
  for (const preset of listShippedPresets()) {
    for (const model of [preset.defaultModel, preset.tiers.fast, preset.tiers.balanced, preset.tiers.capable]) {
      if (seen.has(model)) continue;
      seen.add(model);
      options.push({ label: model, value: model });
    }
  }
  return options;
}

function launchDefaultParameters(): UiActionParameterSpec {
  const defaultPreset = getPreset(SHIPPED_DEFAULT_PRESET_ID);
  const effortOptions: UiFieldOption[] = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
    { label: "XHigh", value: "xhigh" },
    { label: "Max", value: "max" },
  ];
  return {
    fields: [
      {
        id: "preset",
        label: "Launch preset",
        input: "select",
        required: true,
        options: shippedPresetOptions(),
      },
      {
        id: "model",
        label: "Default model",
        input: "select",
        required: true,
        options: shippedModelOptions(),
      },
      {
        id: "effort",
        label: "Default effort",
        input: "select",
        required: true,
        options: effortOptions,
      },
      {
        id: "use_shipped_defaults",
        label: "Use shipped defaults",
        input: "boolean",
        required: false,
      },
    ],
    schema: {
      type: "object",
      required: ["preset", "model", "effort"],
      properties: {
        preset: {
          type: "string",
          enum: shippedPresetOptions().map((option) => option.value),
          default: defaultPreset.id,
        },
        model: {
          type: "string",
          enum: shippedModelOptions().map((option) => option.value),
          default: defaultPreset.defaultModel,
        },
        effort: {
          type: "string",
          enum: effortOptions.map((option) => option.value),
          default: defaultPreset.defaultEffort,
        },
        use_shipped_defaults: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  };
}

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

export function buildStatusInboxBundle(args: {
  status: StatusSnapshot;
  inbox: OperatorInboxSnapshot;
}): UiSurfaceBundle {
  return buildUiSurfaceBundle([
    buildStatusUiSurface(args.status, { explain: true }),
    buildInboxUiSurface(args.inbox),
  ]);
}
