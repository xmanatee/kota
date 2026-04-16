/**
 * Knowledge-semantic module — registers a KnowledgeProvider variant that
 * augments the file-based knowledge store with embedding-backed semantic
 * search. Activated by setting `providers.knowledge = "knowledge-semantic"`
 * in KOTA config after providing the module config (provider/model/apiKey).
 */

import { getKnowledgeStore } from "#core/memory/knowledge-store.js";
import {
	createEmbeddingProvider,
	readEmbeddingProviderConfig,
} from "#core/memory/semantic/embedding-provider.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { SemanticKnowledgeStore } from "./semantic-store.js";

export const PROVIDER_NAME = "knowledge-semantic";

const knowledgeSemanticModule: KotaModule = {
	name: "knowledge-semantic",
	version: "1.0.0",
	description:
		"Semantic search over the knowledge store via embedding-backed cosine ranking.",
	dependencies: ["knowledge"],

	onLoad(ctx: ModuleContext) {
		const config = readEmbeddingProviderConfig(ctx.getModuleConfig());
		if (!config) {
			ctx.log.debug(
				"knowledge-semantic: no embedding config; provider not registered (keyword search remains active)",
			);
			return;
		}
		let provider: ReturnType<typeof createEmbeddingProvider>;
		try {
			provider = createEmbeddingProvider(config);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.log.warn(`knowledge-semantic: cannot init embedding provider — ${msg}`);
			return;
		}
		const base = getKnowledgeStore(ctx.cwd);
		const store = new SemanticKnowledgeStore({
			base,
			provider,
			onBackgroundError: (err) => {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.log.warn(`knowledge-semantic: embedding failed — ${msg}`);
			},
		});
		ctx.registerProvider("knowledge", store);
		ctx.log.info(
			`knowledge-semantic: registered semantic knowledge provider (${config.provider}/${config.model})`,
		);
	},
};

export default knowledgeSemanticModule;
