/**
 * Embedding provider — computes dense vectors for strings via an
 * OpenAI-compatible `/embeddings` endpoint. Works against OpenAI,
 * Voyage AI, and any API that follows the same request/response shape.
 */

export type EmbeddingProviderConfig = {
	provider: "openai" | "voyage";
	model: string;
	apiKey?: string;
	baseUrl?: string;
};

export interface EmbeddingProvider {
	readonly name: string;
	readonly model: string;
	embed(texts: string[]): Promise<number[][]>;
}

const PRESETS: Record<
	EmbeddingProviderConfig["provider"],
	{ baseUrl: string; apiKeyEnv: string }
> = {
	openai: { baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
	voyage: { baseUrl: "https://api.voyageai.com/v1", apiKeyEnv: "VOYAGE_API_KEY" },
};

export class HttpEmbeddingProvider implements EmbeddingProvider {
	readonly name: string;
	readonly model: string;
	private baseUrl: string;
	private apiKey: string;

	constructor(config: EmbeddingProviderConfig) {
		const preset = PRESETS[config.provider];
		if (!preset && !config.baseUrl) {
			throw new Error(
				`Unknown embedding provider "${config.provider}" and no baseUrl provided`,
			);
		}
		this.name = config.provider;
		this.model = config.model;
		this.baseUrl = (config.baseUrl || preset.baseUrl).replace(/\/+$/, "");
		this.apiKey = config.apiKey || process.env[preset?.apiKeyEnv ?? ""] || "";
		if (!this.apiKey) {
			throw new Error(
				`No API key for embedding provider "${config.provider}". ` +
					`Provide apiKey in config or set ${preset?.apiKeyEnv ?? "the API key env var"}.`,
			);
		}
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const url = `${this.baseUrl}/embeddings`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({ input: texts, model: this.model }),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(
				`Embedding API ${response.status} ${response.statusText}: ${body}`,
			);
		}
		const payload = (await response.json()) as {
			data?: Array<{ embedding?: unknown; index?: number }>;
		};
		if (!Array.isArray(payload.data)) {
			throw new Error("Embedding API returned unexpected shape (no data[])");
		}
		const results: number[][] = new Array(texts.length);
		for (const item of payload.data) {
			if (!Array.isArray(item.embedding)) {
				throw new Error("Embedding entry missing numeric vector");
			}
			const vector = (item.embedding as unknown[]).map((n) => {
				if (typeof n !== "number") {
					throw new Error("Embedding vector contained non-numeric element");
				}
				return n;
			});
			const idx = typeof item.index === "number" ? item.index : results.filter(Boolean).length;
			results[idx] = vector;
		}
		for (let i = 0; i < results.length; i++) {
			if (!results[i]) {
				throw new Error(`Missing embedding for input ${i}`);
			}
		}
		return results;
	}
}

export function createEmbeddingProvider(
	config: EmbeddingProviderConfig,
): EmbeddingProvider {
	return new HttpEmbeddingProvider(config);
}

/**
 * Build an embedding provider config from a raw module-config record.
 * Returns `null` when the record does not specify a usable provider.
 */
export function readEmbeddingProviderConfig(
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
