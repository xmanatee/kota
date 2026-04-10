import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { getKnowledgeStore } from "../../core/memory/knowledge-store.js";

type RawImportEntry = { title?: unknown; body?: unknown; tags?: unknown };

function formatDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

/** Parse a JSON or JSONL file into raw entry objects. */
export function parseImportEntries(content: string): RawImportEntry[] {
	const trimmed = content.trim();
	if (trimmed.startsWith("[")) {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed)) throw new Error("JSON file must be an array");
		return parsed as RawImportEntry[];
	}
	return trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as RawImportEntry);
}

export function registerKnowledgeCommands(program: Command): void {
	const kCmd = program
		.command("knowledge")
		.description("Inspect and manage the project knowledge store");

	kCmd
		.command("list")
		.description("List knowledge entries")
		.option("--tag <tag>", "Filter by tag")
		.option("--type <type>", "Filter by type")
		.option("--status <status>", "Filter by status")
		.option("-n, --limit <n>", "Maximum entries to show", "20")
		.action((opts: { tag?: string; type?: string; status?: string; limit: string }) => {
			const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
			const store = getKnowledgeStore(process.cwd());
			const entries = store
				.list({ tag: opts.tag, type: opts.type, status: opts.status })
				.slice(0, limit);
			if (entries.length === 0) {
				console.log("No knowledge entries.");
				return;
			}
			const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
			const typeWidth = Math.max(...entries.map((e) => e.type.length), 4);
			const statusWidth = Math.max(...entries.map((e) => e.status.length), 6);
			console.log(
				`${"ID".padEnd(idWidth)}  ${"Type".padEnd(typeWidth)}  ${"Status".padEnd(statusWidth)}  ${"Updated".padEnd(16)}  Title`,
			);
			console.log("-".repeat(idWidth + typeWidth + statusWidth + 22 + 30));
			for (const e of entries) {
				console.log(
					`${e.id.padEnd(idWidth)}  ${e.type.padEnd(typeWidth)}  ${e.status.padEnd(statusWidth)}  ${formatDate(e.updated)}  ${e.title}`,
				);
			}
		});

	kCmd
		.command("search <query>")
		.description("Search knowledge entries by keyword")
		.option("--tag <tag>", "Filter by tag")
		.option("--type <type>", "Filter by type")
		.option("--status <status>", "Filter by status")
		.action((query: string, opts: { tag?: string; type?: string; status?: string }) => {
			const store = getKnowledgeStore(process.cwd());
			const results = store.search(query, {
				tag: opts.tag,
				type: opts.type,
				status: opts.status,
			});
			if (results.length === 0) {
				console.log("No matching knowledge entries.");
				return;
			}
			const idWidth = Math.max(...results.map((e) => e.id.length), 2);
			const typeWidth = Math.max(...results.map((e) => e.type.length), 4);
			console.log(`${"ID".padEnd(idWidth)}  ${"Type".padEnd(typeWidth)}  Title`);
			console.log("-".repeat(idWidth + typeWidth + 6 + 30));
			for (const e of results) {
				console.log(`${e.id.padEnd(idWidth)}  ${e.type.padEnd(typeWidth)}  ${e.title}`);
			}
		});

	kCmd
		.command("show <id>")
		.description("Print a single knowledge entry")
		.action((id: string) => {
			const store = getKnowledgeStore(process.cwd());
			const entry = store.read(id);
			if (!entry) {
				console.error(`Knowledge entry "${id}" not found.`);
				process.exit(1);
			}
			console.log(`ID:      ${entry.id}`);
			console.log(`Title:   ${entry.title}`);
			console.log(`Type:    ${entry.type}`);
			console.log(`Status:  ${entry.status}`);
			console.log(`Tags:    ${entry.tags.join(", ") || "(none)"}`);
			console.log(`Created: ${entry.created}`);
			console.log(`Updated: ${entry.updated}`);
			if (Object.keys(entry.meta).length > 0) {
				for (const [k, v] of Object.entries(entry.meta)) {
					console.log(`${k}: ${v}`);
				}
			}
			console.log();
			console.log(entry.content);
		});

	kCmd
		.command("add")
		.description("Create a new knowledge entry")
		.requiredOption("--title <title>", "Entry title")
		.option("--content <text>", "Entry content (reads from stdin if omitted)")
		.option("--type <type>", "Entry type", "note")
		.option("--tag <tag>", "Tag (repeatable)", (val: string, acc: string[]) => [...acc, val], [] as string[])
		.option("--status <status>", "Entry status", "active")
		.option("--scope <scope>", "Storage scope: project or global", "project")
		.action(async (opts: { title: string; content?: string; type: string; tag: string[]; status: string; scope: string }) => {
			if (opts.scope !== "project" && opts.scope !== "global") {
				console.error(`Invalid scope "${opts.scope}". Use "project" or "global".`);
				process.exit(1);
			}
			let content = opts.content;
			if (content === undefined) {
				const chunks: Buffer[] = [];
				for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
				content = Buffer.concat(chunks).toString("utf-8").trimEnd();
			}
			const store = getKnowledgeStore(process.cwd());
			const id = store.create({
				title: opts.title,
				content,
				type: opts.type,
				tags: opts.tag,
				status: opts.status,
				scope: opts.scope as "project" | "global",
			});
			console.log(id);
		});

	kCmd
		.command("delete <id>")
		.description("Delete a knowledge entry by ID")
		.action((id: string) => {
			const store = getKnowledgeStore(process.cwd());
			const ok = store.delete(id);
			if (!ok) {
				console.error(`Knowledge entry "${id}" not found.`);
				process.exit(1);
			}
			console.log(`Deleted knowledge entry ${id}.`);
		});

	kCmd
		.command("import <file>")
		.description("Bulk import knowledge entries from a JSON or JSONL file")
		.option("--type <type>", "Entry type for all imported entries", "note")
		.option("--status <status>", "Entry status for all imported entries", "active")
		.option("--scope <scope>", "Storage scope: project or global", "project")
		.action((file: string, opts: { type: string; status: string; scope: string }) => {
			if (opts.scope !== "project" && opts.scope !== "global") {
				console.error(`Invalid scope "${opts.scope}". Use "project" or "global".`);
				process.exit(1);
			}
			let raw: string;
			try {
				raw = readFileSync(file, "utf-8");
			} catch {
				console.error(`Cannot read file: ${file}`);
				process.exit(1);
			}
			let entries: RawImportEntry[];
			try {
				entries = parseImportEntries(raw);
			} catch (err) {
				console.error(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`);
				process.exit(1);
			}
			const store = getKnowledgeStore(process.cwd());
			let imported = 0;
			let skipped = 0;
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				if (typeof entry.title !== "string" || !entry.title || typeof entry.body !== "string") {
					console.warn(`Row ${i + 1}: skipped (missing title or body)`);
					skipped++;
					continue;
				}
				const tags =
					Array.isArray(entry.tags) && entry.tags.every((t) => typeof t === "string")
						? (entry.tags as string[])
						: [];
				store.create({
					title: entry.title,
					content: entry.body,
					type: opts.type,
					tags,
					status: opts.status,
					scope: opts.scope as "project" | "global",
				});
				imported++;
			}
			console.log(`Imported ${imported} entries, skipped ${skipped} (missing title/body).`);
		});
}
