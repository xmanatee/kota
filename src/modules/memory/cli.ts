import type { Command } from "commander";
import { getMemoryStore } from "#core/memory/store.js";
import { getMemoryProvider } from "#core/modules/provider-registry.js";

function formatDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

export function registerMemoryCommands(program: Command): void {
	const memCmd = program
		.command("memory")
		.description("Inspect and manage the agent memory store");

	memCmd
		.command("list")
		.description("List recent memory entries")
		.option("-n, --limit <n>", "Maximum entries to show", "20")
		.action((opts: { limit: string }) => {
			const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
			const store = getMemoryStore();
			const entries = store.list().slice(0, limit);
			if (entries.length === 0) {
				console.log("No memory entries.");
				return;
			}
			const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
			console.log(`${"ID".padEnd(idWidth)}  ${"Date".padEnd(16)}  Content`);
			console.log("-".repeat(idWidth + 20 + 40));
			for (const e of entries) {
				const snippet = e.content.replace(/\n/g, " ").slice(0, 60);
				console.log(`${e.id.padEnd(idWidth)}  ${formatDate(e.created)}  ${snippet}`);
			}
		});

	memCmd
		.command("search <query>")
		.description("Search memory entries by keyword")
		.option("--tag <tag>", "Filter by tag")
		.option("--since <date>", "Only entries after date (ISO 8601)")
		.action((query: string, opts: { tag?: string; since?: string }) => {
			const store = getMemoryStore();
			const results = store.search(query, { tag: opts.tag, since: opts.since });
			if (results.length === 0) {
				console.log("No matching memories.");
				return;
			}
			const idWidth = Math.max(...results.map((e) => e.id.length), 2);
			console.log(`${"ID".padEnd(idWidth)}  ${"Date".padEnd(16)}  Content`);
			console.log("-".repeat(idWidth + 20 + 40));
			for (const e of results) {
				const snippet = e.content.replace(/\n/g, " ").slice(0, 60);
				console.log(`${e.id.padEnd(idWidth)}  ${formatDate(e.created)}  ${snippet}`);
			}
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
			const store = getMemoryStore();
			const id = store.save(content, opts.tag);
			console.log(id);
		});

	memCmd
		.command("delete <id>")
		.description("Delete a memory entry by ID")
		.action((id: string) => {
			const store = getMemoryStore();
			const ok = store.delete(id);
			if (!ok) {
				console.error(`Memory "${id}" not found.`);
				process.exit(1);
			}
			console.log(`Deleted memory ${id}.`);
		});

	memCmd
		.command("reindex")
		.description(
			"Rebuild the semantic search index for all memory entries. " +
				"No-op when no embedding provider is configured.",
		)
		.action(async () => {
			const provider = getMemoryProvider();
			const result = await provider.reindex();
			if (result.skipped) {
				console.log(
					"Semantic search not configured — nothing to reindex. " +
						"Set `providers.memory` to an embedding-capable provider to enable.",
				);
				return;
			}
			console.log(
				`Reindexed ${result.indexed} entries (${result.failed} failed).`,
			);
			if (result.failed > 0) process.exit(1);
		});
}
