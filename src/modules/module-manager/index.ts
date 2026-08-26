import {
  CAPABILITY_READINESS_PROVIDER_TYPE,
  probeCapabilityReadinessSources,
} from "#core/daemon/capability-readiness.js";
import {
  listModuleSetupStatusesFromSummaries,
  moduleSummariesWithSetupAvailability,
} from "#core/modules/module-setup-status.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { ModuleSetupCapabilityStatus } from "#core/modules/setup-requirements.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { inspectModuleFromSummaries } from "./admin-operations.js";
import { buildModuleCommand } from "./cli-command.js";
import type {
  ModuleInspectResult,
  ModuleReloadResult,
  ModulesAdminClient,
  ModulesClient,
  ModulesListResult,
} from "./client.js";
import { buildModuleListEntries, handleListModules } from "./routes.js";
import { modulesAgentsUiSurfaceSource } from "./ui-source.js";

export { buildModuleListNode } from "./cli-command.js";

async function probeSetupCapabilities(
  ctx: ModuleContext,
): Promise<readonly ModuleSetupCapabilityStatus[]> {
  const active = ctx.getProvider(CAPABILITY_READINESS_PROVIDER_TYPE);
  const sources = ctx.listProviders?.(CAPABILITY_READINESS_PROVIDER_TYPE)
    ?? (active ? [active] : []);
  const response = await probeCapabilityReadinessSources(
    sources,
  );
  return response.capabilities;
}

async function moduleSummariesWithCurrentSetupAvailability(
  ctx: ModuleContext,
) {
  const summaries = ctx.getModuleSummaries();
  const statuses = await listModuleSetupStatusesFromSummaries({
    scopeRoot: ctx.cwd,
    getModuleSummaries: () => summaries,
    probeCapabilities: () => probeSetupCapabilities(ctx),
  });
  return moduleSummariesWithSetupAvailability(summaries, statuses.requirements);
}

const moduleManagerModule: KotaModule = {
  name: "module-manager",
  version: "1.0.0",
  description: "Inspect and scaffold KOTA modules",
  dependencies: ["rendering"],
  uiSurfaces: [modulesAgentsUiSurfaceSource],

  commands: (ctx: ModuleContext) => [buildModuleCommand(ctx)],

  routes: (ctx) => [
    {
      method: "GET",
      path: "/api/modules",
      handler: async (_req, res) =>
        handleListModules(res, await moduleSummariesWithCurrentSetupAvailability(ctx)),
    },
  ],

  controlRoutes: (ctx) => [
    {
      method: "GET",
      path: "/modules",
      capabilityScope: "read",
      handler: async (_req, res) => {
        jsonResponse(res, 200, {
          modules: buildModuleListEntries(
            await moduleSummariesWithCurrentSetupAvailability(ctx),
          ),
        });
      },
    },
    {
      method: "GET",
      path: "/modules/:name",
      capabilityScope: "read",
      handler: async (_req, res, params) => {
        jsonResponse(
          res,
          200,
          inspectModuleFromSummaries(
            await moduleSummariesWithCurrentSetupAvailability(ctx),
            params.name,
          ),
        );
      },
    },
  ],

  localClient: (ctx) => {
    const modules: ModulesClient = {
      async list() {
        return {
          modules: buildModuleListEntries(
            await moduleSummariesWithCurrentSetupAvailability(ctx),
          ),
        };
      },
    };
    const modulesAdmin: ModulesAdminClient = {
      async inspect(name) {
        return inspectModuleFromSummaries(
          await moduleSummariesWithCurrentSetupAvailability(ctx),
          name,
        );
      },
      async reload(_name) {
        return { ok: false, reason: "daemon_required" };
      },
    };
    return { modules, modulesAdmin };
  },

  daemonClient: (link: DaemonTransport) => ({
    modules: buildModulesDaemonHandler(link),
    modulesAdmin: buildModulesAdminDaemonHandler(link),
  }),
};

/**
 * Daemon-side `ModulesClient` backed by the typed `DaemonTransport`. Calls
 * the same `GET /modules` control route the daemon registers through
 * `controlRoutes`. The transport surface owns the bearer token, base URL,
 * and timeout policy — this factory only encodes the wire shape.
 */
function buildModulesDaemonHandler(link: DaemonTransport): ModulesClient {
  return {
    list: async (): Promise<ModulesListResult> =>
      link.requestStrict<ModulesListResult>("GET", "/modules"),
  };
}

/**
 * Daemon-side `ModulesAdminClient` backed by the typed `DaemonTransport`.
 *
 * `inspect` issues a single strict `GET /modules/{name}` and decodes the
 * canonical `ModuleInspectResult` envelope the daemon route emits — both
 * the `{ found: true; module }` and `{ found: false }` variants ride the
 * same 200 status, matching every other migrated namespace's strict-
 * transport posture.
 *
 * `reload` composes the strict `POST /reload` config-reload call with
 * the same `GET /modules` wire shape the `modules.list` namespace already
 * consumes; the existence check is reused via `buildModulesDaemonHandler`
 * so the cross-namespace dependency stays inside this module. The
 * `daemon_required` variant is unreachable from the daemon-side factory
 * by construction (the daemon is the thing servicing the call); the
 * local-side handler still surfaces it.
 */
function buildModulesAdminDaemonHandler(
  link: DaemonTransport,
): ModulesAdminClient {
  const modules = buildModulesDaemonHandler(link);
  return {
    inspect: async (name) =>
      link.requestStrict<ModuleInspectResult>(
        "GET",
        `/modules/${encodeURIComponent(name)}`,
      ),
    reload: async (name): Promise<ModuleReloadResult> => {
      const result = await link.requestStrict<{
        ok: boolean;
        workflows: number;
        changedModules: string[];
      }>("POST", "/reload");
      const list = await modules.list();
      if (!list.modules.some((m) => m.name === name)) {
        return { ok: false, reason: "not_found" };
      }
      return {
        ok: true,
        reloaded: result.changedModules.includes(name),
        workflowsActive: result.workflows,
      };
    },
  };
}

export default moduleManagerModule;
