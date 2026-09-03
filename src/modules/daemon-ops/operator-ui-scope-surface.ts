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
      {
        id: "directoryRoot",
        label: "Daemon host folder",
        input: "path",
        required: true,
      },
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
          { label: "Selected paths", value: "paths" },
          { label: "Unrestricted", value: "unrestricted" },
        ],
      },
      {
        id: "writePaths",
        label: "Allowed paths (JSON array; used with Selected paths)",
        input: "multiline",
        required: false,
      },
    ],
    schema: {
      type: "object",
      required: ["directoryRoot", "initialAutomationMode", "writes"],
      properties: {
        directoryRoot: {
          type: "string",
          format: "path",
          description:
            "Absolute path on the daemon host. Browsers enter it explicitly; local native clients may use a folder picker.",
        },
        displayName: { type: "string" },
        trusted: { type: "boolean", default: false },
        initialAutomationMode: {
          type: "string",
          enum: ["passive", "supervised", "autonomous"],
          default: "passive",
        },
        writes: {
          type: "string",
          enum: ["none", "scope-directory", "paths", "unrestricted"],
          default: "none",
        },
        writePaths: {
          type: "array",
          description: "Required only when the write boundary is Selected paths.",
          items: { type: "string", format: "path" },
        },
      },
      additionalProperties: false,
    },
  };
}

function onboardingInspectParameters(): UiActionParameterSpec {
  return {
    fields: [{
      id: "directoryRoot",
      label: "Daemon host folder",
      input: "path",
      required: true,
    }],
    schema: {
      type: "object",
      required: ["directoryRoot"],
      properties: {
        directoryRoot: {
          type: "string",
          format: "path",
          description:
            "Inspection is read-only. The path must identify a folder visible to the daemon host.",
        },
      },
      additionalProperties: false,
    },
  };
}

function operationIdParameters(): UiActionParameterSpec {
  return {
    fields: [{ id: "operationId", label: "Operation id", input: "text", required: true }],
    schema: {
      type: "object",
      required: ["operationId"],
      properties: { operationId: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function lifecycleScopeParameters(): UiActionParameterSpec {
  return {
    fields: [{ id: "scopeId", label: "Scope id", input: "text", required: true }],
    schema: {
      type: "object",
      required: ["scopeId"],
      properties: { scopeId: { type: "string" } },
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
      actionId: "scope.select",
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
      actionId: "scope.onboarding.inspect",
      scopeId,
      label: "Inspect folder",
      operation: {
        kind: "client-namespace",
        namespace: "scopes",
        method: "inspectOnboarding",
      },
      parameters: onboardingInspectParameters(),
      result: resultSpec("Folder inspection loaded."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.onboarding.configure",
      scopeId,
      label: "Configure Add Scope plan",
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
      actionId: "scope.onboarding.apply",
      scopeId,
      label: "Add scope",
      effect: "write",
      operation: {
        kind: "client-namespace",
        namespace: "scopes",
        method: "addOnboarding",
      },
      parameters: scopeOnboardingPlanParameters(),
      confirmation: {
        mode: "required",
        title: "Apply Add Scope",
        detail:
          "KOTA will apply the displayed trust, automation, and write choices. Elevated trust or writes are never inferred.",
        confirmLabel: "Add scope",
        risk: "high",
      },
      result: resultSpec("Scope onboarding operation applied."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.onboarding.status",
      scopeId,
      label: "Check add operation",
      operation: {
        kind: "client-namespace",
        namespace: "scopes",
        method: "getOnboardingStatus",
      },
      parameters: operationIdParameters(),
      result: resultSpec("Scope onboarding operation loaded."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.onboarding.retry",
      scopeId,
      label: "Retry add operation",
      effect: "write",
      operation: {
        kind: "client-namespace",
        namespace: "scopes",
        method: "retryOnboarding",
      },
      parameters: operationIdParameters(),
      confirmation: {
        mode: "required",
        title: "Retry Add Scope",
        detail: "Retry the durable operation from its last safe checkpoint.",
        confirmLabel: "Retry operation",
        risk: "medium",
      },
      result: resultSpec("Scope onboarding operation retried."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.onboarding.cancel",
      scopeId,
      label: "Cancel add operation",
      effect: "write",
      operation: {
        kind: "client-namespace",
        namespace: "scopes",
        method: "cancelOnboarding",
      },
      parameters: operationIdParameters(),
      confirmation: {
        mode: "required",
        title: "Cancel Add Scope",
        detail: "Roll back changes owned by this incomplete onboarding operation.",
        confirmLabel: "Cancel operation",
        risk: "medium",
      },
      result: resultSpec("Scope onboarding operation cancelled."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.drain",
      scopeId,
      label: "Drain scope",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "scopes", method: "drain" },
      parameters: lifecycleScopeParameters(),
      confirmation: {
        mode: "required",
        title: "Drain scope",
        detail: "Stop accepting work and report any live resources that block safe removal.",
        confirmLabel: "Drain scope",
        risk: "medium",
      },
      result: resultSpec("Scope drained."),
    }),
    action({
      surfaceId: "scopes",
      actionId: "scope.remove",
      scopeId,
      label: "Remove scope",
      effect: "write",
      operation: { kind: "client-namespace", namespace: "scopes", method: "remove" },
      parameters: lifecycleScopeParameters(),
      confirmation: {
        mode: "required",
        title: "Stop hosting scope",
        detail:
          "The scope must already be drained. This removes it from KOTA and never deletes the folder.",
        confirmLabel: "Remove from KOTA",
        risk: "high",
      },
      result: resultSpec("Scope removed from KOTA without deleting its folder."),
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
      {
        kind: "detail",
        title: "Add Scope",
        body:
          "Inspect first, configure untrusted/passive/no-write defaults, then apply. Save the operation id to reconnect, check readiness, retry, or cancel.",
      },
      { kind: "table", title: "Live sessions", columns: NAME_STATE_DETAIL_COLUMNS, rows: sessionRows },
      ...sessionLinks,
      { kind: "action-list", title: "Scope actions", actions },
    ],
    actions,
  };
}
