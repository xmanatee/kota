/**
 * Commands module — owns the user-facing slash-command catalog.
 *
 * The catalog is derived from existing primitives: workflows tagged with
 * `COMMAND_WORKFLOW_TAG` and every skill contributed by a module. Clients
 * fetch the same catalog through the web server (`/api/commands`) and the
 * daemon control server (`/commands`). There is no per-command registration
 * surface — modules opt workflows in via the tag and contribute skills as
 * they already do.
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  catalogFromModuleContext,
  SLASH_COMMAND_PROVIDER_TYPE,
  type SlashCommandCatalog,
} from "./catalog.js";
import { commandRoutes } from "./routes.js";

export {
  buildSlashCommandCatalog,
  type CatalogDeps,
  COMMAND_WORKFLOW_TAG,
  catalogFromModuleContext,
  SKILL_COMMAND_PREFIX,
  SLASH_COMMAND_PROVIDER_TYPE,
  type SlashCommand,
  type SlashCommandAction,
  type SlashCommandCatalog,
  type SlashCommandSource,
} from "./catalog.js";

export { commandRoutes } from "./routes.js";

// The catalog instance is built once per module load and shared between the
// provider registry (consumed by the daemon control server) and the module's
// own web-server routes. This keeps one source of truth per load: both
// surfaces return the same data because they query the same callbacks over
// the same ModuleContext.
let sharedCatalog: SlashCommandCatalog | null = null;

function ensureCatalog(ctx: ModuleContext): SlashCommandCatalog {
  if (!sharedCatalog) sharedCatalog = catalogFromModuleContext(ctx);
  return sharedCatalog;
}

function registerProvider(ctx: ModuleContext, catalog: SlashCommandCatalog): void {
  const registry = getProviderRegistry();
  if (registry) {
    registry.register(SLASH_COMMAND_PROVIDER_TYPE, "commands", catalog);
  } else {
    ctx.log.debug(
      "commands: provider registry unavailable; daemon /commands routes will degrade to 503",
    );
  }
}

const commandsModule: KotaModule = {
  name: "commands",
  version: "1.0.0",
  description: "User-facing slash-command catalog backed by skills and workflows",

  onLoad(ctx) {
    sharedCatalog = null;
    const catalog = ensureCatalog(ctx);
    registerProvider(ctx, catalog);
  },

  routes(ctx) {
    return commandRoutes(ensureCatalog(ctx));
  },
};

export default commandsModule;
