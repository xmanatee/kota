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
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  getHistoryProvider,
  getKnowledgeProvider,
  getMemoryProvider,
  getRepoTasksProvider,
} from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { createHistoryProjectStores } from "#modules/history/project-scope.js";
import { createKnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import { createMemoryProjectStores } from "#modules/memory/project-scope.js";
import { createRepoTasksProjectStores } from "#modules/repo-tasks/project-scope.js";
import { createRecallReadinessSource } from "./capability-readiness.js";
import { registerRecallCommand } from "./cli.js";
import type { RecallClient, RecallFilter, RecallResult } from "./client.js";
import {
  createProjectHistoryContributor,
  createProjectKnowledgeContributor,
  createProjectMemoryContributor,
  createProjectTasksContributor,
} from "./contributors.js";
import { createRecallProjectContextResolver } from "./project-context.js";
import { RecallProviderImpl } from "./recall-provider.js";
import { RECALL_PROVIDER_TOKEN, type RecallProvider } from "./recall-types.js";
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

/**
 * Daemon-side `RecallClient` backed by the typed `DaemonTransport`. Calls the
 * same `/recall` HTTP route the daemon registers through
 * `recallControlRoutes(resolveActiveProvider)`. The transport surface owns the
 * bearer token, base URL, and timeout policy — this factory only encodes the
 * wire shape.
 *
 * The JSON body matches the prior `recallHttp` byte-for-byte: `{ query }` when
 * no filter is supplied, `{ query, filter }` when one is. The spread pattern
 * keeps `filter: undefined` from leaking onto the wire.
 */
function buildRecallDaemonHandler(link: DaemonTransport): RecallClient {
  return {
    recall: async (query: string, filter?: RecallFilter): Promise<RecallResult> =>
      link.requestStrict<RecallResult>("POST", "/recall", {
        query,
        ...(filter && { filter }),
      }),
  };
}

const recallModule: KotaModule = {
  name: "recall",
  version: "1.0.0",
  description:
    "Cross-store recall seam — one query returns ranked, source-tagged hits across knowledge, memory, history, and the repo task queue.",
  dependencies: ["knowledge", "memory", "history", "repo-tasks", "rendering"],

  onLoad(ctx: ModuleRuntimeContext) {
    const resolveProjectContext = createRecallProjectContextResolver(ctx.cwd);
    const provider = new RecallProviderImpl({
      resolveProjectContext,
      onContributorError: (source, err) => {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`recall: ${source} contributor failed — ${msg}`);
      },
    });
    provider.register(createProjectKnowledgeContributor(
      createKnowledgeProjectStores(ctx.cwd, () => getKnowledgeProvider()),
    ));
    provider.register(createProjectMemoryContributor(
      createMemoryProjectStores(ctx.cwd, () => getMemoryProvider()),
    ));
    provider.register(createProjectHistoryContributor(
      createHistoryProjectStores(ctx.cwd, () => getHistoryProvider()),
    ));
    provider.register(createProjectTasksContributor(
      createRepoTasksProjectStores(ctx.cwd, () => getRepoTasksProvider()),
    ));
    activeProvider = provider;
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

  tools: () => [createRecallToolDef(resolveActiveProvider)],

  controlRoutes: (ctx) =>
    recallControlRoutes(
      resolveActiveProvider,
      createRecallProjectContextResolver(ctx.cwd),
    ),

  routes: (ctx) =>
    recallApiRoutes(
      resolveActiveProvider,
      createRecallProjectContextResolver(ctx.cwd),
    ),

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

  daemonClient: (link) => ({ recall: buildRecallDaemonHandler(link) }),

  onUnload() {
    activeProvider = null;
  },
};

export default recallModule;
