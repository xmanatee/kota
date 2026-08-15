import type { KotaModule } from "#core/modules/module-types.js";
import { resolveScopeSelectorFromUrl } from "#core/server/scope-selector.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { DaemonOpsClient } from "./client.js";
import { buildDaemonCommands } from "./daemon-cli.js";
import {
  buildDaemonOpsDaemonHandler,
  buildSessionsDaemonHandler,
} from "./daemon-client-handlers.js";
import {
  localDaemonPid,
  localDaemonReload,
  localDaemonStatus,
  localDaemonStop,
} from "./daemon-ops-operations.js";
import { buildProjectsDaemonHandler } from "./projects-daemon.js";
import { projectsLocalClient } from "./projects-local.js";
import { sessionsLocalClient } from "./sessions-local.js";
import { parseUiActionRequest } from "./ui-action-request.js";
import {
  buildLocalUiClient,
  buildSharedUiSurfaceBundle,
  buildUiDaemonHandler,
} from "./ui-clients.js";
import { daemonOpsUiSurfaceSources } from "./ui-sources.js";

const daemonModule: KotaModule = {
  name: "daemon-ops",
  version: "1.0.0",
  description: "Operator CLI and supervisor surface for the KOTA daemon runtime",
  dependencies: ["git", "repo-tasks", "rendering"],
  uiSurfaces: daemonOpsUiSurfaceSources,
  controlRoutes: (ctx) => [
    {
      method: "GET",
      path: "/ui/surfaces",
      capabilityScope: "read",
      handler: async (req, res) => {
        const resolved = resolveScopeSelectorFromUrl(
          new URL(req.url ?? "/ui/surfaces", "http://localhost"),
        );
        if (!resolved.ok) {
          jsonResponse(res, resolved.status, resolved.body);
          return;
        }
        jsonResponse(res, 200, await buildSharedUiSurfaceBundle(ctx, resolved.selector));
      },
    },
    {
      method: "POST",
      path: "/ui/actions/execute",
      capabilityScope: "control",
      handler: async (req, res) => {
        const parsed = await parseUiActionRequest(req);
        if (!parsed.ok) {
          jsonResponse(res, 400, { error: parsed.message });
          return;
        }
        jsonResponse(res, 200, await buildLocalUiClient(ctx).executeAction(parsed.input));
      },
    },
  ],
  commands: buildDaemonCommands,
  localClient: (ctx) => {
    const daemonOps: DaemonOpsClient = {
      status: async () => localDaemonStatus(),
      pid: async () => localDaemonPid(),
      stop: async (options) => localDaemonStop(options),
      reload: async () => localDaemonReload(),
    };
    return {
      sessions: sessionsLocalClient(),
      daemonOps,
      projects: projectsLocalClient(),
      ui: buildLocalUiClient(ctx),
    };
  },
  daemonClient: (link) => ({
    sessions: buildSessionsDaemonHandler(link),
    daemonOps: buildDaemonOpsDaemonHandler(link),
    projects: buildProjectsDaemonHandler(link),
    ui: buildUiDaemonHandler(link),
  }),
};

export default daemonModule;
export {
  buildDaemonStatusNode,
  formatDaemonStatus,
} from "./daemon-status-renderer.js";
export type {
  ContinuityProjection,
  ContinuityProjectionInput,
  ContinuityState,
  UiAction,
  UiActionEffect,
  UiActionExecutionResult,
  UiClientNamespaceExecutor,
  UiConfirmation,
  UiIntent,
  UiListItem,
  UiNode,
  UiRole,
  UiRouteExecutor,
  UiStatusEntry,
  UiSurface,
  UiSurfaceBundle,
} from "./operator-ui.js";
export {
  buildContinuityProjection,
  buildContinuityUiSurface,
  buildInboxUiSurface,
  buildOperatorControlUiSurface,
  buildScopeUiSurface,
  buildStatusUiSurface,
  CONTINUITY_COMPOSED_STORES,
  executeUiAction,
  renderUiSurface,
} from "./operator-ui.js";
export {
  buildLaunchdPlist,
  buildSystemdUnit,
  getLaunchdPlistPath,
  getSystemdServicePath,
  isServiceInstalled,
  removeServiceFile,
  writeServiceFile,
} from "./service-install.js";
