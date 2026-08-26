import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
	initProviderRegistry,
	KNOWLEDGE_PROVIDER_TOKEN,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { registerKnowledgeOkfCommand } from "./cli-okf-command.js";
import { KnowledgeStore, resetKnowledgeStore } from "./store.js";

describe("kota knowledge okf", () => {
	let scopeRoot: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		scopeRoot = realpathSync(mkdtempSync(join(tmpdir(), "kota-knowledge-okf-cli-")));
		origCwd = process.cwd();
		process.chdir(scopeRoot);
		resetKnowledgeStore();
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(scopeRoot);
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(scopeRoot, { recursive: true, force: true });
		resetKnowledgeStore();
		resetProviderRegistry();
	});

	it("imports an OKF bundle through the knowledge client and reindexes afterward", async () => {
		const bundleDir = join(scopeRoot, "bundle");
		mkdirSync(bundleDir, { recursive: true });
		writeFileSync(
			join(bundleDir, "playbook.md"),
			[
				"---",
				"type: Playbook",
				"title: Incident Playbook",
				"description: Triage steps.",
				"tags: [incident]",
				"---",
				"# Steps",
				"Check the dashboard.",
				"",
			].join("\n"),
			"utf-8",
		);
		const output = await captureStdout(() =>
			makeKnowledgeProgram().parseAsync([
				"node",
				"kota",
				"knowledge",
				"okf",
				"import",
				bundleDir,
			]),
		);

		expect(output).toContain("Imported 1 OKF concepts");
		const entries = store.list();
		expect(entries).toHaveLength(1);
		expect(entries[0]!.title).toBe("Incident Playbook");
		expect(entries[0]!.meta.okf_concept_id).toBe("playbook");
		expect(entries[0]!.meta.description).toBe("Triage steps.");
	});

	function makeKnowledgeProgram(): Command {
		const program = new Command();
		program.exitOverride();
		const knowledge = program
			.command("knowledge")
			.description("Inspect and manage the project knowledge store");
		registerKnowledgeOkfCommand(knowledge, stubCtx());
		return program;
	}

	function stubCtx(): ModuleContext {
		return {
			client: {
				knowledge: {
					async list() {
						return { entries: store.list({ scope: "all" }) };
					},
					async add(options) {
						const id = store.create({
							title: options.title,
							content: options.content,
							type: options.type,
							tags: options.tags,
							status: options.status,
							scope: options.scope,
							meta: options.meta,
						});
						return { id };
					},
					async reindex() {
						return { ok: false as const, reason: "semantic_unavailable" as const };
					},
				},
			},
		} as ModuleContext;
	}
});

async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
		chunks.push(String(data));
		return true;
	});
	try {
		await fn();
	} finally {
		spy.mockRestore();
	}
	return chunks.join("");
}
