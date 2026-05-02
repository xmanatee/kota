/**
 * Retract module — owns the unified cross-store retract seam, the
 * symmetric counterpart to capture.
 *
 * - Builds a `RetractProviderImpl` and registers it as the `retract`
 *   provider.
 * - Wires each first-party store (memory, knowledge, tasks, inbox)
 *   as a typed contributor; adding a fifth store later means registering
 *   a fifth contributor here, not editing every consumer.
 * - Exposes the seam through one daemon-control route (`POST /retract`),
 *   one user-facing HTTP route (`POST /api/retract`), one
 *   `KotaClient.retract` namespace, one `kota retract` CLI command, and
 *   one agent-callable `retract` tool with a `dangerous` risk
 *   classification.
 * - Registers a per-turn dynamic system-prompt contributor that emits a
 *   short conversational-pattern block when the session admits the
 *   `retract` tool, and the empty string otherwise.
 */

import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  getKnowledgeProvider,
  getMemoryProvider,
} from "#core/modules/provider-registry.js";
import type { RetractClient } from "#core/server/kota-client.js";
import { createRetractReadinessSource } from "./capability-readiness.js";
import { registerRetractCommand } from "./cli.js";
import {
  createInboxContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";
import { RetractProviderImpl } from "./retract-provider.js";
import {
  RETRACT_PROVIDER_TOKEN,
  type RetractProvider,
} from "./retract-types.js";
import { retractApiRoutes, retractControlRoutes } from "./routes.js";
import {
  buildRetractDynamicStateProvider,
  RETRACT_DYNAMIC_STATE_NAME,
} from "./system-prompt.js";
import { createRetractToolDef } from "./tool.js";

let activeProvider: RetractProvider | null = null;

function resolveActiveProvider(): RetractProvider {
  if (!activeProvider) {
    throw new Error(
      "Retract provider is not initialized. Ensure the retract module loaded.",
    );
  }
  return activeProvider;
}

const retractModule: KotaModule = {
  name: "retract",
  version: "1.0.0",
  description:
    "Cross-store retract seam — typed removal of one prior capture from memory, knowledge, tasks, or inbox through the same contributor pattern capture uses.",
  dependencies: ["memory", "knowledge", "repo-tasks", "rendering"],

  onLoad(ctx: ModuleRuntimeContext) {
    const provider = new RetractProviderImpl();
    provider.register(createMemoryContributor(getMemoryProvider()));
    provider.register(createKnowledgeContributor(getKnowledgeProvider()));
    provider.register(createTasksContributor(ctx.cwd));
    provider.register(createInboxContributor(ctx.cwd));
    activeProvider = provider;
    ctx.registerProvider(RETRACT_PROVIDER_TOKEN, provider);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createRetractReadinessSource(provider),
    );
    ctx.registerDynamicStateProvider(
      RETRACT_DYNAMIC_STATE_NAME,
      buildRetractDynamicStateProvider(),
    );
    ctx.log.info(
      `retract: registered ${provider.contributors().length} contributor(s)`,
    );
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerRetractCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: () => [createRetractToolDef(resolveActiveProvider)],

  controlRoutes: () => retractControlRoutes(resolveActiveProvider),

  routes: () => retractApiRoutes(resolveActiveProvider),

  localClient: () => {
    const handler: RetractClient = {
      async retract(request) {
        return resolveActiveProvider().retract(request);
      },
    };
    return { retract: handler };
  },

  onUnload() {
    activeProvider = null;
  },
};

export default retractModule;
