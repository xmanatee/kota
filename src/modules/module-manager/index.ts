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
import { jsonResponse } from "#core/server/session-pool.js";
import { inspectModuleFromSummaries } from "./admin-operations.js";
import { buildModuleCommand } from "./cli-command.js";
import type {
  ModulesAdminClient,
  ModulesClient,
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
};

export default moduleManagerModule;
