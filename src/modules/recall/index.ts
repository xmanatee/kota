/**
 * Recall module — owns the unified cross-store recall seam.
 *
 * - Builds a `RecallProviderImpl` and registers it as the `recall` provider.
 * - Wires the four raw first-party stores (knowledge, memory, history,
 *   repo-tasks) as typed contributors. Other modules contribute their own
 *   sources from their own `onLoad` through the public `RecallProvider`
 *   `register` API — the `answer` module registers an `answer`-source
 *   contributor over the answer-history store this way.
 * - Exposes the seam through one daemon-control route (`POST /recall`),
 *   one `KotaClient.recall` namespace, and one `kota recall` CLI command.
 */

import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  getHistoryProvider,
  getKnowledgeProvider,
  getMemoryProvider,
  getRepoTasksProvider,
} from "#core/modules/provider-registry.js";
import type { RecallClient } from "#core/server/kota-client.js";
import { createRecallReadinessSource } from "./capability-readiness.js";
import { registerRecallCommand } from "./cli.js";
import {
  createHistoryContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";
import { RecallProviderImpl } from "./recall-provider.js";
import type { RecallProvider } from "./recall-types.js";
import { recallApiRoutes, recallControlRoutes } from "./routes.js";
import {
  buildRecallDynamicStateProvider,
  RECALL_DYNAMIC_STATE_NAME,
} from "./system-prompt.js";
import { createRecallToolDef } from "./tool.js";

let activeProvider: RecallProvider | null = null;

function resolveActiveProvider(): RecallProvider {
  if (!activeProvider) {
    throw new Error(
      "Recall provider is not initialized. Ensure the recall module loaded.",
    );
  }
  return activeProvider;
}

const recallModule: KotaModule = {
  name: "recall",
  version: "1.0.0",
  description:
    "Cross-store recall seam — one query returns ranked, source-tagged hits across knowledge, memory, history, and the repo task queue.",
  dependencies: ["knowledge", "memory", "history", "repo-tasks", "rendering"],

  onLoad(ctx: ModuleContext) {
    const provider = new RecallProviderImpl({
      onContributorError: (source, err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`recall: ${source} contributor failed — ${msg}`);
      },
    });
    provider.register(createKnowledgeContributor(getKnowledgeProvider()));
    provider.register(createMemoryContributor(getMemoryProvider()));
    provider.register(createHistoryContributor(getHistoryProvider()));
    provider.register(createTasksContributor(getRepoTasksProvider()));
    activeProvider = provider;
    // Expose the live provider through the provider-registry seam so other
    // modules can contribute their own `RecallContributor` from their own
    // `onLoad` (e.g. the `answer` module registers an `answer`-source
    // contributor over the answer-history store). This is the public
    // registration seam — there is no second mechanism.
    ctx.registerProvider("recall", provider);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createRecallReadinessSource(provider),
    );
    ctx.registerDynamicStateProvider(
      RECALL_DYNAMIC_STATE_NAME,
      buildRecallDynamicStateProvider(),
    );
    ctx.log.info(
      `recall: registered ${provider.contributors().length} contributor(s)`,
    );
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerRecallCommand(root, ctx);
    return root.commands as Command[];
  },

  tools: () => [createRecallToolDef(resolveActiveProvider)],

  controlRoutes: () => recallControlRoutes(resolveActiveProvider),

  routes: () => recallApiRoutes(resolveActiveProvider),

  localClient: () => {
    const handler: RecallClient = {
      async recall(query, filter) {
        const provider = resolveActiveProvider();
        if (provider.contributors().length === 0) {
          return { ok: false, reason: "semantic_unavailable" };
        }
        const hits = await provider.recall(query, filter);
        return { ok: true, hits };
      },
    };
    return { recall: handler };
  },

  onUnload() {
    activeProvider = null;
  },
};

export default recallModule;
