/**
 * Module Factory — log query handler.
 */

import type { LogLevel } from "../../extension-log.js";
import { getExtensionLogStore } from "../../extension-log.js";
import type { ToolResult } from "../index.js";

export function handleLogs(input: Record<string, unknown>): ToolResult {
	const store = getExtensionLogStore();
	if (!store) {
		return { content: "Extension log store not initialized", is_error: true };
	}

	const extensionName = input.name as string | undefined;
	const level = input.level as LogLevel | undefined;
	const keyword = input.keyword as string | undefined;
	const limit = (input.limit as number) ?? 30;

	if (!extensionName) {
		const extensions = store.extensions();
		if (extensions.length === 0) {
			return { content: "No extension logs found." };
		}
		const lines = extensions.map((ext) => {
			const recent = store.tail(ext, 1);
			const last = recent[0];
			const lastMsg = last
				? ` — last: [${last.level}] ${last.msg.slice(0, 80)}`
				: "";
			const count = store.query({ extension: ext, limit: 10000 }).length;
			return `- ${ext}: ${count} entries${lastMsg}`;
		});
		return {
			content: `Extensions with logs (${extensions.length}):\n${lines.join("\n")}`,
		};
	}

	const entries = store.query({
		extension: extensionName,
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
			content: `No log entries for "${extensionName}"${filters ? ` (filters: ${filters})` : ""}.`,
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
		content: `Logs for "${extensionName}" (${entries.length} entries, newest last):\n${lines.join("\n")}`,
	};
}
