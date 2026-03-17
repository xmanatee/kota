/**
 * Tool Result Cache — session-scoped middleware that caches deterministic
 * read-only tool results and invalidates on mutations.
 *
 * Inspired by CrewAI's opt-out caching model: deterministic reads are cached
 * by default, write/side-effect tools trigger invalidation.
 *
 * Cache key: tool name + canonical JSON of input.
 * Cache scope: single session (in-memory Map, cleared on reset).
 */

import type { ToolMiddlewareFn } from "./tool-middleware.js";
import type { ToolResult } from "./tools/index.js";

/** Tools whose output is deterministic for the same input within a session. */
const CACHEABLE_TOOLS = new Set([
	"file_read",
	"grep",
	"glob",
	"repo_map",
	"files_overview",
	"read_document",
	"view_image",
]);

/** Tools that mutate state and should invalidate the cache. */
const MUTATING_TOOLS = new Set([
	"file_write",
	"file_edit",
	"multi_edit",
	"find_replace",
	"shell",
	"code_exec",
	"notebook",
	"process",
	"computer_use",
]);

export type CacheStats = {
	hits: number;
	misses: number;
	invalidations: number;
	size: number;
};

/** Canonical cache key: tool name + sorted JSON of input. */
function cacheKey(name: string, input: Record<string, unknown>): string {
	const sorted = Object.keys(input)
		.sort()
		.reduce<Record<string, unknown>>((acc, k) => {
			acc[k] = input[k];
			return acc;
		}, {});
	return `${name}\0${JSON.stringify(sorted)}`;
}

export class ToolCache {
	private cache = new Map<string, ToolResult>();
	private _hits = 0;
	private _misses = 0;
	private _invalidations = 0;

	/** Check cache for a deterministic read tool. Returns undefined on miss. */
	get(name: string, input: Record<string, unknown>): ToolResult | undefined {
		if (!CACHEABLE_TOOLS.has(name)) return undefined;
		const key = cacheKey(name, input);
		const cached = this.cache.get(key);
		if (cached) {
			this._hits++;
			return cached;
		}
		this._misses++;
		return undefined;
	}

	/** Store a successful result for a cacheable tool. */
	set(name: string, input: Record<string, unknown>, result: ToolResult): void {
		if (!CACHEABLE_TOOLS.has(name)) return;
		if (result.is_error) return;
		this.cache.set(cacheKey(name, input), result);
	}

	/** Invalidate the entire cache (called after mutating tool calls). */
	invalidate(): void {
		if (this.cache.size > 0) {
			this._invalidations++;
			this.cache.clear();
		}
	}

	/** Returns true if the tool name triggers cache invalidation. */
	isMutating(name: string): boolean {
		return MUTATING_TOOLS.has(name);
	}

	/** Returns true if the tool name is cacheable. */
	isCacheable(name: string): boolean {
		return CACHEABLE_TOOLS.has(name);
	}

	get stats(): CacheStats {
		return {
			hits: this._hits,
			misses: this._misses,
			invalidations: this._invalidations,
			size: this.cache.size,
		};
	}

	/** Clear cache and reset stats. */
	reset(): void {
		this.cache.clear();
		this._hits = 0;
		this._misses = 0;
		this._invalidations = 0;
	}
}

/** Create a middleware function that uses the given ToolCache instance. */
export function createCacheMiddleware(cache: ToolCache): ToolMiddlewareFn {
	return async (call, next) => {
		// Check cache for reads
		const cached = cache.get(call.name, call.input);
		if (cached) return cached;

		// Execute the tool
		const result = await next();

		// Invalidate on mutations
		if (cache.isMutating(call.name)) {
			cache.invalidate();
		}

		// Cache successful reads
		cache.set(call.name, call.input, result);

		return result;
	};
}

// ─── Singleton ───────────────────────────────────────────────────────

let _cache: ToolCache | null = null;

export function getToolCache(): ToolCache {
	if (!_cache) _cache = new ToolCache();
	return _cache;
}

export function resetToolCache(): void {
	_cache?.reset();
	_cache = null;
}
