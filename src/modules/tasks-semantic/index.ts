/**
 * Tasks-semantic module — registers a `RepoTasksProvider` variant that
 * augments the repo task queue with embedding-backed semantic search.
 * Activated by setting `providers.repo-tasks = "tasks-semantic"` in KOTA
 * config after providing the module config (provider/model/apiKey).
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { REPO_TASKS_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import {
	createEmbeddingProvider,
	readEmbeddingProviderConfig,
} from "#modules/semantic-index/embedding-provider.js";
import { SemanticTasksStore } from "./semantic-store.js";

export const PROVIDER_NAME = "tasks-semantic";

const tasksSemanticModule: KotaModule = {
	name: "tasks-semantic",
	version: "1.0.0",
	description:
		"Semantic search over the repo task queue via embedding-backed cosine ranking.",
	dependencies: ["repo-tasks", "semantic-index"],

	onLoad(ctx: ModuleContext) {
		const config = readEmbeddingProviderConfig(ctx.getModuleConfig());
		if (!config) {
			ctx.log.debug(
				"tasks-semantic: no embedding config; provider not registered (keyword search remains active)",
			);
			return;
		}
		let provider: ReturnType<typeof createEmbeddingProvider>;
		try {
			provider = createEmbeddingProvider(config);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.log.warn(`tasks-semantic: cannot init embedding provider — ${msg}`);
			return;
		}
		const store = new SemanticTasksStore({
			projectDir: ctx.cwd,
			provider,
			onBackgroundError: (err) => {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.log.warn(`tasks-semantic: embedding failed — ${msg}`);
			},
		});
		ctx.registerProvider(REPO_TASKS_PROVIDER_TOKEN, store);
		ctx.log.info(
			`tasks-semantic: registered semantic repo-tasks provider (${config.provider}/${config.model})`,
		);
	},
};

export default tasksSemanticModule;
