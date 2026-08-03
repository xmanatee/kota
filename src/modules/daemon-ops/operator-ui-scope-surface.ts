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
import type { ProjectsListResult, SessionsListResult } from "./client.js";
import type {
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "./operator-ui-types.js";

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
  projects: SurfaceRead<ProjectsListResult>;
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
          action: setSessionAutonomy,
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
      ...sessionLinks,
      { kind: "action-list", title: "Scope actions", actions },
    ],
    actions,
  };
}
