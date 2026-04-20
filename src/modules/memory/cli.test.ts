import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { registerMemoryCommands } from "./cli.js";
import { getMemoryStore, resetMemoryStore } from "./store.js";

function makeProjectDir(): string {
	const dir = join(
		tmpdir(),
		`kota-memory-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return realpathSync(dir);
}

function makeMemoryProgram(): Command {
	const program = new Command();
	program.exitOverride();
	registerMemoryCommands(program);
	return program;
}

describe("kota memory add", () => {
	let storeDir: string;

	beforeEach(() => {
		storeDir = makeProjectDir();
		resetMemoryStore();
		resetProviderRegistry();
		const reg = initProviderRegistry();
		reg.register("memory", "memory", getMemoryStore(storeDir));
	});

	afterEach(() => {
		resetMemoryStore();
		resetProviderRegistry();
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("creates an entry with --content and prints the ID", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeMemoryProgram().parseAsync(["node", "kota", "memory", "add", "--content", "hello world"]);
		expect(logSpy).toHaveBeenCalledTimes(1);
		const id = logSpy.mock.calls[0][0] as string;
		logSpy.mockRestore();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
		const entry = getMemoryStore(storeDir).list().find((m) => m.id === id);
		expect(entry).toBeDefined();
		expect(entry!.content).toBe("hello world");
	});

	it("applies --tag flags", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeMemoryProgram().parseAsync([
			"node", "kota", "memory", "add",
			"--content", "tagged note",
			"--tag", "alpha",
			"--tag", "beta",
		]);
		const id = logSpy.mock.calls[0][0] as string;
		logSpy.mockRestore();
		const entry = getMemoryStore(storeDir).list().find((m) => m.id === id);
		expect(entry).toBeDefined();
		expect(entry!.tags).toEqual(["alpha", "beta"]);
	});

	it("reads content from stdin when --content is omitted", async () => {
		const stdinContent = "piped note\n";
		const mockStdin = {
			[Symbol.asyncIterator]: async function* () {
				yield Buffer.from(stdinContent);
			},
		};
		const stdinSpy = vi.spyOn(process, "stdin", "get").mockReturnValue(
			mockStdin as unknown as typeof process.stdin,
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await makeMemoryProgram().parseAsync(["node", "kota", "memory", "add"]);
		const id = logSpy.mock.calls[0][0] as string;
		logSpy.mockRestore();
		stdinSpy.mockRestore();
		const entry = getMemoryStore(storeDir).list().find((m) => m.id === id);
		expect(entry).toBeDefined();
		expect(entry!.content).toBe("piped note");
	});
});

describe("kota memory search", () => {
	let storeDir: string;

	beforeEach(() => {
		storeDir = makeProjectDir();
		resetMemoryStore();
		getMemoryStore(storeDir);
	});

	afterEach(() => {
		resetMemoryStore();
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("routes --semantic searches through the active provider semanticSearch", async () => {
		const store = getMemoryStore(storeDir);
		store.save("hello semantic memory");
		vi.spyOn(store, "supportsSemanticSearch").mockReturnValue(true);
		const semanticSearch = vi.spyOn(store, "semanticSearch").mockResolvedValue(store.list());
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await makeMemoryProgram().parseAsync([
				"node", "kota", "memory", "search", "hello",
				"--semantic",
				"--limit", "3",
			]);
		} finally {
			logSpy.mockRestore();
		}

		expect(semanticSearch).toHaveBeenCalledWith(
			"hello",
			3,
			{ tag: undefined, since: undefined },
		);
	});
});
