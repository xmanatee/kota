/**
 * History-semantic module — registers a HistoryProvider variant that
 * augments the file-based conversation history store with embedding-backed
 * semantic search. Activated by setting `providers.history = "history-semantic"`
 * in KOTA config after providing the module config (provider/model/apiKey).
 */

import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { getHistory } from "#modules/history/history.js";
import {
	createEmbeddingProvider,
	readEmbeddingProviderConfig,
} from "#modules/semantic-index/embedding-provider.js";
import { SemanticHistoryStore } from "./semantic-store.js";

export const PROVIDER_NAME = "history-semantic";

const historySemanticModule: KotaModule = {
	name: "history-semantic",
	version: "1.0.0",
	description:
		"Semantic search over the conversation history store via embedding-backed cosine ranking.",
	dependencies: ["history", "semantic-index"],

	onLoad(ctx: ModuleContext) {
		const config = readEmbeddingProviderConfig(ctx.getModuleConfig());
		if (!config) {
			ctx.log.debug(
				"history-semantic: no embedding config; provider not registered (keyword search remains active)",
			);
			return;
		}
		let provider: ReturnType<typeof createEmbeddingProvider>;
		try {
			provider = createEmbeddingProvider(config);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.log.warn(`history-semantic: cannot init embedding provider — ${msg}`);
			return;
		}
		const base = getHistory();
		const store = new SemanticHistoryStore({
			base,
			provider,
			onBackgroundError: (err) => {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.log.warn(`history-semantic: embedding failed — ${msg}`);
			},
		});
		ctx.registerProvider("history", store);
		ctx.log.info(
			`history-semantic: registered semantic history provider (${config.provider}/${config.model})`,
		);
	},
};

export default historySemanticModule;
