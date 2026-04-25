import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getMemoryProvider } from "#core/modules/provider-registry.js";
import {
	type LineNode,
	line,
	plain,
	span,
	stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

type MemoryRow = { id: string; created: string; content: string };

function formatDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

export function buildMemoryListLines(rows: MemoryRow[]): LineNode[] {
	const idWidth = Math.max(...rows.map((e) => e.id.length), 2);
	const header = line(span(
		`${"ID".padEnd(idWidth)}  ${"Date".padEnd(16)}  Content`,
		"muted",
		true,
	));
	const rule = line(span("-".repeat(idWidth + 20 + 40), "muted"));
	const body: LineNode[] = rows.map((e) => {
		const snippet = e.content.replace(/\n/g, " ").slice(0, 60);
		return line(
			span(e.id.padEnd(idWidth), "accent"),
			plain(`  ${formatDate(e.created).padEnd(16)}  `),
			plain(snippet),
		);
	});
	return [header, rule, ...body];
}

export function registerMemoryCommands(program: Command, ctx: ModuleContext): void {
	const memCmd = program
		.command("memory")
		.description("Inspect and manage the agent memory store");

	memCmd
		.command("list")
		.description("List recent memory entries")
		.option("-n, --limit <n>", "Maximum entries to show", "20")
		.action(async (opts: { limit: string }) => {
			await ensureCliProvidersFor(["memory"]);
			const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
			const result = await ctx.client.memory.list(limit);
			if (result.entries.length === 0) {
				print(line(plain("No memory entries.")));
				return;
			}
			print(stack(...buildMemoryListLines(result.entries)));
		});

	memCmd
		.command("search <query>")
		.description("Search memory entries")
		.option("--tag <tag>", "Filter by tag")
		.option("--since <date>", "Only entries after date (ISO 8601)")
		.option("--semantic", "Use embedding-backed semantic ranking when configured")
		.option("-n, --limit <n>", "Maximum entries to show", "20")
		.action(async (query: string, opts: { tag?: string; since?: string; semantic?: boolean; limit: string }) => {
			await ensureCliProvidersFor(["memory"]);
			const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
			const store = getMemoryProvider();
			if (opts.semantic && !store.supportsSemanticSearch()) {
				console.error("Semantic memory search requires an embedding-backed memory provider.");
				process.exit(1);
			}
			const results = opts.semantic
				? await store.semanticSearch(query, limit, { tag: opts.tag, since: opts.since })
				: store.search(query, { tag: opts.tag, since: opts.since }).slice(0, limit);
			if (results.length === 0) {
				print(line(plain("No matching memories.")));
				return;
			}
			print(stack(...buildMemoryListLines(results)));
		});

	memCmd
		.command("add")
		.description("Create a new memory entry")
		.option("--content <text>", "Entry content (reads from stdin if omitted)")
		.option(
			"--tag <tag>",
			"Tag (repeatable)",
			(val: string, acc: string[]) => [...acc, val],
			[] as string[],
		)
		.action(async (opts: { content?: string; tag: string[] }) => {
			await ensureCliProvidersFor(["memory"]);
			let content = opts.content;
			if (content === undefined) {
				const chunks: Buffer[] = [];
				for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
				content = Buffer.concat(chunks).toString("utf-8").trimEnd();
			}
			if (!content) {
				console.error("Content is required (use --content or pipe via stdin).");
				process.exit(1);
			}
			const store = getMemoryProvider();
			const id = store.save(content, opts.tag);
			// biome-ignore lint/suspicious/noConsole: bare id output consumed by scripts
			console.log(id);
		});

	memCmd
		.command("delete <id>")
		.description("Delete a memory entry by ID")
		.action(async (id: string) => {
			await ensureCliProvidersFor(["memory"]);
			const store = getMemoryProvider();
			const ok = store.delete(id);
			if (!ok) {
				console.error(`Memory "${id}" not found.`);
				process.exit(1);
			}
			print(line(
				plain("Deleted memory "),
				span(id, "accent"),
				span(".", "success"),
			));
		});

	memCmd
		.command("reindex")
		.description(
			"Rebuild the semantic search index for all memory entries. " +
				"No-op when no embedding provider is configured.",
		)
		.action(async () => {
			await ensureCliProvidersFor(["memory"]);
			const provider = getMemoryProvider();
			const result = await provider.reindex();
			if (result.skipped) {
				print(line(plain(
					"Semantic search not configured — nothing to reindex. " +
						"Set `providers.memory` to an embedding-capable provider to enable.",
				)));
				return;
			}
			const failedRole = result.failed > 0 ? "error" : "muted";
			print(line(
				plain(`Reindexed `),
				span(String(result.indexed), "success"),
				plain(" entries ("),
				span(`${result.failed} failed`, failedRole),
				plain(")."),
			));
			if (result.failed > 0) process.exit(1);
		});
}
