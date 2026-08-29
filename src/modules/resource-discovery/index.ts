import { Command } from "commander";
import type {
  KotaModule,
  ModuleContext,
  ModuleRuntimeContext,
} from "#core/modules/module-types.js";
import { registerResourceDiscoveryCommand } from "./cli.js";
import type {
  ResourceDiscoveryClient,
  ResourceDiscoveryProvider,
} from "./client.js";
import { RESOURCE_DISCOVERY_PROVIDER_TOKEN } from "./client.js";
import { ResourceDiscoveryProviderImpl } from "./provider.js";
import {
  resourceDiscoveryApiRoutes,
  resourceDiscoveryControlRoutes,
} from "./routes.js";
import { buildResourceDiscoverySnapshotReader } from "./snapshot.js";
import { createResourceDiscoveryToolDef } from "./tool.js";

let activeProvider: ResourceDiscoveryProvider | null = null;

function createProvider(ctx: ModuleContext): ResourceDiscoveryProvider {
  return new ResourceDiscoveryProviderImpl(
    buildResourceDiscoverySnapshotReader(ctx),
  );
}

function resolveActiveProvider(): ResourceDiscoveryProvider {
  if (!activeProvider) {
    throw new Error(
      "Resource discovery provider is not initialized. Ensure the resource-discovery module loaded.",
    );
  }
  return activeProvider;
}

const resourceDiscoveryModule: KotaModule = {
  name: "resource-discovery",
  version: "1.0.0",
  description:
    "Ranks existing KOTA capability metadata for a natural-language task without maintaining a second resource catalog.",
  dependencies: ["knowledge", "recall", "rendering", "skill-ops"],

  onLoad(ctx: ModuleRuntimeContext) {
    const provider = createProvider(ctx);
    activeProvider = provider;
    ctx.registerProvider(RESOURCE_DISCOVERY_PROVIDER_TOKEN, provider);
    return {
      dispose: () => {
        if (activeProvider === provider) activeProvider = null;
      },
    };
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerResourceDiscoveryCommand(root, ctx, createProvider(ctx));
    return root.commands as Command[];
  },

  tools: () => [createResourceDiscoveryToolDef(resolveActiveProvider)],

  controlRoutes: () => resourceDiscoveryControlRoutes(resolveActiveProvider),

  routes: () => resourceDiscoveryApiRoutes(resolveActiveProvider),

  localClient: () => ({
    resourceDiscovery: {
      discover: (query, filter) =>
        resolveActiveProvider().discover(query, filter),
    } satisfies ResourceDiscoveryClient,
  }),
};

export default resourceDiscoveryModule;
