/**
 * Memory-semantic module — registers a MemoryProvider variant that augments
 * the file-based memory store with embedding-backed semantic search.
 * Activated by setting `providers.memory = "memory-semantic"` in KOTA config
 * after providing the module config (provider/model/apiKey).
 */

import {
	createEmbeddingProvider,
	readEmbeddingProviderConfig,
} from "#core/memory/semantic/embedding-provider.js";
import { getMemoryStore } from "#core/memory/store.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { SemanticMemoryStore } from "./semantic-store.js";

export const PROVIDER_NAME = "memory-semantic";

const memorySemanticModule: KotaModule = {
	name: "memory-semantic",
	version: "1.0.0",
	description:
		"Semantic search over the memory store via embedding-backed cosine ranking.",
	dependencies: ["memory"],

	onLoad(ctx: ModuleContext) {
		const config = readEmbeddingProviderConfig(ctx.getModuleConfig());
		if (!config) {
			ctx.log.debug(
				"memory-semantic: no embedding config; provider not registered (keyword search remains active)",
			);
			return;
		}
		let provider: ReturnType<typeof createEmbeddingProvider>;
		try {
			provider = createEmbeddingProvider(config);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.log.warn(`memory-semantic: cannot init embedding provider — ${msg}`);
			return;
		}
		const base = getMemoryStore();
		const store = new SemanticMemoryStore({
			base,
			provider,
			onBackgroundError: (err) => {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.log.warn(`memory-semantic: embedding failed — ${msg}`);
			},
		});
		ctx.registerProvider("memory", store);
		ctx.log.info(
			`memory-semantic: registered semantic memory provider (${config.provider}/${config.model})`,
		);
	},
};

export default memorySemanticModule;
