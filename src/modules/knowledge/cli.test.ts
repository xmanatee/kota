import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { parseImportEntries, registerKnowledgeCommands } from "./cli.js";
import { KnowledgeStore, resetKnowledgeStore } from "./store.js";

function makeProjectDir(): string {
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
	registerKnowledgeCommands(program);
	return program;
}

describe("kota knowledge add", () => {
	let projectDir: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		projectDir = makeProjectDir();
		origCwd = process.cwd();
		process.chdir(projectDir);
		resetKnowledgeStore();
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(projectDir);
		reg.register("knowledge", "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(projectDir, { recursive: true, force: true });
		resetKnowledgeStore();
		resetProviderRegistry();
	});

	it("creates an entry with --content and prints the ID", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync([
			"node",
			"kota",
			"knowledge",
			"add",
			"--title",
			"My Note",
			"--content",
			"body text",
		]);
		expect(logSpy).toHaveBeenCalledTimes(1);
		const id = logSpy.mock.calls[0][0] as string;
		logSpy.mockRestore();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("applies --type, --tag, --status, and --scope flags", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		let id: string;
		try {
			await makeKnowledgeProgram().parseAsync([
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
				"project",
			]);
			id = logSpy.mock.calls[0][0] as string;
		} finally {
			logSpy.mockRestore();
		}
		const entry = store.read(id!);
		expect(entry).not.toBeNull();
		expect(entry!.type).toBe("reference");
		expect(entry!.tags).toEqual(["foo", "bar"]);
		expect(entry!.status).toBe("archived");
	});

	it("rejects invalid scope", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		try {
			await makeKnowledgeProgram().parseAsync([
				"node", "kota", "knowledge", "add",
				"--title", "X", "--content", "Y", "--scope", "badscope",
			]);
		} catch { /* expected */ }
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid scope"));
		errSpy.mockRestore();
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
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		let id: string;
		try {
			await makeKnowledgeProgram().parseAsync([
				"node",
				"kota",
				"knowledge",
				"add",
				"--title",
				"Piped",
			]);
			id = logSpy.mock.calls[0][0] as string;
		} finally {
			logSpy.mockRestore();
			stdinSpy.mockRestore();
		}
		const entry = store.read(id!);
		expect(entry).not.toBeNull();
		expect(entry!.content).toBe("piped body");
		expect(entry!.title).toBe("Piped");
	});
});

describe("kota knowledge export", () => {
	let projectDir: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		projectDir = makeProjectDir();
		origCwd = process.cwd();
		process.chdir(projectDir);
		resetKnowledgeStore();
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(projectDir);
		reg.register("knowledge", "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(projectDir, { recursive: true, force: true });
		resetKnowledgeStore();
		resetProviderRegistry();
	});

	function seedEntries() {
		store.create({ title: "Alpha", content: "alpha body", type: "note", tags: ["a"], status: "active" });
		store.create({ title: "Beta", content: "beta body", type: "reference", tags: ["b"], status: "archived" });
		store.create({ title: "Gamma", content: "gamma body", type: "note", tags: ["a", "c"], status: "active" });
	}

	it("exports all entries as JSONL by default", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export"]);
		expect(logSpy).toHaveBeenCalledTimes(3);
		for (const call of logSpy.mock.calls) {
			const obj = JSON.parse(call[0] as string);
			expect(obj).toHaveProperty("title");
			expect(obj).toHaveProperty("body");
			expect(obj).toHaveProperty("tags");
		}
		logSpy.mockRestore();
	});

	it("exports as JSON array with --format json", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--format", "json"]);
		expect(logSpy).toHaveBeenCalledTimes(1);
		const arr = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(Array.isArray(arr)).toBe(true);
		expect(arr).toHaveLength(3);
		logSpy.mockRestore();
	});

	it("filters by --type", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--type", "reference"]);
		expect(logSpy).toHaveBeenCalledTimes(1);
		const obj = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(obj.type).toBe("reference");
		logSpy.mockRestore();
	});

	it("filters by --status", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--status", "archived"]);
		expect(logSpy).toHaveBeenCalledTimes(1);
		const obj = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(obj.title).toBe("Beta");
		logSpy.mockRestore();
	});

	it("filters by --tag", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--tag", "c"]);
		expect(logSpy).toHaveBeenCalledTimes(1);
		const obj = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(obj.title).toBe("Gamma");
		logSpy.mockRestore();
	});

	it("round-trips through export then import", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--format", "json"]);
		const exported = logSpy.mock.calls[0][0] as string;
		logSpy.mockRestore();

		const parsed = parseImportEntries(exported);
		expect(parsed).toHaveLength(3);
		for (const entry of parsed) {
			expect(typeof entry.title).toBe("string");
			expect(typeof entry.body).toBe("string");
			expect(Array.isArray(entry.tags)).toBe(true);
		}

		const newDir = makeProjectDir();
		process.chdir(newDir);
		resetProviderRegistry();
		const reg2 = initProviderRegistry();
		const store2 = new KnowledgeStore(newDir);
		reg2.register("knowledge", "knowledge", store2);
		for (const entry of parsed) {
			store2.create({
				title: entry.title as string,
				content: entry.body as string,
				tags: entry.tags as string[],
			});
		}
		const all = store2.list();
		expect(all).toHaveLength(3);
		const titles = all.map((e) => e.title).sort();
		expect(titles).toEqual(["Alpha", "Beta", "Gamma"]);
		rmSync(newDir, { recursive: true, force: true });
	});

	it("JSONL round-trips through parseImportEntries", async () => {
		seedEntries();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--format", "jsonl"]);
		const lines = logSpy.mock.calls.map((c) => c[0] as string).join("\n");
		logSpy.mockRestore();

		const parsed = parseImportEntries(lines);
		expect(parsed).toHaveLength(3);
		for (const entry of parsed) {
			expect(typeof entry.title).toBe("string");
			expect(typeof entry.body).toBe("string");
		}
	});

	it("produces empty output when no entries exist", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export"]);
		expect(logSpy).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("rejects invalid format", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
		try {
			await makeKnowledgeProgram().parseAsync(["node", "kota", "knowledge", "export", "--format", "csv"]);
		} catch { /* expected */ }
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid format"));
		errSpy.mockRestore();
		exitSpy.mockRestore();
	});
});

describe("kota knowledge search", () => {
	let projectDir: string;
	let origCwd: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		projectDir = makeProjectDir();
		origCwd = process.cwd();
		process.chdir(projectDir);
		resetKnowledgeStore();
		resetProviderRegistry();
		const reg = initProviderRegistry();
		store = new KnowledgeStore(projectDir);
		reg.register("knowledge", "knowledge", store);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(projectDir, { recursive: true, force: true });
		resetKnowledgeStore();
		resetProviderRegistry();
	});

	it("routes --semantic searches through the active provider semanticSearch", async () => {
		store.create({ title: "Semantic Note", content: "hello semantic knowledge" });
		vi.spyOn(store, "supportsSemanticSearch").mockReturnValue(true);
		const semanticSearch = vi.spyOn(store, "semanticSearch").mockResolvedValue(store.list());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await makeKnowledgeProgram().parseAsync([
				"node", "kota", "knowledge", "search", "hello",
				"--semantic",
				"--limit", "4",
			]);
		} finally {
			logSpy.mockRestore();
		}

		expect(semanticSearch).toHaveBeenCalledWith(
			"hello",
			4,
			{ tag: undefined, type: undefined, status: undefined },
		);
	});
});
