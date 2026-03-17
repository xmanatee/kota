/**
 * SQLite memory module — registers an alternative SQLite-backed memory provider.
 *
 * When active, all memory operations (save/search/list/update/delete) go through
 * SQLite instead of the default JSON file. Activate via config:
 *   { "providers": { "memory": "sqlite-memory" } }
 *
 * Data is stored in `.kota/memory.db`.
 */

import type { KotaModule, ModuleContext } from "../module-types.js";
import { SQLiteMemoryProvider } from "../sqlite-memory.js";

const sqliteMemoryModule: KotaModule = {
	name: "sqlite-memory",
	version: "1.0.0",
	description: "SQLite-backed memory provider — SQL-powered search, no size limits",
	dependencies: ["memory"],

	onLoad: (ctx: ModuleContext) => {
		const provider = new SQLiteMemoryProvider(ctx.storage.getDir());
		ctx.registerProvider("memory", provider);
		ctx.log.info("SQLite memory provider registered");
	},

	promptSection: () =>
		"SQLite memory backend available. Set providers.memory to 'sqlite-memory' in config for SQL-powered memory with full-text search and no size limits.",
};

export default sqliteMemoryModule;
