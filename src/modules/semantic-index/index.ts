/**
 * Semantic-index module — shared embedding-index engine used by the
 * `memory-semantic` and `knowledge-semantic` provider modules.
 *
 * Exposes the embedding-provider client, cosine similarity, sidecar index
 * format, and the generic `SemanticIndexManager`. The module itself does
 * not register providers, tools, or routes — it is a capability pack that
 * consumer modules import from and declare as a dependency.
 */

import type { KotaModule } from "#core/modules/module-types.js";

export { cosineSimilarity } from "./cosine.js";
export {
	createEmbeddingProvider,
	type EmbeddingProvider,
	type EmbeddingProviderConfig,
	HttpEmbeddingProvider,
	readEmbeddingProviderConfig,
} from "./embedding-provider.js";
export {
	INDEX_FILENAME,
	INDEX_VERSION,
	type IndexedEmbedding,
	indexPathFor,
	type SemanticIndex,
	SemanticIndexFile,
} from "./semantic-index.js";
export {
	EMBED_TEXT_LIMIT,
	type ReindexResult,
	SemanticIndexManager,
	type SemanticStoreAdapter,
} from "./semantic-index-manager.js";

const semanticIndexModule: KotaModule = {
	name: "semantic-index",
	version: "1.0.0",
	description:
		"Shared embedding-index engine: embedding provider client, cosine similarity, sidecar index, and SemanticIndexManager for semantic store modules.",
};

export default semanticIndexModule;
