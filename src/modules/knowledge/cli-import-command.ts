import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import { print, printToStderr } from "#modules/rendering/transport.js";
import { parseImportEntries, type RawImportEntry } from "./import.js";

export function registerKnowledgeImportCommand(
	kCmd: Command,
	ctx: ModuleContext,
): void {
	kCmd
		.command("import <file>")
		.description("Bulk import knowledge entries from a JSON or JSONL file")
		.option("--type <type>", "Entry type for all imported entries", "note")
		.option("--status <status>", "Entry status for all imported entries", "active")
		.option("--scope <scope>", "Storage scope: scope or global", "scope")
		.action(async (file: string, opts: { type: string; status: string; scope: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			if (opts.scope !== "scope" && opts.scope !== "global") {
				printToStderr(line(span(`Invalid scope "${opts.scope}". Use "scope" or "global".`, "error")));
				process.exit(1);
			}
			const entries = readImportEntries(file);
			let imported = 0;
			let skipped = 0;
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				if (typeof entry.title !== "string" || !entry.title || typeof entry.body !== "string") {
					printToStderr(line(span(`Row ${i + 1}: skipped (missing title or body)`, "warn")));
					skipped++;
					continue;
				}
				const tags =
					Array.isArray(entry.tags) && entry.tags.every((t) => typeof t === "string")
						? (entry.tags as string[])
						: [];
				await ctx.client.knowledge.add({
					title: entry.title,
					content: entry.body,
					type: opts.type,
					tags,
					status: opts.status,
					scope: opts.scope as "scope" | "global",
				});
				imported++;
			}
			print(line(
				plain("Imported "),
				span(String(imported), "success"),
				plain(" entries, skipped "),
				span(String(skipped), skipped > 0 ? "warn" : "muted"),
				plain(" (missing title/body)."),
			));
		});
}

function readImportEntries(file: string): RawImportEntry[] {
	let raw: string;
	try {
		raw = readFileSync(file, "utf-8");
	} catch {
		printToStderr(line(span(`Cannot read file: ${file}`, "error")));
		process.exit(1);
	}
	try {
		return parseImportEntries(raw);
	} catch (err) {
		printToStderr(line(span(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`, "error")));
		process.exit(1);
	}
}
