/**
 * Recall module — owns the unified cross-store recall seam.
 *
 * - Builds a `RecallProviderImpl` and registers it as the `recall` provider.
 * - Wires each first-party store (knowledge, memory, history, repo-tasks)
 *   as a typed contributor; adding a fifth store later means registering a
 *   fifth contributor here, not editing every consumer.
 * - Exposes the seam through one daemon-control route (`POST /recall`),
 *   one `KotaClient.recall` namespace, and one `kota recall` CLI command.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  getHistoryProvider,
  getKnowledgeProvider,
  getMemoryProvider,
  getRepoTasksProvider,
} from "#core/modules/provider-registry.js";
import type { RecallClient } from "#core/server/kota-client.js";
import { registerRecallCommand } from "./cli.js";
import {
  createHistoryContributor,
  createKnowledgeContributor,
  createMemoryContributor,
  createTasksContributor,
} from "./contributors.js";
import { RecallProviderImpl } from "./recall-provider.js";
import type { RecallProvider } from "./recall-types.js";
import { recallControlRoutes } from "./routes.js";

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
    ctx.registerProvider("recall", provider);
    ctx.log.info(
      `recall: registered ${provider.contributors().length} contributor(s)`,
    );
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerRecallCommand(root, ctx);
    return root.commands as Command[];
  },

  controlRoutes: () => recallControlRoutes(resolveActiveProvider),

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
