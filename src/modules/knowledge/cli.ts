import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { formatWorkMemoryMetadata } from "#core/modules/work-memory-metadata.js";
import {
	blank,
	kvBlock,
	line,
	plain,
	span,
} from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson, writeStdoutLine } from "#modules/rendering/transport.js";
import { registerKnowledgeImportCommand } from "./cli-import-command.js";
import { registerKnowledgeOkfCommand } from "./cli-okf-command.js";
import {
	buildKnowledgeListNode,
	buildKnowledgeSearchNode,
	knowledgeStatusRole,
	toKnowledgeRow,
} from "./list-nodes.js";

export { parseImportEntries } from "./import.js";
export { buildKnowledgeListNode, buildKnowledgeSearchNode } from "./list-nodes.js";

export function registerKnowledgeCommands(
	program: Command,
	ctx: ModuleContext,
): void {
	const kCmd = program
		.command("knowledge")
		.description("Inspect and manage the scope knowledge store");

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
			print(buildKnowledgeListNode(entries.map(toKnowledgeRow)));
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
				printToStderr(line(span("Semantic knowledge search requires an embedding-backed knowledge provider.", "error")));
				process.exit(1);
			}
			if (result.entries.length === 0) {
				print(line(plain("No matching knowledge entries.")));
				return;
			}
			print(buildKnowledgeSearchNode(result.entries.map(toKnowledgeRow)));
		});

	kCmd
		.command("show <id>")
		.description("Print a single knowledge entry")
		.action(async (id: string) => {
			await ensureCliProvidersFor(["knowledge"]);
			const result = await ctx.client.knowledge.show(id);
			if (!result.found) {
				printToStderr(line(span(`Knowledge entry "${id}" not found.`, "error")));
				process.exit(1);
			}
			const entry = result.entry;
			const meta = Object.entries(entry.meta).map(([k, v]) => ({
				label: k,
				value: String(v),
				role: "muted" as const,
			}));
			const workMemoryMetadata = formatWorkMemoryMetadata({
				...(entry.provenance && { provenance: entry.provenance }),
				...(entry.freshness && { freshness: entry.freshness }),
			});
			print(kvBlock([
				{ label: "ID", value: entry.id, role: "accent" },
				{ label: "Title", value: entry.title },
				{ label: "Type", value: entry.type, role: "info" },
				{ label: "Status", value: entry.status, role: knowledgeStatusRole(entry.status) },
				{ label: "Tags", value: entry.tags.join(", ") || "(none)", role: "muted" },
				{ label: "Created", value: entry.created, role: "muted" },
				{ label: "Updated", value: entry.updated, role: "muted" },
				...(workMemoryMetadata
					? [
							{
								label: "Work Memory",
								value: workMemoryMetadata,
								role: "muted" as const,
							},
						]
					: []),
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
		.option("--scope <scope>", "Storage scope: scope or global", "scope")
		.action(async (opts: { title: string; content?: string; type: string; tag: string[]; status: string; scope: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			if (opts.scope !== "scope" && opts.scope !== "global") {
				printToStderr(line(span(`Invalid scope "${opts.scope}". Use "scope" or "global".`, "error")));
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
				scope: opts.scope as "scope" | "global",
			});
			writeStdoutLine(result.id);
		});

	kCmd
		.command("delete <id>")
		.description("Delete a knowledge entry by ID")
		.action(async (id: string) => {
			await ensureCliProvidersFor(["knowledge"]);
			const result = await ctx.client.knowledge.delete(id);
			if (!result.ok) {
				printToStderr(line(span(`Knowledge entry "${id}" not found.`, "error")));
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
		.option("--scope <scope>", "Storage scope: scope, global, or all", "scope")
		.option("--format <fmt>", "Output format: json or jsonl", "jsonl")
		.action(async (opts: { type?: string; status?: string; tag?: string; scope: string; format: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			if (opts.scope !== "scope" && opts.scope !== "global" && opts.scope !== "all") {
				printToStderr(line(span(`Invalid scope "${opts.scope}". Use "scope", "global", or "all".`, "error")));
				process.exit(1);
			}
			if (opts.format !== "json" && opts.format !== "jsonl") {
				printToStderr(line(span(`Invalid format "${opts.format}". Use "json" or "jsonl".`, "error")));
				process.exit(1);
			}
			const result = await ctx.client.knowledge.list({
				type: opts.type,
				status: opts.status,
				tag: opts.tag,
				scope: opts.scope as "scope" | "global" | "all",
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
				writeJson(exported, { pretty: true });
			} else {
				for (const entry of exported) {
					writeJson(entry);
				}
			}
		});

	kCmd
		.command("reindex")
			.description(
				"Rebuild the semantic search index for all knowledge entries. " +
					"Reports when no embedding provider is configured.",
		)
		.action(async () => {
			await ensureCliProvidersFor(["knowledge"]);
			const result = await ctx.client.knowledge.reindex();
				if (!result.ok) {
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

	registerKnowledgeImportCommand(kCmd, ctx);
	registerKnowledgeOkfCommand(kCmd, ctx);
}
