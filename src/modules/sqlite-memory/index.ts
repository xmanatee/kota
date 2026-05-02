/**
 * SQLite memory module — registers an alternative SQLite-backed memory
 * provider.
 *
 * When active, all memory operations (save/search/list/update/delete) go through
 * SQLite instead of the default JSON file. Activate via config:
 *   { "providers": { "memory": "sqlite-memory" } }
 *
 * Data is stored in `.kota/memory.db`.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HealthCheckResult, KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { MEMORY_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import { SQLiteMemoryProvider } from "./provider.js";

let storageDir: string | null = null;

function checkSqliteHealth(): HealthCheckResult {
	if (!storageDir) return { status: "unhealthy", message: "Module not loaded" };
	const dbPath = join(storageDir, "memory.db");
	if (!existsSync(dbPath)) return { status: "healthy", message: "No database yet (will be created on first write)" };
	try {
		execFileSync("sqlite3", [dbPath, "SELECT 1"], { timeout: 2000, stdio: ["pipe", "pipe", "pipe"] });
		return { status: "healthy" };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { status: "unhealthy", message: `SQLite probe failed: ${msg.slice(0, 120)}` };
	}
}

const sqliteMemoryModule: KotaModule = {
	name: "sqlite-memory",
	version: "1.0.0",
	description: "SQLite-backed memory provider — SQL-powered search, no size limits",
	dependencies: ["memory"],

	onLoad: (ctx: ModuleRuntimeContext) => {
		storageDir = ctx.storage.getDir();
		const provider = new SQLiteMemoryProvider(storageDir);
		ctx.registerProvider(MEMORY_PROVIDER_TOKEN, provider);
		ctx.log.info("SQLite memory provider registered");
	},

	onUnload: () => {
		storageDir = null;
	},

	healthCheck: () => checkSqliteHealth(),

	skills: [{ name: "sqlite-memory", promptPath: "src/modules/sqlite-memory/sqlite-memory.md" }],
};

export default sqliteMemoryModule;
