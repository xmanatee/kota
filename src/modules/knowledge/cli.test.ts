import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
	getProviderRegistry,
	initProviderRegistry,
	KNOWLEDGE_PROVIDER_TOKEN,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import type { KnowledgeProvider } from "#core/modules/provider-types.js";
import { registerKnowledgeCommands } from "./cli.js";
import knowledgeModule from "./index.js";
import { KnowledgeStore } from "./store.js";

function stubCtx(): ModuleContext {
  const ctx = {
    cwd: process.cwd(),
    getProvider: (token: Parameters<ModuleContext["getProvider"]>[0]) => getProviderRegistry()?.get(token),
  } as ModuleContext;
  return { ...ctx, client: knowledgeModule.localClient!(ctx) } as ModuleContext;
}

function makeScopeRoot(): string {
	const dir = join(
		tmpdir(),
		`kota-knowledge-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return realpathSync(dir);
}

function makeKnowledgeProgram(): Command {
	const program = new Command();
	program.exitOverride();
	registerKnowledgeCommands(program, stubCtx());
	return program;
}

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

async function captureStderr(fn: () => Promise<unknown>): Promise<string> {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
		chunks.push(String(data));
		return true;
	});
	try {
		await fn();
	} catch {
		// Expected in tests that mock process.exit for validation failures.
	} finally {
		spy.mockRestore();
	}
	return chunks.join("");
}

describe("kota knowledge add", () => {
	let scopeRoot: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		scopeRoot = makeScopeRoot();
		origCwd = process.cwd();
		process.chdir(scopeRoot);
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(scopeRoot);
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(scopeRoot, { recursive: true, force: true });
		resetProviderRegistry();
	});

	it("creates an entry with --content and prints the ID", async () => {
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync([
			"node",
			"kota",
			"knowledge",
			"add",
			"--title",
			"My Note",
			"--content",
			"body text",
		]));
		const id = output.trim();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("applies --type, --tag, --status, and --scope flags", async () => {
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync([
			"node",
			"kota",
			"knowledge",
			"add",
			"--title",
			"Tagged Entry",
			"--content",
			"content here",
			"--type",
			"reference",
			"--tag",
			"foo",
			"--tag",
			"bar",
			"--status",
			"archived",
			"--scope",
			"scope",
		]));
		const id = output.trim();
		const entry = store.read(id!);
		expect(entry).not.toBeNull();
		expect(entry!.type).toBe("reference");
		expect(entry!.tags).toEqual(["foo", "bar"]);
		expect(entry!.status).toBe("archived");
	});

	it("rejects invalid scope", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		let err = "";
		try {
			err = await captureStderr(() => makeKnowledgeProgram().parseAsync([
				"node", "kota", "knowledge", "add",
				"--title", "X", "--content", "Y", "--scope", "badscope",
			]));
		} catch { /* expected */ }
		expect(err).toContain("Invalid scope");
		exitSpy.mockRestore();
	});

	it("reads content from stdin when --content is omitted", async () => {
		const stdinContent = "piped body\n";
		const mockStdin = {
			[Symbol.asyncIterator]: async function* () {
				yield Buffer.from(stdinContent);
			},
		};
		const stdinSpy = vi.spyOn(process, "stdin", "get").mockReturnValue(
			mockStdin as unknown as typeof process.stdin,
		);
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync([
			"node",
			"kota",
			"knowledge",
			"add",
			"--title",
			"Piped",
		]));
		const id = output.trim();
		stdinSpy.mockRestore();
		const entry = store.read(id!);
		expect(entry).not.toBeNull();
		expect(entry!.content).toBe("piped body");
		expect(entry!.title).toBe("Piped");
	});
});

describe("kota knowledge export", () => {
	let scopeRoot: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		scopeRoot = makeScopeRoot();
		origCwd = process.cwd();
		process.chdir(scopeRoot);
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(scopeRoot);
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(scopeRoot, { recursive: true, force: true });
		resetProviderRegistry();
	});

	function seedEntries() {
		store.create({ title: "Alpha", content: "alpha body", type: "note", tags: ["a"], status: "active" });
		store.create({ title: "Beta", content: "beta body", type: "reference", tags: ["b"], status: "archived" });
		store.create({ title: "Gamma", content: "gamma body", type: "note", tags: ["a", "c"], status: "active" });
	}

	it("exports all entries as JSONL by default", async () => {
		seedEntries();
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export"]));
		const lines = output.trim().split("\n");
		expect(lines).toHaveLength(3);
		for (const line of lines) {
			const obj = JSON.parse(line);
			expect(obj).toHaveProperty("title");
			expect(obj).toHaveProperty("body");
			expect(obj).toHaveProperty("tags");
		}
	});

	it("exports as JSON array with --format json", async () => {
		seedEntries();
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--format", "json"]));
		const arr = JSON.parse(output);
		expect(Array.isArray(arr)).toBe(true);
		expect(arr).toHaveLength(3);
	});

	it("filters by --type", async () => {
		seedEntries();
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--type", "reference"]));
		const lines = output.trim().split("\n");
		expect(lines).toHaveLength(1);
		const obj = JSON.parse(lines[0]!);
		expect(obj.type).toBe("reference");
	});

	it("filters by --status", async () => {
		seedEntries();
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--status", "archived"]));
		const lines = output.trim().split("\n");
		expect(lines).toHaveLength(1);
		const obj = JSON.parse(lines[0]!);
		expect(obj.title).toBe("Beta");
	});

	it("filters by --tag", async () => {
		seedEntries();
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--tag", "c"]));
		const lines = output.trim().split("\n");
		expect(lines).toHaveLength(1);
		const obj = JSON.parse(lines[0]!);
		expect(obj.title).toBe("Gamma");
	});

	it("produces empty output when no entries exist", async () => {
		const output = await captureStdout(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export"]));
		expect(output).toBe("");
	});

	it("rejects invalid format", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		let err = "";
		try {
			err = await captureStderr(() => makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--format", "csv"]));
		} catch { /* expected */ }
		expect(err).toContain("Invalid format");
		exitSpy.mockRestore();
	});
});

describe("kota knowledge search", () => {
	let scopeRoot: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		scopeRoot = makeScopeRoot();
		origCwd = process.cwd();
		process.chdir(scopeRoot);
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(scopeRoot);
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(scopeRoot, { recursive: true, force: true });
		resetProviderRegistry();
	});

	it("routes --semantic searches through the active provider semanticSearch", async () => {
		store.create({ title: "Semantic Note", content: "hello semantic knowledge" });
		const semanticSearch = vi.fn(async () => store.list());
		const provider: KnowledgeProvider = {
			create: store.create.bind(store),
			read: store.read.bind(store),
			update: store.update.bind(store),
			delete: store.delete.bind(store),
			search: store.search.bind(store),
			list: store.list.bind(store),
			count: store.count.bind(store),
			semanticSearchCapability: {
				semanticSearch,
				reindex: async () => ({ indexed: 1, failed: 0 }),
			},
		};
		const registry = initProviderRegistry();
		registry.register(KNOWLEDGE_PROVIDER_TOKEN, "semantic", provider);
		registry.setActive(KNOWLEDGE_PROVIDER_TOKEN, "semantic");
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			await makeKnowledgeProgram().parseAsync([
				"node", "kota", "knowledge", "search", "hello",
				"--semantic",
				"--limit", "4",
			]);
		} finally {
			stdoutSpy.mockRestore();
		}

		expect(semanticSearch).toHaveBeenCalledWith(
			"hello",
			4,
			{ tag: undefined, type: undefined, status: undefined, scope: undefined },
		);
	});
});
