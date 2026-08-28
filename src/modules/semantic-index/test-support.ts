import type { EmbeddingProvider } from "./embedding-provider.js";

export const CONCEPTS: Record<string, number> = {
	workflow: 0,
	pipeline: 0,
	cost: 1,
	budget: 1,
	spend: 1,
	spending: 1,
	expense: 1,
	tracking: 2,
	monitoring: 2,
	metric: 2,
	metrics: 2,
	anomaly: 3,
	alert: 3,
	bread: 4,
	baking: 4,
	recipe: 4,
	auth: 5,
	login: 5,
	session: 5,
	semantic: 6,
	embedding: 6,
	search: 6,
	ranking: 6,
};

export const DIMS = 8;

export function fakeEmbed(text: string): number[] {
	const vec = new Array(DIMS).fill(0);
	for (const word of text.toLowerCase().split(/[^a-z]+/)) {
		if (!word) continue;
		const dim = CONCEPTS[word];
		if (dim !== undefined) vec[dim] += 1;
	}
	return vec;
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
	readonly name = "fake";
	readonly model: string;
	public calls = 0;
	public textsSeen: string[][] = [];
	public failNext = false;

	constructor(model = "fake-model-v1") {
		this.model = model;
	}

	async embed(texts: string[]): Promise<number[][]> {
		this.calls += 1;
		this.textsSeen.push([...texts]);
		if (this.failNext) {
			this.failNext = false;
			throw new Error("fake provider failure");
		}
		return texts.map(fakeEmbed);
	}
}
