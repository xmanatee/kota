/**
 * Tool Cache module — registers caching middleware for deterministic read tools.
 *
 * Caches results of idempotent tools (file_read, grep, glob, etc.) and
 * invalidates the cache when mutating tools (file_write, shell, etc.) run.
 * Session-scoped — cache resets when the module unloads.
 */

import type { KotaExtension } from "../extension-types.js";
import { createCacheMiddleware, getToolCache, resetToolCache } from "../tool-cache.js";

const MIDDLEWARE_NAME = "tool-result-cache";
const PRIORITY = 10; // Run early — before logging/audit middleware

const toolCacheModule: KotaExtension = {
	name: "tool-cache",
	version: "1.0.0",
	description: "Caches deterministic read tool results, invalidates on mutations",

	onLoad: (ctx) => {
		const cache = getToolCache();
		const mw = createCacheMiddleware(cache);
		ctx.registerMiddleware(MIDDLEWARE_NAME, mw, PRIORITY);
		ctx.log.info("Tool result cache enabled");
	},

	onUnload: () => {
		resetToolCache();
	},

	skills: [{ name: "tool-cache", promptPath: "src/extensions/skills/tool-cache.md" }],
};

export default toolCacheModule;
