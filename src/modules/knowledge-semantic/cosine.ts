/** Cosine similarity for dense float vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
	if (a.length !== b.length) {
		throw new Error(
			`Vector length mismatch: ${a.length} vs ${b.length}`,
		);
	}
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		dot += x * y;
		magA += x * x;
		magB += y * y;
	}
	if (magA === 0 || magB === 0) return 0;
	return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
