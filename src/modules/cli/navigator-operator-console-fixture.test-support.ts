import type {
  UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";
import {
  consoleAction,
  operatorConsoleRunActions,
} from "./navigator-operator-console-fixture-actions.test-support.js";
import { inboxAndRunSurfaces } from "./navigator-operator-console-run-fixture.test-support.js";
import { navigationSurface } from "./navigator-test-surfaces.test-support.js";

function statusSurfaces(): UiSurfaceBundle["surfaces"] {
  return [
    navigationSurface({
      surfaceId: "status",
      title: "Status",
      intent: "Status",
      order: 10,
      actions: [
        consoleAction({ surfaceId: "status", actionId: "daemon.start", label: "Start daemon", namespace: "daemonOps", method: "start", effect: "write" }),
        consoleAction({ surfaceId: "status", actionId: "status.explain", label: "Explain status", namespace: "workflow", method: "status" }),
      ],
      nodes: [{
        kind: "status-summary",
        entries: [
          { label: "Daemon", value: "running (pid 4242)", role: "success" },
          { label: "Dispatch", value: "running", role: "success" },
          { label: "Runs", value: "1 active, 2 queued", role: "neutral" },
          { label: "Approvals", value: "1 pending", role: "warn" },
          { label: "Runtime source", value: "daemon control API", role: "success" },
        ],
      }],
    }),
    navigationSurface({
      surfaceId: "scopes",
      title: "Scopes",
      intent: "Status",
      order: 15,
      actions: [
        consoleAction({ surfaceId: "scopes", actionId: "projects.list", label: "Reload scope registry", namespace: "projects", method: "list" }),
      ],
      nodes: [{
        kind: "status-summary",
        entries: [
          { label: "Registry", value: "1 configured", role: "success" },
          { label: "Active", value: "scope-main", role: "success" },
          { label: "Sessions", value: "1 live", role: "success" },
        ],
      }],
    }),
  ];
}

function supportingSurfaces(): UiSurfaceBundle["surfaces"] {
  return [
    navigationSurface({
      surfaceId: "setup",
      title: "Setup",
      intent: "Setup",
      order: 50,
      actions: [
        consoleAction({ surfaceId: "setup", actionId: "setup.refresh", label: "Refresh setup", namespace: "setup", method: "list" }),
      ],
      nodes: [{
        kind: "status-summary",
        entries: [
          { label: "ready", value: "8", role: "muted" },
          { label: "missing", value: "1", role: "warn" },
          { label: "pending", value: "1", role: "warn" },
          { label: "unavailable", value: "0", role: "muted" },
        ],
      }],
    }),
    navigationSurface({
      surfaceId: "modules-agents",
      title: "Modules and Agents",
      intent: "Work",
      order: 60,
      actions: [
        consoleAction({ surfaceId: "modules-agents", actionId: "modules.list", label: "List modules", namespace: "modules", method: "list" }),
        consoleAction({ surfaceId: "modules-agents", actionId: "agents.list", label: "List agents", namespace: "agents", method: "list" }),
      ],
    }),
    navigationSurface({
      surfaceId: "stores",
      title: "Stores",
      intent: "Knowledge",
      order: 70,
      actions: [
        consoleAction({ surfaceId: "stores", actionId: "memory.list", label: "List memory", namespace: "memory", method: "list" }),
        consoleAction({ surfaceId: "stores", actionId: "knowledge.list", label: "List knowledge", namespace: "knowledge", method: "list" }),
      ],
    }),
  ];
}

export function operatorConsoleBundle(): UiSurfaceBundle {
  const actions = operatorConsoleRunActions();
  return {
    protocolVersion: "ui.surface.v1",
    surfaces: [
      ...statusSurfaces(),
      ...inboxAndRunSurfaces(actions),
      ...supportingSurfaces(),
    ],
  };
}
