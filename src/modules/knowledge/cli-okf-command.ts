import type { Command } from "commander";
import { ensureCliProvidersFor } from "#core/modules/cli-providers.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { line, plain, span } from "#modules/rendering/primitives.js";
import { print, printToStderr } from "#modules/rendering/transport.js";
import {
	buildOkfImportPlan,
	exportOkfBundle,
	OkfBundleError,
	type OkfIssue,
	readOkfBundle,
	validateOkfBundle,
} from "./okf.js";

export function registerKnowledgeOkfCommand(
	kCmd: Command,
	ctx: ModuleContext,
): void {
	const okf = kCmd
		.command("okf")
		.description("Import, export, and validate Open Knowledge Format bundles");

	okf
		.command("validate <bundle>")
		.description("Validate an OKF bundle directory")
		.action((bundle: string) => {
			const result = validateOkfBundle(bundle);
			if (!result.ok) {
				printOkfIssues(result.errors);
				process.exit(1);
			}
			print(line(
				plain("OKF bundle valid: "),
				span(String(result.bundle.concepts.length), "success"),
				plain(" concepts, "),
				span(String(result.bundle.reservedFiles.length), "muted"),
				plain(" reserved files."),
			));
		});

	okf
		.command("import <bundle>")
		.description("Import an OKF bundle into the knowledge store")
		.option("--scope <scope>", "Storage scope: scope or global", "scope")
		.option("--status <status>", "Entry status for imported entries", "active")
		.action(async (bundle: string, opts: { scope: string; status: string }) => {
			await ensureCliProvidersFor(["knowledge"]);
			if (opts.scope !== "scope" && opts.scope !== "global") {
				printToStderr(line(span(`Invalid scope "${opts.scope}". Use "scope" or "global".`, "error")));
				process.exit(1);
			}
			try {
				const okfBundle = readOkfBundle(bundle);
				const existing = await ctx.client.knowledge.list({ scope: "all" });
				const plan = buildOkfImportPlan(okfBundle, existing.entries, {
					status: opts.status,
				});
				for (const entry of plan.entries) {
					await ctx.client.knowledge.add({
						title: entry.title,
						content: entry.content,
						type: entry.type,
						tags: entry.tags,
						status: entry.status,
						scope: opts.scope as "scope" | "global",
						meta: entry.meta,
					});
				}
				const reindex = await ctx.client.knowledge.reindex();
				print(line(
					plain("Imported "),
					span(String(plan.entries.length), "success"),
					plain(" OKF concepts"),
					plan.lossy.length > 0
						? span(` (${plan.lossy.length} lossy metadata fields)`, "warn")
						: plain(""),
					plain("."),
				));
					if (!reindex.ok) {
						print(line(plain("Semantic reindex unavailable: provider is not embedding-backed.")));
				} else {
					print(line(
						plain("Semantic reindex: "),
						span(String(reindex.indexed), "success"),
						plain(" indexed, "),
						span(String(reindex.failed), reindex.failed > 0 ? "error" : "muted"),
						plain(" failed."),
					));
				}
				for (const item of plan.lossy) {
					print(line(
						span("Lossy", "warn"),
						plain(` ${item.conceptId} ${item.field}: ${item.reason}`),
					));
				}
			} catch (err) {
				printCaughtOkfError(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			}
		});

	okf
		.command("export <dir>")
		.description("Export selected knowledge entries as an OKF bundle")
		.option("--type <type>", "Filter by type")
		.option("--status <status>", "Filter by status")
		.option("--tag <tag>", "Filter by tag")
		.option("--scope <scope>", "Storage scope: scope, global, or all", "scope")
		.action(async (
			dir: string,
			opts: { type?: string; status?: string; tag?: string; scope: string },
		) => {
			await ensureCliProvidersFor(["knowledge"]);
			if (opts.scope !== "scope" && opts.scope !== "global" && opts.scope !== "all") {
				printToStderr(line(span(`Invalid scope "${opts.scope}". Use "scope", "global", or "all".`, "error")));
				process.exit(1);
			}
			try {
				const result = await ctx.client.knowledge.list({
					type: opts.type,
					status: opts.status,
					tag: opts.tag,
					scope: opts.scope as "scope" | "global" | "all",
				});
				const exported = exportOkfBundle({
					outputDir: dir,
					entries: result.entries,
				});
				print(line(
					plain("Exported "),
					span(String(exported.count), "success"),
					plain(" knowledge entries to OKF bundle."),
				));
				for (const item of exported.lossy) {
					print(line(
						span("Lossy", "warn"),
						plain(` ${item.conceptId} ${item.field}: ${item.reason}`),
					));
				}
			} catch (err) {
				printCaughtOkfError(err instanceof Error ? err : new Error(String(err)));
				process.exit(1);
			}
		});
}

function printCaughtOkfError(err: Error): void {
	if (err instanceof OkfBundleError) {
		printOkfIssues(err.issues);
		return;
	}
	printToStderr(line(span(err.message, "error")));
}

function printOkfIssues(issues: OkfIssue[]): void {
	for (const issue of issues) {
		printToStderr(line(span(`${issue.path}: ${issue.message}`, "error")));
	}
}
