/**
 * Tool Retry module — registers retry middleware for transient tool
 * failures.
 *
 * Auto-retries network tools (web_fetch, web_search, http_request) on
 * transient errors (ECONNRESET, 502, 429, etc.) and shell commands on
 * timeout with doubled timeout_ms. Session-scoped stats reset on unload.
 */

import type { KotaModule } from "../../core/modules/module-types.js";
import { createRetryMiddleware, resetRetryStats } from "./tool-retry.js";

const MIDDLEWARE_NAME = "tool-retry";
const PRIORITY = 20; // After cache (10), before custom middleware (100+)

const toolRetryModule: KotaModule = {
	name: "tool-retry",
	version: "1.0.0",
	description: "Retries transient tool failures with exponential backoff",

	onLoad: (ctx) => {
		const mw = createRetryMiddleware();
		ctx.registerMiddleware(MIDDLEWARE_NAME, mw, PRIORITY);
		ctx.log.info("Tool retry middleware enabled");
	},

	onUnload: () => {
		resetRetryStats();
	},

	skills: [{ name: "tool-retry", promptPath: "src/modules/tool-retry/tool-retry.md" }],
};

export default toolRetryModule;
