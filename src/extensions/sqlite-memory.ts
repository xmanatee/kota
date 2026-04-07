/**
 * SQLite memory extension — registers an alternative SQLite-backed memory
 * provider.
 *
 * When active, all memory operations (save/search/list/update/delete) go through
 * SQLite instead of the default JSON file. Activate via config:
 *   { "providers": { "memory": "sqlite-memory" } }
 *
 * Data is stored in `.kota/memory.db`.
 */

import type { ExtensionContext, KotaExtension } from "../extension-types.js";
import { SQLiteMemoryProvider } from "../memory/sqlite-memory.js";

const sqliteMemoryModule: KotaExtension = {
	name: "sqlite-memory",
	version: "1.0.0",
	description: "SQLite-backed memory provider — SQL-powered search, no size limits",
	dependencies: ["memory"],

	onLoad: (ctx: ExtensionContext) => {
		const provider = new SQLiteMemoryProvider(ctx.storage.getDir());
		ctx.registerProvider("memory", provider);
		ctx.log.info("SQLite memory provider registered");
	},

	skills: [{ name: "sqlite-memory", promptPath: "src/extensions/skills/sqlite-memory.md" }],
};

export default sqliteMemoryModule;
