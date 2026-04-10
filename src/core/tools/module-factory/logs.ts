/**
 * Module Factory — log query handler.
 */

import type { LogLevel } from "#core/modules/module-log.js";
import { getModuleLogStore } from "#core/modules/module-log.js";
import type { ToolResult } from "#core/tools/index.js";

export function handleLogs(input: Record<string, unknown>): ToolResult {
	const store = getModuleLogStore();
	if (!store) {
		return { content: "Module log store not initialized", is_error: true };
	}

	const moduleName = input.name as string | undefined;
	const level = input.level as LogLevel | undefined;
	const keyword = input.keyword as string | undefined;
	const limit = (input.limit as number) ?? 30;

	if (!moduleName) {
		const modules = store.modules();
		if (modules.length === 0) {
			return { content: "No module logs found." };
		}
		const lines = modules.map((name) => {
			const recent = store.tail(name, 1);
			const last = recent[0];
			const lastMsg = last
				? ` — last: [${last.level}] ${last.msg.slice(0, 80)}`
				: "";
			const count = store.query({ module: name, limit: 10000 }).length;
			return `- ${name}: ${count} entries${lastMsg}`;
		});
		return {
			content: `Modules with logs (${modules.length}):\n${lines.join("\n")}`,
		};
	}

	const entries = store.query({
		module: moduleName,
		level,
		keyword,
		limit,
	});
	if (entries.length === 0) {
		const filters = [
			level && `level=${level}`,
			keyword && `keyword="${keyword}"`,
		]
			.filter(Boolean)
			.join(", ");
		return {
			content: `No log entries for "${moduleName}"${filters ? ` (filters: ${filters})` : ""}.`,
		};
	}

	const reversed = [...entries].reverse();
	const lines = reversed.map((e) => {
		const time = e.ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
		const dataStr =
			e.data !== undefined ? ` | ${JSON.stringify(e.data)}` : "";
		return `[${time}] [${e.level}] ${e.msg}${dataStr}`;
	});

	return {
		content: `Logs for "${moduleName}" (${entries.length} entries, newest last):\n${lines.join("\n")}`,
	};
}
