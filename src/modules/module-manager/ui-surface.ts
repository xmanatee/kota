import type { UiSurface, UiTableRow } from "#core/daemon/ui-surface.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { AgentsListResult } from "#modules/agent-ops/client.js";
import type { ModulesListResult } from "#modules/module-manager/client.js";

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
  scopeId: string;
  modules: SurfaceRead<ModulesListResult>;
  agents: SurfaceRead<AgentsListResult>;
}): UiSurface {
  const { scopeId } = args;
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
    refreshEvents: ["daemon.config.reload", "scope.lifecycle.changed"],
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
