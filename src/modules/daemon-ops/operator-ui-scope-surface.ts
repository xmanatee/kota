import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  shortId,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { ScopesListResult, SessionsListResult } from "./client.js";
import type {
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "./operator-ui-types.js";

function scopeUseParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "scopeId",
        label: "Scope id",
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
        scopeId: { type: "string" },
        clear: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  };
}

function scopeOnboardingPlanParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "directoryRoot", label: "Folder", input: "text", required: true },
      { id: "displayName", label: "Display name", input: "text", required: false },
      { id: "trusted", label: "Trust this scope", input: "boolean", required: false },
      {
        id: "initialAutomationMode",
        label: "Initial automation",
        input: "select",
        required: true,
        options: [
          { label: "Passive", value: "passive" },
          { label: "Supervised", value: "supervised" },
          { label: "Autonomous", value: "autonomous" },
        ],
      },
      {
        id: "writes",
        label: "Write boundary",
        input: "select",
        required: true,
        options: [
          { label: "No writes", value: "none" },
          { label: "Scope folder", value: "scope-directory" },
          { label: "Unrestricted", value: "unrestricted" },
        ],
      },
    ],
    schema: {
      type: "object",
      required: ["directoryRoot", "initialAutomationMode", "writes"],
      properties: {
        directoryRoot: { type: "string" },
        displayName: { type: "string" },
        trusted: { type: "boolean", default: false },
        initialAutomationMode: {
          type: "string",
          enum: ["passive", "supervised", "autonomous"],
          default: "passive",
        },
        writes: {
          type: "string",
          enum: ["none", "scope-directory", "unrestricted"],
          default: "none",
        },
      },
      additionalProperties: false,
    },
  };
}

function sessionAutonomyParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "sessionId", label: "Session id", input: "text", required: true },
      {
        id: "autonomyMode",
        label: "Autonomy mode",
        input: "select",
        required: true,
        options: [
          { label: "Passive", value: "passive" },
          { label: "Supervised", value: "supervised" },
          { label: "Autonomous", value: "autonomous" },
        ],
      },
    ],
    schema: {
      type: "object",
      required: ["sessionId", "autonomyMode"],
      properties: {
        sessionId: { type: "string" },
        autonomyMode: {
          type: "string",
          enum: ["passive", "supervised", "autonomous"],
          default: "supervised",
        },
      },
      additionalProperties: false,
    },
  };
}

export function buildScopeUiSurface(args: {
  scopeId: string;
  scopes: SurfaceRead<ScopesListResult>;
  sessions: SurfaceRead<SessionsListResult>;
}): UiSurface {
  const { scopeId } = args;
  const setSessionAutonomy = action({
    surfaceId: "scopes",
    actionId: "session.autonomy.set",
    scopeId,
    label: "Change autonomy mode",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "sessions", method: "setAutonomyMode" },
    parameters: sessionAutonomyParameters(),
    confirmation: {
      mode: "required",
      title: "Change session autonomy",
      detail: "This changes how future tool calls in the selected live session are supervised.",
      confirmLabel: "Change autonomy",
      risk: "medium",
    },
    result: resultSpec("Session autonomy updated."),
  });
  const scopeRows: UiTableRow[] = args.scopes.ok
    ? args.scopes.value.ok
      ? (() => {
          const scopesView = args.scopes.value;
          return scopesView.scopes.map((scope) => {
            const markers: string[] = [];
            if (scope.scopeId === scopesView.activeScopeId) markers.push("active");
            if (scope.scopeId === scopesView.defaultScopeId) markers.push("default");
            return {
              id: scope.scopeId,
              cells: [
                { columnId: "name", value: scope.scopeId, role: markers.includes("active") ? "info" : "neutral" },
                { columnId: "state", value: markers.length > 0 ? markers.join(", ") : "available", role: markers.includes("active") ? "success" : "muted" },
                { columnId: "detail", value: `${scope.displayName}  ${scope.scopeRoot}`, role: "muted" },
              ],
            };
          });
        })()
      : unavailableRows("daemon required")
    : unavailableRows(args.scopes.message);

  const sessionRows: UiTableRow[] = args.sessions.ok
    ? args.sessions.value.sessions.length === 0
      ? emptyRows("Live sessions")
        : args.sessions.value.sessions.map((session) => ({
          id: session.id,
          cells: [
            { columnId: "name", value: shortId(session.id), role: "info" },
            { columnId: "state", value: session.autonomyMode, role: "success" },
            { columnId: "detail", value: `${session.scopeId}  ${session.source ?? "daemon"}  last=${new Date(session.lastActive).toISOString()}`, role: "muted" },
          ],
          action: setSessionAutonomy,
        }))
    : unavailableRows(args.sessions.message);

  const actions = [
    action({
      surfaceId: "scopes",
      actionId: "scopes.list",
      scopeId,
      label: "Reload scope registry",
      operation: { kind: "client-namespace", namespace: "scopes", method: "list" },
      result: resultSpec("Scope registry loaded."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.use",
      scopeId,
      label: "Switch active scope",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "scopes", method: "use" },
      parameters: scopeUseParameters(),
      confirmation: {
        mode: "required",
        title: "Switch active scope",
        detail: "Subsequent daemon reads without an explicit scope override use this selection.",
        confirmLabel: "Switch scope",
        risk: "low",
      },
      result: resultSpec("Active scope updated."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.onboarding.plan",
      scopeId,
      label: "Preview external folder onboarding",
      operation: {
        kind: "client-namespace",
        namespace: "scopes",
        method: "planOnboarding",
      },
      parameters: scopeOnboardingPlanParameters(),
      result: resultSpec("Scope onboarding plan prepared."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "sessions.list",
      scopeId,
      label: "List live sessions",
      operation: { kind: "client-namespace", namespace: "sessions", method: "list" },
      result: resultSpec("Live sessions loaded."),
    }),
    setSessionAutonomy,
  ];

  const sessionLinks: UiSurface["nodes"] = args.sessions.ok
    ? args.sessions.value.sessions.map((session) => ({
        kind: "link" as const,
        label: `Resume session ${shortId(session.id)}`,
        target: { kind: "session" as const, sessionId: session.id },
        role: "info" as const,
      }))
    : [];

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "scopes",
    extensionId: "core.scopes",
    title: "Scopes",
    intent: "Status",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Status" },
    order: 15,
    refreshEvents: [
      "scope.lifecycle.changed",
      "session.registered",
      "session.unregistered",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "status-summary",
        entries: [
          {
            label: "Registry",
            value: readValue(args.scopes, (scopes) => scopes.ok ? `${scopes.scopes.length} configured` : "daemon required"),
            role: readRole(args.scopes),
          },
          {
            label: "Active",
            value: readValue(args.scopes, (scopes) => scopes.ok ? scopes.activeScopeId ?? scopes.defaultScopeId : "unavailable"),
            role: readRole(args.scopes),
          },
          {
            label: "Sessions",
            value: readValue(args.sessions, (sessions) => `${sessions.sessions.length} live`),
            role: readRole(args.sessions),
          },
        ],
      },
      { kind: "table", title: "Directory scopes", columns: NAME_STATE_DETAIL_COLUMNS, rows: scopeRows },
      { kind: "table", title: "Live sessions", columns: NAME_STATE_DETAIL_COLUMNS, rows: sessionRows },
      ...sessionLinks,
      { kind: "action-list", title: "Scope actions", actions },
    ],
    actions,
  };
}
