/**
 * Recall module — owns the unified cross-store recall seam.
 *
 * - Builds a `RecallProviderImpl` and registers it as the `recall` provider.
 * - Wires the raw first-party stores (knowledge, memory, history, repo-tasks)
 *   as typed contributors. Other modules contribute their own sources from
 *   their own `onLoad` through the public `RecallProvider` `register` API —
 *   the `answer` module registers an `answer`-source contributor over the
 *   answer-history store this way.
 * - Exposes the seam through one daemon-control route (`POST /recall`),
 *   one `KotaClient.recall` namespace, and one `kota recall` CLI command.
 */

import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type {
  KotaModule,
  ModuleContext,
  ModuleRuntimeContext,
} from "#core/modules/module-types.js";
import {
  HISTORY_PROVIDER_TOKEN,
  KNOWLEDGE_PROVIDER_TOKEN,
  MEMORY_PROVIDER_TOKEN,
  REPO_TASKS_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import { createHistoryScopeStores } from "#modules/history/scope.js";
import { createKnowledgeScopeStores } from "#modules/knowledge/scope.js";
import { createMemoryScopeStores } from "#modules/memory/scope.js";
import { createRepoTasksScopeStores } from "#modules/repo-tasks/scope.js";
import { createRecallReadinessSource } from "./capability-readiness.js";
import { registerRecallCommand } from "./cli.js";
import type { RecallClient } from "./client.js";
import {
  createScopeHistoryContributor,
  createScopeKnowledgeContributor,
  createScopeMemoryContributor,
  createScopeTasksContributor,
} from "./contributors.js";
import { RecallProviderImpl } from "./recall-provider.js";
import { RECALL_PROVIDER_TOKEN, type RecallProvider } from "./recall-types.js";
import { recallApiRoutes, recallControlRoutes } from "./routes.js";
import { createRecallScopeContextResolver } from "./scope-context.js";
import {
  buildRecallDynamicStateProvider,
  RECALL_DYNAMIC_STATE_NAME,
} from "./system-prompt.js";
import { createRecallToolDef } from "./tool.js";
import { recallUiSurfaceSource } from "./ui-surface.js";

function resolveProvider(ctx: ModuleContext): RecallProvider {
  const provider = ctx.getProvider(RECALL_PROVIDER_TOKEN);
  if (!provider) {
    throw new Error(
      "Recall provider is not initialized. Ensure the recall module loaded.",
    );
  }
  return provider;
}

const recallModule: KotaModule = {
  name: "recall",
  version: "1.0.0",
  description:
    "Cross-store recall seam — one query returns ranked, source-tagged hits across registered contributors, including knowledge, memory, history, repo tasks, and answer history.",
  dependencies: ["knowledge", "memory", "history", "repo-tasks", "rendering"],
  uiSurfaces: [recallUiSurfaceSource],

  onLoad(ctx: ModuleRuntimeContext) {
    const resolveScopeContext = createRecallScopeContextResolver(ctx.cwd, ctx);
    const provider = new RecallProviderImpl({
      resolveScopeContext,
      onContributorError: (source, err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`recall: ${source} contributor failed — ${msg}`);
      },
    });
    provider.register(createScopeKnowledgeContributor(
      createKnowledgeScopeStores(ctx.cwd, () => {
        const value = ctx.getProvider(KNOWLEDGE_PROVIDER_TOKEN);
        if (!value) throw new Error("knowledge provider is not registered");
        return value;
      }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
    ));
    provider.register(createScopeMemoryContributor(
      createMemoryScopeStores(ctx.cwd, () => {
        const value = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
        if (!value) throw new Error("memory provider is not registered");
        return value;
      }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
    ));
    provider.register(createScopeHistoryContributor(
      createHistoryScopeStores(ctx.cwd, () => {
        const value = ctx.getProvider(HISTORY_PROVIDER_TOKEN);
        if (!value) throw new Error("history provider is not registered");
        return value;
      }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
    ));
    provider.register(createScopeTasksContributor(
      createRepoTasksScopeStores(ctx.cwd, () => {
        const value = ctx.getProvider(REPO_TASKS_PROVIDER_TOKEN);
        if (!value) throw new Error("repo-tasks provider is not registered");
        return value;
      }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)),
    ));
    // Expose the live provider through the provider-registry seam so other
    // modules can contribute their own `RecallContributor` from their own
    // `onLoad` (e.g. the `answer` module registers an `answer`-source
    // contributor over the answer-history store). This is the public
    // registration seam — there is no second mechanism.
    ctx.registerProvider(RECALL_PROVIDER_TOKEN, provider);
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

  tools: (ctx) => [createRecallToolDef(() => resolveProvider(ctx))],

  controlRoutes: (ctx) =>
    recallControlRoutes(() => resolveProvider(ctx)),

  routes: (ctx) =>
    recallApiRoutes(() => resolveProvider(ctx)),

  localClient: (ctx) => {
    const handler: RecallClient = {
      async recall(query, filter) {
        return resolveProvider(ctx).recall(query, filter);
      },
    };
    return { recall: handler };
  },
};

export default recallModule;
