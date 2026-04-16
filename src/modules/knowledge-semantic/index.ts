/**
 * Knowledge-semantic module — registers a KnowledgeProvider variant that
 * augments the file-based knowledge store with embedding-backed semantic
 * search. Activated by setting `providers.knowledge = "semantic"` in KOTA
 * config after providing the module config (provider/model/apiKey).
 */

import { getKnowledgeStore } from "#core/memory/knowledge-store.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
	createEmbeddingProvider,
	type EmbeddingProviderConfig,
} from "./embedding-provider.js";
import { SemanticKnowledgeStore } from "./semantic-store.js";

/**
 * Module name — also the name used when the user opts into this provider
 * via `providers.knowledge` in KOTA config. `registerProvider` always uses
 * the module's name, so these are deliberately kept in sync.
 */
export const PROVIDER_NAME = "knowledge-semantic";

function readConfig(
	raw: Record<string, unknown> | undefined,
): EmbeddingProviderConfig | null {
	if (!raw) return null;
	const provider = raw.provider;
	const model = raw.model;
	if (provider !== "openai" && provider !== "voyage") return null;
	if (typeof model !== "string" || !model) return null;
	const config: EmbeddingProviderConfig = { provider, model };
	if (typeof raw.apiKey === "string" && raw.apiKey) config.apiKey = raw.apiKey;
	if (typeof raw.baseUrl === "string" && raw.baseUrl) config.baseUrl = raw.baseUrl;
	return config;
}

const knowledgeSemanticModule: KotaModule = {
	name: "knowledge-semantic",
	version: "1.0.0",
	description:
		"Semantic search over the knowledge store via embedding-backed cosine ranking.",

	onLoad(ctx: ModuleContext) {
		const config = readConfig(ctx.getModuleConfig());
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
