import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import {
	blank,
	kvBlock,
	type LineNode,
	line,
	plain,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

type RawImportEntry = { title?: unknown; body?: unknown; tags?: unknown };

function formatDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

type KnowledgeRow = {
	id: string;
	title: string;
	type: string;
	status: string;
	updated: string;
};

function statusRole(status: string): "success" | "warn" | "muted" | "info" {
	switch (status) {
		case "active":
			return "success";
		case "archived":
			return "muted";
		case "draft":
			return "warn";
		default:
			return "info";
	}
}

export function buildKnowledgeListLines(entries: KnowledgeRow[]): LineNode[] {
	const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
	const typeWidth = Math.max(...entries.map((e) => e.type.length), 4);
	const statusWidth = Math.max(...entries.map((e) => e.status.length), 6);
	const header = line(span(
		`${"ID".padEnd(idWidth)}  ${"Type".padEnd(typeWidth)}  ${"Status".padEnd(statusWidth)}  ${"Updated".padEnd(16)}  Title`,
		"muted",
		true,
	));
	const rule = line(span("-".repeat(idWidth + typeWidth + statusWidth + 22 + 30), "muted"));
	const rows: LineNode[] = entries.map((e) => line(
		span(e.id.padEnd(idWidth), "accent"),
		plain(`  ${e.type.padEnd(typeWidth)}  `),
		span(e.status.padEnd(statusWidth), statusRole(e.status)),
		plain(`  ${formatDate(e.updated).padEnd(16)}  ${e.title}`),
	));
	return [header, rule, ...rows];
}

export function buildKnowledgeSearchLines(entries: KnowledgeRow[]): LineNode[] {
	const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
	const typeWidth = Math.max(...entries.map((e) => e.type.length), 4);
	const header = line(span(
		`${"ID".padEnd(idWidth)}  ${"Type".padEnd(typeWidth)}  Title`,
		"muted",
		true,
	));
	const rule = line(span("-".repeat(idWidth + typeWidth + 6 + 30), "muted"));
	const rows: LineNode[] = entries.map((e) => line(
		span(e.id.padEnd(idWidth), "accent"),
		plain(`  ${e.type.padEnd(typeWidth)}  ${e.title}`),
	));
	return [header, rule, ...rows];
}

function toRow(entry: KnowledgeEntry): KnowledgeRow {
	return {
		id: entry.id,
		title: entry.title,
		type: entry.type,
		status: entry.status,
		updated: entry.updated,
	};
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

export function registerKnowledgeCommands(
	program: Command,
	ctx: ModuleContext,
): void {
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
		.action(async (opts: { tag?: string; type?: string; status?: string; limit: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
			const result = await ctx.client.knowledge.list({
				tag: opts.tag,
				type: opts.type,
				status: opts.status,
			});
			const entries = result.entries.slice(0, limit);
			if (entries.length === 0) {
				print(line(plain("No knowledge entries.")));
				return;
			}
			print(stack(...buildKnowledgeListLines(entries.map(toRow))));
		});

	kCmd
		.command("search <query>")
		.description("Search knowledge entries")
		.option("--tag <tag>", "Filter by tag")
		.option("--type <type>", "Filter by type")
		.option("--status <status>", "Filter by status")
		.option("--semantic", "Use embedding-backed semantic ranking when configured")
		.option("-n, --limit <n>", "Maximum entries to show", "20")
		.action(async (query: string, opts: { tag?: string; type?: string; status?: string; semantic?: boolean; limit: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
			const result = await ctx.client.knowledge.search(query, {
				tag: opts.tag,
				type: opts.type,
				status: opts.status,
				semantic: opts.semantic === true,
				limit,
			});
			if (!result.ok) {
				console.error("Semantic knowledge search requires an embedding-backed knowledge provider.");
				process.exit(1);
			}
			if (result.entries.length === 0) {
				print(line(plain("No matching knowledge entries.")));
				return;
			}
			print(stack(...buildKnowledgeSearchLines(result.entries.map(toRow))));
		});

	kCmd
		.command("show <id>")
		.description("Print a single knowledge entry")
		.action(async (id: string) => {
			await ensureCliProvidersFor(["knowledge"]);
			const result = await ctx.client.knowledge.show(id);
			if (!result.found) {
				console.error(`Knowledge entry "${id}" not found.`);
				process.exit(1);
			}
			const entry = result.entry;
			const meta = Object.entries(entry.meta).map(([k, v]) => ({
				label: k,
				value: String(v),
				role: "muted" as const,
			}));
			print(kvBlock([
				{ label: "ID", value: entry.id, role: "accent" },
				{ label: "Title", value: entry.title },
				{ label: "Type", value: entry.type, role: "info" },
				{ label: "Status", value: entry.status, role: statusRole(entry.status) },
				{ label: "Tags", value: entry.tags.join(", ") || "(none)", role: "muted" },
				{ label: "Created", value: entry.created, role: "muted" },
				{ label: "Updated", value: entry.updated, role: "muted" },
				...meta,
			]));
			print(blank());
			print(line(plain(entry.content)));
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
			await ensureCliProvidersFor(["knowledge"]);
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
			const result = await ctx.client.knowledge.add({
				title: opts.title,
				content,
				type: opts.type,
				tags: opts.tag,
				status: opts.status,
				scope: opts.scope as "project" | "global",
			});
			// biome-ignore lint/suspicious/noConsole: bare id output consumed by scripts
			console.log(result.id);
		});

	kCmd
		.command("delete <id>")
		.description("Delete a knowledge entry by ID")
		.action(async (id: string) => {
			await ensureCliProvidersFor(["knowledge"]);
			const result = await ctx.client.knowledge.delete(id);
			if (!result.ok) {
				console.error(`Knowledge entry "${id}" not found.`);
				process.exit(1);
			}
			print(line(
				plain("Deleted knowledge entry "),
				span(id, "accent"),
				span(".", "success"),
			));
		});

	kCmd
		.command("export")
		.description("Export knowledge entries to stdout in JSON or JSONL format")
		.option("--type <type>", "Filter by type")
		.option("--status <status>", "Filter by status")
		.option("--tag <tag>", "Filter by tag")
		.option("--scope <scope>", "Storage scope: project, global, or all", "project")
		.option("--format <fmt>", "Output format: json or jsonl", "jsonl")
		.action(async (opts: { type?: string; status?: string; tag?: string; scope: string; format: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			if (opts.scope !== "project" && opts.scope !== "global" && opts.scope !== "all") {
				console.error(`Invalid scope "${opts.scope}". Use "project", "global", or "all".`);
				process.exit(1);
			}
			if (opts.format !== "json" && opts.format !== "jsonl") {
				console.error(`Invalid format "${opts.format}". Use "json" or "jsonl".`);
				process.exit(1);
			}
			const result = await ctx.client.knowledge.list({
				type: opts.type,
				status: opts.status,
				tag: opts.tag,
				scope: opts.scope as "project" | "global" | "all",
			});
			const exported = result.entries.map((e) => ({
				title: e.title,
				body: e.content,
				tags: e.tags,
				type: e.type,
				status: e.status,
				id: e.id,
				created: e.created,
				updated: e.updated,
				...(Object.keys(e.meta).length > 0 ? { meta: e.meta } : {}),
			}));
			if (opts.format === "json") {
				// biome-ignore lint/suspicious/noConsole: structured JSON export stays on console
				console.log(JSON.stringify(exported, null, 2));
			} else {
				for (const entry of exported) {
					// biome-ignore lint/suspicious/noConsole: structured JSONL export stays on console
					console.log(JSON.stringify(entry));
				}
			}
		});

	kCmd
		.command("reindex")
		.description(
			"Rebuild the semantic search index for all knowledge entries. " +
				"No-op when no embedding provider is configured.",
		)
		.action(async () => {
			await ensureCliProvidersFor(["knowledge"]);
			const result = await ctx.client.knowledge.reindex();
			if (result.skipped) {
				print(line(plain(
					"Semantic search not configured — nothing to reindex. " +
						"Set `providers.knowledge` to an embedding-capable provider to enable.",
				)));
				return;
			}
			const failedRole = result.failed > 0 ? "error" : "muted";
			print(line(
				plain("Reindexed "),
				span(String(result.indexed), "success"),
				plain(" entries ("),
				span(`${result.failed} failed`, failedRole),
				plain(")."),
			));
			if (result.failed > 0) process.exit(1);
		});

	kCmd
		.command("import <file>")
		.description("Bulk import knowledge entries from a JSON or JSONL file")
		.option("--type <type>", "Entry type for all imported entries", "note")
		.option("--status <status>", "Entry status for all imported entries", "active")
		.option("--scope <scope>", "Storage scope: project or global", "project")
		.action(async (file: string, opts: { type: string; status: string; scope: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
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
				await ctx.client.knowledge.add({
					title: entry.title,
					content: entry.body,
					type: opts.type,
					tags,
					status: opts.status,
					scope: opts.scope as "project" | "global",
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
