import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowDefinitionSummary } from "#core/daemon/daemon-control.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { buildUiSurfaceBundle } from "#core/daemon/ui-surface.js";
import {
  getPreset,
  listShippedPresets,
  SHIPPED_DEFAULT_PRESET_ID,
} from "#core/model/preset.js";
import type { AgentsListResult } from "#modules/agent-ops/client.js";
import type { HistoryListResult } from "#modules/history/client.js";
import type { KnowledgeListResult } from "#modules/knowledge/client.js";
import type { MemoryListResult } from "#modules/memory/client.js";
import type { ModulesListResult } from "#modules/module-manager/client.js";
import type { ModuleSetupStatusResponse } from "#modules/setup/client.js";
import type {
  WorkflowDefinitionsResult,
  WorkflowRunsListResult,
  WorkflowStatusSnapshot,
} from "#modules/workflow-ops/client.js";
import type { ProjectsListResult, SessionsListResult } from "./client.js";
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

export type SurfaceRead<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

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

function readRole<T>(read: SurfaceRead<T>): UiRole {
  return read.ok ? "success" : "warn";
}

function readValue<T>(read: SurfaceRead<T>, value: (inner: T) => string): string {
  return read.ok ? value(read.value) : read.message;
}

function shortId(value: string, max = 32): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function triggerSummary(definition: WorkflowDefinitionSummary): string {
  if (definition.triggers.length === 0) return "manual";
  return definition.triggers.map((trigger) => {
    switch (trigger.type) {
      case "event":
        return trigger.event;
      case "cron":
        return trigger.schedule;
      case "interval":
        return `${trigger.intervalMs}ms`;
      case "webhook":
        return "webhook";
      case "watch":
        return trigger.patterns.join(",");
    }
  }).join(", ");
}

function unavailableRows(message: string): UiTableRow[] {
  return [
    {
      id: "unavailable",
      cells: [
        { columnId: "name", value: "Unavailable", role: "warn" },
        { columnId: "state", value: message, role: "warn" },
        { columnId: "detail", value: "The active KotaClient could not read this namespace.", role: "muted" },
      ],
    },
  ];
}

const NAME_STATE_DETAIL_COLUMNS: UiTableColumn[] = [
  { id: "name", label: "Name" },
  { id: "state", label: "State" },
  { id: "detail", label: "Detail" },
];

function emptyRows(label: string): UiTableRow[] {
  return [
    {
      id: "none",
      cells: [
        { columnId: "name", value: label, role: "muted" },
        { columnId: "state", value: "empty", role: "muted" },
        { columnId: "detail", value: "No matching records are exposed right now.", role: "muted" },
      ],
    },
  ];
}

function projectUseParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "projectId",
        label: "Project id",
        input: "text",
        required: false,
      },
      {
        id: "clear",
        label: "Clear active selection",
        input: "boolean",
        required: false,
      },
    ],
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        clear: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  };
}

export function buildScopeUiSurface(args: {
  status: StatusSnapshot;
  projects: SurfaceRead<ProjectsListResult>;
  sessions: SurfaceRead<SessionsListResult>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const projectRows: UiTableRow[] = args.projects.ok
    ? args.projects.value.ok
      ? (() => {
          const projectsView = args.projects.value;
          return projectsView.projects.map((project) => {
          const markers: string[] = [];
          if (project.projectId === projectsView.activeProjectId) markers.push("active");
          if (project.projectId === projectsView.defaultProjectId) markers.push("default");
          return {
            id: project.projectId,
            cells: [
              { columnId: "name", value: project.projectId, role: markers.includes("active") ? "info" : "neutral" },
              { columnId: "state", value: markers.length > 0 ? markers.join(", ") : "available", role: markers.includes("active") ? "success" : "muted" },
              { columnId: "detail", value: `${project.displayName}  ${project.projectDir}`, role: "muted" },
            ],
          };
        });
        })()
      : unavailableRows("daemon required")
    : unavailableRows(args.projects.message);

  const sessionRows: UiTableRow[] = args.sessions.ok
    ? args.sessions.value.sessions.length === 0
      ? emptyRows("Live sessions")
      : args.sessions.value.sessions.map((session) => ({
          id: session.id,
          cells: [
            { columnId: "name", value: shortId(session.id), role: "info" },
            { columnId: "state", value: session.autonomyMode, role: "success" },
            { columnId: "detail", value: `${session.projectId}  ${session.source ?? "daemon"}  last=${new Date(session.lastActive).toISOString()}`, role: "muted" },
          ],
        }))
    : unavailableRows(args.sessions.message);

  const actions = [
    action({
      surfaceId: "scopes",
      actionId: "projects.list",
      scopeId,
      label: "Reload scope registry",
      operation: { kind: "client-namespace", namespace: "projects", method: "list" },
      result: resultSpec("Scope registry loaded."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "project.use",
      scopeId,
      label: "Switch active scope",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "projects", method: "use" },
      parameters: projectUseParameters(),
      confirmation: {
        mode: "required",
        title: "Switch active scope",
        detail: "Subsequent daemon reads without an explicit project override use this selection.",
        confirmLabel: "Switch scope",
        risk: "low",
      },
      result: resultSpec("Active scope updated."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "sessions.list",
      scopeId,
      label: "List live sessions",
      operation: { kind: "client-namespace", namespace: "sessions", method: "list" },
      result: resultSpec("Live sessions loaded."),
    }),
  ];

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "scopes",
    extensionId: "core.scopes",
    title: "Scopes",
    intent: "Status",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Status" },
    order: 15,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          {
            label: "Registry",
            value: readValue(args.projects, (projects) => projects.ok ? `${projects.projects.length} configured` : "daemon required"),
            role: readRole(args.projects),
          },
          {
            label: "Active",
            value: readValue(args.projects, (projects) => projects.ok ? projects.activeProjectId ?? projects.defaultProjectId : "unavailable"),
            role: readRole(args.projects),
          },
          {
            label: "Sessions",
            value: readValue(args.sessions, (sessions) => `${sessions.sessions.length} live`),
            role: readRole(args.sessions),
          },
        ],
      },
      { kind: "table", title: "Directory scopes", columns: NAME_STATE_DETAIL_COLUMNS, rows: projectRows },
      { kind: "table", title: "Live sessions", columns: NAME_STATE_DETAIL_COLUMNS, rows: sessionRows },
      { kind: "action-list", title: "Scope actions", actions },
    ],
    actions,
  };
}

function workflowRows(definitions: SurfaceRead<WorkflowDefinitionsResult>): UiTableRow[] {
  if (!definitions.ok) return unavailableRows(definitions.message);
  if (definitions.value.definitions.length === 0) return emptyRows("Workflow definitions");
  return definitions.value.definitions.map((definition) => ({
    id: definition.name,
    cells: [
      { columnId: "name", value: definition.name, role: definition.enabled ? "success" : "muted" },
      { columnId: "state", value: definition.runtimeEnabled === false ? "runtime disabled" : definition.enabled ? "enabled" : "disabled", role: definition.enabled ? "success" : "warn" },
      { columnId: "detail", value: `${definition.stepCount} step(s); ${triggerSummary(definition)}`, role: "muted" },
    ],
  }));
}

function activeRunRows(status: SurfaceRead<WorkflowStatusSnapshot>): UiTableRow[] {
  if (!status.ok) return unavailableRows(status.message);
  if (status.value.activeRuns.length === 0) return emptyRows("Active runs");
  return status.value.activeRuns.map((run) => ({
    id: run.runId,
    cells: [
      { columnId: "name", value: shortId(run.runId), role: "info" },
      { columnId: "state", value: run.workflow, role: "success" },
      { columnId: "detail", value: `started ${run.startedAt}`, role: "muted" },
    ],
  }));
}

function queuedRunRows(status: SurfaceRead<WorkflowStatusSnapshot>): UiTableRow[] {
  if (!status.ok) return unavailableRows(status.message);
  if (status.value.pendingRuns.length === 0) return emptyRows("Queued runs");
  return status.value.pendingRuns.map((run, index) => ({
    id: run.runId ?? `queued-${index}`,
    cells: [
      { columnId: "name", value: shortId(run.runId ?? `queued-${index}`), role: "info" },
      { columnId: "state", value: run.workflowName, role: "warn" },
      { columnId: "detail", value: `enqueued ${new Date(run.enqueuedAtMs).toISOString()}; not-before ${new Date(run.notBeforeMs).toISOString()}`, role: "muted" },
    ],
  }));
}

function recentRunRows(runs: SurfaceRead<WorkflowRunsListResult>): UiTableRow[] {
  if (!runs.ok) return unavailableRows(runs.message);
  if (runs.value.runs.length === 0) return emptyRows("Recent runs");
  return runs.value.runs.map((run) => ({
    id: run.id,
    cells: [
      { columnId: "name", value: shortId(run.id), role: "info" },
      { columnId: "state", value: `${run.workflow} ${run.status}`, role: run.status === "failed" ? "error" : run.status === "success" ? "success" : "warn" },
      { columnId: "detail", value: `${run.startedAt}${run.totalCostUsd !== undefined ? `  $${run.totalCostUsd.toFixed(4)}` : ""}`, role: "muted" },
    ],
  }));
}

function approvalRows(approvals: SurfaceRead<{ approvals: PendingApproval[] }>): UiTableRow[] {
  if (!approvals.ok) return unavailableRows(approvals.message);
  if (approvals.value.approvals.length === 0) return emptyRows("Approvals");
  return approvals.value.approvals.map((approval) => ({
    id: approval.id,
    cells: [
      { columnId: "name", value: shortId(approval.id), role: approval.risk === "dangerous" ? "error" : "warn" },
      { columnId: "state", value: approval.status, role: approval.status === "pending" ? "warn" : "muted" },
      { columnId: "detail", value: `${approval.tool}  ${approval.reason}`, role: "muted" },
    ],
  }));
}

function ownerQuestionRows(questions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>): UiTableRow[] {
  if (!questions.ok) return unavailableRows(questions.message);
  if (questions.value.questions.length === 0) return emptyRows("Owner questions");
  return questions.value.questions.map((question) => ({
    id: question.id,
    cells: [
      { columnId: "name", value: shortId(question.id), role: "warn" },
      { columnId: "state", value: question.status, role: question.status === "pending" ? "warn" : "muted" },
      { columnId: "detail", value: question.question, role: "muted" },
    ],
  }));
}

function runtimeLogEntries(args: {
  status: SurfaceRead<WorkflowStatusSnapshot>;
  runs: SurfaceRead<WorkflowRunsListResult>;
}): UiLogEntry[] {
  const entries: UiLogEntry[] = [];
  if (args.status.ok) {
    for (const run of args.status.value.activeRuns.slice(0, 3)) {
      entries.push({
        timestamp: run.startedAt,
        level: "info",
        source: `workflow.${run.workflow}`,
        message: `Active run ${run.runId} is executing.`,
      });
    }
  }
  if (args.runs.ok) {
    for (const run of args.runs.value.runs.slice(0, 3)) {
      entries.push({
        timestamp: run.startedAt,
        level: run.status === "failed" ? "error" : run.status === "success" ? "info" : "warn",
        source: `workflow.${run.workflow}`,
        message: `${run.id} ${run.status}.`,
      });
    }
  }
  return entries.length > 0 ? entries : [
    {
      timestamp: new Date().toISOString(),
      level: "info",
      source: "daemon.events",
      message: "Waiting for live workflow, approval, owner-question, and session events.",
    },
  ];
}

function runAbortParameters(): UiActionParameterSpec {
  return {
    fields: [{ id: "runId", label: "Run id", input: "text", required: true }],
    schema: {
      type: "object",
      required: ["runId"],
      properties: { runId: { type: "string" } },
      additionalProperties: false,
    },
  };
}

export function buildRuntimeUiSurface(args: {
  status: StatusSnapshot;
  workflowStatus: SurfaceRead<WorkflowStatusSnapshot>;
  runs: SurfaceRead<WorkflowRunsListResult>;
  definitions: SurfaceRead<WorkflowDefinitionsResult>;
  approvals: SurfaceRead<{ approvals: PendingApproval[] }>;
  ownerQuestions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>;
  sessions: SurfaceRead<SessionsListResult>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const launch = action({
    surfaceId: "runs",
    actionId: "workflow.launch",
    scopeId,
    label: "Launch workflow run",
    effect: "write",
    operation: { kind: "daemon-route", method: "POST", path: "/workflow/trigger" },
    parameters: launchWorkflowParameters(),
    confirmation: {
      mode: "required",
      title: "Launch workflow",
      detail: "This queues a workflow run in the selected scope.",
      confirmLabel: "Launch run",
      risk: "medium",
    },
    result: resultSpec("Workflow queued."),
  });
  const actions = [
    action({
      surfaceId: "runs",
      actionId: "workflow.status",
      scopeId,
      label: "Refresh workflow status",
      operation: { kind: "client-namespace", namespace: "workflow", method: "status" },
      result: resultSpec("Workflow status loaded."),
    }),
    action({
      surfaceId: "runs",
      actionId: "workflow.pause",
      scopeId,
      label: "Pause dispatch",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "pause" },
      confirmation: {
        mode: "required",
        title: "Pause workflow dispatch",
        detail: "No new workflow runs will be dispatched until resumed.",
        confirmLabel: "Pause dispatch",
        risk: "medium",
      },
      result: resultSpec("Workflow dispatch paused."),
    }),
    action({
      surfaceId: "runs",
      actionId: "workflow.resume",
      scopeId,
      label: "Resume dispatch",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "resume" },
      result: resultSpec("Workflow dispatch resumed."),
    }),
    action({
      surfaceId: "runs",
      actionId: "workflow.abort",
      scopeId,
      label: "Abort active runs",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "abort" },
      confirmation: {
        mode: "required",
        title: "Abort active workflow runs",
        detail: "This asks every active workflow run to stop.",
        confirmLabel: "Abort runs",
        risk: "high",
      },
      result: resultSpec("Active workflow runs aborted."),
    }),
    action({
      surfaceId: "runs",
      actionId: "run.abort",
      scopeId,
      label: "Abort one run",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "workflow", method: "abortRun" },
      parameters: runAbortParameters(),
      confirmation: {
        mode: "required",
        title: "Abort workflow run",
        detail: "This asks one active workflow run to stop.",
        confirmLabel: "Abort run",
        risk: "high",
      },
      result: resultSpec("Workflow run aborted."),
    }),
    launch,
  ];

  const activeCount = args.workflowStatus.ok ? args.workflowStatus.value.activeRuns.length : 0;
  const queuedCount = args.workflowStatus.ok ? args.workflowStatus.value.pendingRuns.length : 0;
  const agentLimit = args.workflowStatus.ok ? args.workflowStatus.value.agentConcurrency : 1;
  const codeLimit = args.workflowStatus.ok ? args.workflowStatus.value.codeConcurrency : 1;

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "runs",
    extensionId: "core.runs",
    title: "Runs and Automations",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 30,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          { label: "Dispatch", value: args.workflowStatus.ok ? args.workflowStatus.value.paused ? "paused" : "running" : args.workflowStatus.message, role: readRole(args.workflowStatus) },
          { label: "Active", value: `${activeCount}`, role: activeCount > 0 ? "warn" : "muted" },
          { label: "Queued", value: `${queuedCount}`, role: queuedCount > 0 ? "warn" : "muted" },
          { label: "Definitions", value: readValue(args.definitions, (definitions) => `${definitions.definitions.length}`), role: readRole(args.definitions) },
          { label: "Approvals", value: readValue(args.approvals, (approvals) => `${approvals.approvals.length}`), role: readRole(args.approvals) },
          { label: "Owner questions", value: readValue(args.ownerQuestions, (questions) => `${questions.questions.length}`), role: readRole(args.ownerQuestions) },
          { label: "Sessions", value: readValue(args.sessions, (sessions) => `${sessions.sessions.length}`), role: readRole(args.sessions) },
        ],
      },
      { kind: "progress", label: "Agent run slots", value: Math.min(activeCount, agentLimit), max: Math.max(1, agentLimit), role: activeCount > 0 ? "warn" : "info" },
      { kind: "progress", label: "Code run slots", value: Math.min(activeCount, codeLimit), max: Math.max(1, codeLimit), role: activeCount > 0 ? "warn" : "info" },
      { kind: "table", title: "Active run supervision", columns: NAME_STATE_DETAIL_COLUMNS, rows: activeRunRows(args.workflowStatus) },
      { kind: "table", title: "Queued workflow runs", columns: NAME_STATE_DETAIL_COLUMNS, rows: queuedRunRows(args.workflowStatus) },
      { kind: "table", title: "Recent run results", columns: NAME_STATE_DETAIL_COLUMNS, rows: recentRunRows(args.runs) },
      { kind: "table", title: "Workflow definitions and schedules", columns: NAME_STATE_DETAIL_COLUMNS, rows: workflowRows(args.definitions) },
      { kind: "table", title: "Approvals", columns: NAME_STATE_DETAIL_COLUMNS, rows: approvalRows(args.approvals) },
      { kind: "table", title: "Owner questions", columns: NAME_STATE_DETAIL_COLUMNS, rows: ownerQuestionRows(args.ownerQuestions) },
      {
        kind: "log-stream",
        title: "Live run event stream",
        streamId: "workflow-events",
        source: {
          kind: "sse",
          path: "/events",
          eventTypes: [
            "workflow.started",
            "workflow.step.completed",
            "workflow.completed",
            "queue.changed",
            "approval.changed",
            "owner.question.asked",
            "owner.question.changed",
            "session.registered",
            "session.unregistered",
          ],
        },
        entries: runtimeLogEntries({ status: args.workflowStatus, runs: args.runs }),
      },
      {
        kind: "form",
        title: "Launch workflow run",
        fields: launchWorkflowParameters().fields,
        submit: launch,
      },
      {
        kind: "form",
        title: "Run/session parameters",
        fields: sessionLaunchParameters().fields,
        submit: action({
          surfaceId: "runs",
          actionId: "session.launch",
          scopeId,
          label: "Start session",
          effect: "write",
          operation: { kind: "daemon-route", method: "POST", path: "/sessions" },
          parameters: sessionLaunchParameters(),
          result: resultSpec("Session started."),
        }),
      },
      {
        kind: "form",
        title: "Model, effort, and launch defaults",
        fields: launchDefaultParameters().fields,
        submit: action({
          surfaceId: "runs",
          actionId: "launch.defaults.configure",
          scopeId,
          label: "Configure launch defaults",
          effect: "write",
          operation: { kind: "client-namespace", namespace: "config", method: "set" },
          parameters: launchDefaultParameters(),
          readiness: {
            state: "disabled",
            reason: "controller-unavailable",
            message: "The shared UI exposes preset/model/effort defaults; a multi-key config controller is not installed yet.",
          },
          result: resultSpec("Launch defaults updated."),
        }),
      },
      { kind: "action-list", title: "Run controls", actions },
    ],
    actions: uniqueActions(actions),
  };
}

function moduleRows(modules: SurfaceRead<ModulesListResult>): UiTableRow[] {
  if (!modules.ok) return unavailableRows(modules.message);
  if (modules.value.modules.length === 0) return emptyRows("Modules");
  return modules.value.modules.map((module) => ({
    id: module.name,
    cells: [
      { columnId: "name", value: module.name, role: module.status === "loaded" ? "success" : "error" },
      { columnId: "state", value: module.status, role: module.status === "loaded" ? "success" : "error" },
      {
        columnId: "detail",
        value: `${module.toolCount} tools, ${module.workflowCount} workflows, ${module.channelCount} channels, ${module.agentCount} agents`,
        role: "muted",
      },
    ],
  }));
}

function agentRows(agents: SurfaceRead<AgentsListResult>): UiTableRow[] {
  if (!agents.ok) return unavailableRows(agents.message);
  if (agents.value.agents.length === 0) return emptyRows("Agents");
  return agents.value.agents.map((agent) => ({
    id: agent.name,
    cells: [
      { columnId: "name", value: agent.name, role: "info" },
      { columnId: "state", value: agent.effort ?? "default", role: "muted" },
      { columnId: "detail", value: `${agent.source}  ${agent.model}  ${agent.role}`, role: "muted" },
    ],
  }));
}

function channelRows(modules: SurfaceRead<ModulesListResult>): UiTableRow[] {
  if (!modules.ok) return unavailableRows(modules.message);
  const rows: UiTableRow[] = modules.value.modules
    .filter((module) => module.channelCount > 0 || /notification|slack|telegram|email|push|channel|digest/.test(module.name))
    .map((module) => ({
      id: module.name,
      cells: [
        { columnId: "name", value: module.name, role: module.channelCount > 0 ? "success" : "muted" },
        { columnId: "state", value: `${module.channelCount} channel(s)`, role: module.channelCount > 0 ? "success" : "muted" },
        { columnId: "detail", value: module.description ?? "notification or digest capability module", role: "muted" },
      ],
    }));
  return rows.length > 0 ? rows : emptyRows("Channels, digest, and notifications");
}

export function buildModulesAgentsUiSurface(args: {
  status: StatusSnapshot;
  modules: SurfaceRead<ModulesListResult>;
  agents: SurfaceRead<AgentsListResult>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const actions = [
    action({
      surfaceId: "modules-agents",
      actionId: "modules.list",
      scopeId,
      label: "Reload modules",
      operation: { kind: "client-namespace", namespace: "modules", method: "list" },
      result: resultSpec("Modules loaded."),
    }),
    action({
      surfaceId: "modules-agents",
      actionId: "agents.list",
      scopeId,
      label: "Reload agents",
      operation: { kind: "client-namespace", namespace: "agents", method: "list" },
      result: resultSpec("Agents loaded."),
    }),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "modules-agents",
    extensionId: "core.modules-agents",
    title: "Modules and Agents",
    intent: "Work",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Work" },
    order: 40,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          { label: "Modules", value: readValue(args.modules, (modules) => `${modules.modules.length}`), role: readRole(args.modules) },
          { label: "Agents", value: readValue(args.agents, (agents) => `${agents.agents.length}`), role: readRole(args.agents) },
        ],
      },
      { kind: "table", title: "Loaded modules", columns: NAME_STATE_DETAIL_COLUMNS, rows: moduleRows(args.modules) },
      { kind: "table", title: "Agents", columns: NAME_STATE_DETAIL_COLUMNS, rows: agentRows(args.agents) },
      { kind: "table", title: "Channels, digest, and notifications", columns: NAME_STATE_DETAIL_COLUMNS, rows: channelRows(args.modules) },
      { kind: "action-list", title: "Module and agent actions", actions },
    ],
    actions,
  };
}

function setupRows(setup: SurfaceRead<ModuleSetupStatusResponse>): UiTableRow[] {
  if (!setup.ok) return unavailableRows(setup.message);
  if (setup.value.requirements.length === 0) return emptyRows("Setup requirements");
  return setup.value.requirements.map((requirement) => ({
    id: `${requirement.moduleName}-${requirement.requirementId}`,
    cells: [
      { columnId: "name", value: `${requirement.moduleName}/${requirement.requirementId}`, role: requirement.state === "ready" ? "success" : "warn" },
      { columnId: "state", value: `${requirement.kind} ${requirement.state}`, role: requirement.state === "ready" ? "success" : "warn" },
      { columnId: "detail", value: requirement.message, role: "muted" },
    ],
  }));
}

function setupActions(scopeId: string, setup: SurfaceRead<ModuleSetupStatusResponse>): UiAction[] {
  const refresh = action({
    surfaceId: "setup",
    actionId: "setup.list",
    scopeId,
    label: "Reload setup requirements",
    operation: { kind: "client-namespace", namespace: "setup", method: "list" },
    result: resultSpec("Setup requirements loaded."),
  });
  if (!setup.ok) return [refresh];
  return uniqueActions([
    refresh,
    ...setup.value.requirements.filter((requirement) => requirement.state !== "ready").map((requirement) =>
      action({
        surfaceId: "setup",
        actionId: `setup.${requirement.moduleName}.${requirement.requirementId}.start`,
        scopeId,
        label: `Start ${requirement.moduleName}/${requirement.requirementId}`,
        effect: requirement.setup.mode === "url" ? "external" : "write",
        operation: {
          kind: "daemon-route",
          method: "POST",
          path: `/setup/requirements/${requirement.moduleName}/${requirement.requirementId}/start`,
        },
        readiness: requirement.state === "missing" || requirement.state === "expired" || requirement.state === "revoked"
          ? { state: "needs-setup", moduleName: requirement.moduleName, requirementId: requirement.requirementId, message: requirement.message }
          : { state: "ready" },
        result: resultSpec("Setup action started."),
      })
    ),
  ]);
}

export function buildSetupUiSurface(args: {
  status: StatusSnapshot;
  setup: SurfaceRead<ModuleSetupStatusResponse>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const actions = setupActions(scopeId, args.setup);
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "setup",
    extensionId: "core.setup",
    title: "Setup",
    intent: "Setup",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Setup" },
    order: 50,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: args.setup.ok
          ? Object.entries(args.setup.value.summary).map(([label, value]) => ({
              label,
              value: `${value}`,
              role: value > 0 && label !== "ready" ? "warn" : "muted" as UiRole,
            }))
          : [{ label: "Setup", value: args.setup.message, role: "warn" }],
      },
      { kind: "table", title: "Setup and auth requirements", columns: NAME_STATE_DETAIL_COLUMNS, rows: setupRows(args.setup) },
      { kind: "action-list", title: "Setup actions", actions },
    ],
    actions,
  };
}

function memoryRows(memory: SurfaceRead<MemoryListResult>): UiTableRow[] {
  if (!memory.ok) return unavailableRows(memory.message);
  if (memory.value.entries.length === 0) return emptyRows("Memory");
  return memory.value.entries.slice(0, 10).map((entry) => ({
    id: entry.id,
    cells: [
      { columnId: "name", value: shortId(entry.id), role: "info" },
      { columnId: "state", value: entry.created, role: "muted" },
      { columnId: "detail", value: shortId(entry.content, 96), role: "muted" },
    ],
  }));
}

function knowledgeRows(knowledge: SurfaceRead<KnowledgeListResult>): UiTableRow[] {
  if (!knowledge.ok) return unavailableRows(knowledge.message);
  if (knowledge.value.entries.length === 0) return emptyRows("Knowledge");
  return knowledge.value.entries.slice(0, 10).map((entry) => ({
    id: entry.id,
    cells: [
      { columnId: "name", value: shortId(entry.id), role: "info" },
      { columnId: "state", value: entry.status ?? entry.type ?? "stored", role: "muted" },
      { columnId: "detail", value: entry.title, role: "muted" },
    ],
  }));
}

function historyRows(history: SurfaceRead<HistoryListResult>): UiTableRow[] {
  if (!history.ok) return unavailableRows(history.message);
  if (history.value.conversations.length === 0) return emptyRows("History");
  return history.value.conversations.slice(0, 10).map((conversation) => ({
    id: conversation.id,
    cells: [
      { columnId: "name", value: shortId(conversation.id), role: "info" },
      { columnId: "state", value: conversation.updatedAt ?? conversation.createdAt, role: "muted" },
      { columnId: "detail", value: conversation.title ?? conversation.cwd ?? "conversation", role: "muted" },
    ],
  }));
}

export function buildStoresUiSurface(args: {
  status: StatusSnapshot;
  memory: SurfaceRead<MemoryListResult>;
  knowledge: SurfaceRead<KnowledgeListResult>;
  history: SurfaceRead<HistoryListResult>;
}): UiSurface {
  const scopeId = scopeIdForStatus(args.status);
  const actions = [
    action({
      surfaceId: "stores",
      actionId: "memory.list",
      scopeId,
      label: "Reload memory",
      operation: { kind: "client-namespace", namespace: "memory", method: "list" },
      result: resultSpec("Memory loaded."),
    }),
    action({
      surfaceId: "stores",
      actionId: "knowledge.list",
      scopeId,
      label: "Reload knowledge",
      operation: { kind: "client-namespace", namespace: "knowledge", method: "list" },
      result: resultSpec("Knowledge loaded."),
    }),
    action({
      surfaceId: "stores",
      actionId: "history.list",
      scopeId,
      label: "Reload history",
      operation: { kind: "client-namespace", namespace: "history", method: "list" },
      result: resultSpec("History loaded."),
    }),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "stores",
    extensionId: "core.stores",
    title: "Stores",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 60,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          { label: "Memory", value: readValue(args.memory, (memory) => `${memory.entries.length}`), role: readRole(args.memory) },
          { label: "Knowledge", value: readValue(args.knowledge, (knowledge) => `${knowledge.entries.length}`), role: readRole(args.knowledge) },
          { label: "History", value: readValue(args.history, (history) => `${history.conversations.length}`), role: readRole(args.history) },
        ],
      },
      { kind: "table", title: "Memory", columns: NAME_STATE_DETAIL_COLUMNS, rows: memoryRows(args.memory) },
      { kind: "table", title: "Knowledge", columns: NAME_STATE_DETAIL_COLUMNS, rows: knowledgeRows(args.knowledge) },
      { kind: "table", title: "History", columns: NAME_STATE_DETAIL_COLUMNS, rows: historyRows(args.history) },
      { kind: "action-list", title: "Store actions", actions },
    ],
    actions,
  };
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
