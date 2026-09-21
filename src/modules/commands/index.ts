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

import type { KotaModule } from "#core/modules/module-types.js";
import { WORKFLOW_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-dispatcher-provider.js";
import {
  catalogFromModuleContext,
  SLASH_COMMAND_PROVIDER_TYPE,
} from "./catalog.js";
import { commandsControlRoutes } from "./control-routes.js";
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

export { commandsControlRoutes } from "./control-routes.js";
export { commandRoutes } from "./routes.js";

const commandsModule: KotaModule = {
  name: "commands",
  version: "1.0.0",
  description: "User-facing slash-command catalog backed by skills and workflows",

  onLoad(ctx) {
    ctx.registerProvider(SLASH_COMMAND_PROVIDER_TYPE, catalogFromModuleContext(ctx));
  },

  routes(ctx) {
    return commandRoutes(() => ctx.getProvider(SLASH_COMMAND_PROVIDER_TYPE));
  },

  controlRoutes(ctx) {
    return commandsControlRoutes({
      getCatalog: () => ctx.getProvider(SLASH_COMMAND_PROVIDER_TYPE),
      getDispatcher: () => ctx.getProvider(WORKFLOW_DISPATCHER_PROVIDER_TYPE),
    });
  },
};

export default commandsModule;
