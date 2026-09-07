import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
	getProviderRegistry,
	initProviderRegistry,
	MEMORY_PROVIDER_TOKEN,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import type { MemoryProvider } from "#core/modules/provider-types.js";
import { registerMemoryCommands } from "./cli.js";
import memoryModule from "./index.js";
import { MemoryStore } from "./store.js";

function stubCtx(): ModuleContext {
  const ctx = {
    cwd: process.cwd(),
    getProvider: (token: Parameters<ModuleContext["getProvider"]>[0]) => getProviderRegistry()?.get(token),
  } as ModuleContext;
  return { ...ctx, client: memoryModule.localClient!(ctx) } as ModuleContext;
}

function makeScopeRoot(): string {
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
	registerMemoryCommands(program, stubCtx());
	return program;
}

function captureStdout() {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
		chunks.push(String(data));
		return true;
	});
	return {
		text: () => chunks.join(""),
		restore: () => spy.mockRestore(),
	};
}

describe("kota memory add", () => {
	let storeDir: string;

	beforeEach(() => {
		storeDir = makeScopeRoot();
		resetProviderRegistry();
		const reg = initProviderRegistry();
		reg.register(MEMORY_PROVIDER_TOKEN, "memory", new MemoryStore(storeDir));
	});

	afterEach(() => {
		resetProviderRegistry();
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("creates an entry with --content and prints the ID", async () => {
		const stdout = captureStdout();
		await makeMemoryProgram().parseAsync(["node", "kota", "memory", "add", "--content", "hello world"]);
		const id = stdout.text().trim();
		stdout.restore();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
		const entry = new MemoryStore(storeDir).list().find((m) => m.id === id);
		expect(entry).toBeDefined();
		expect(entry!.content).toBe("hello world");
	});

	it("applies --tag flags", async () => {
		const stdout = captureStdout();
		await makeMemoryProgram().parseAsync([
			"node", "kota", "memory", "add",
			"--content", "tagged note",
			"--tag", "alpha",
			"--tag", "beta",
		]);
		const id = stdout.text().trim();
		stdout.restore();
		const entry = new MemoryStore(storeDir).list().find((m) => m.id === id);
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
		const stdout = captureStdout();
		await makeMemoryProgram().parseAsync(["node", "kota", "memory", "add"]);
		const id = stdout.text().trim();
		stdout.restore();
		stdinSpy.mockRestore();
		const entry = new MemoryStore(storeDir).list().find((m) => m.id === id);
		expect(entry).toBeDefined();
		expect(entry!.content).toBe("piped note");
	});
});

describe("kota memory search", () => {
	let storeDir: string;

	beforeEach(() => {
		storeDir = makeScopeRoot();
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("routes --semantic searches through the active provider semanticSearch", async () => {
		const store = new MemoryStore(storeDir);
		store.save("hello semantic memory");
		const semanticSearch = vi.fn(async () => store.list());
		const provider: MemoryProvider = {
			save: store.save.bind(store),
			search: store.search.bind(store),
			list: store.list.bind(store),
			update: store.update.bind(store),
			delete: store.delete.bind(store),
			semanticSearchCapability: {
				semanticSearch,
				reindex: async () => ({ indexed: 1, failed: 0 }),
			},
		};
		const registry = initProviderRegistry();
		registry.register(MEMORY_PROVIDER_TOKEN, "semantic", provider);
		registry.setActive(MEMORY_PROVIDER_TOKEN, "semantic");
		const stdout = captureStdout();
		try {
			await makeMemoryProgram().parseAsync([
				"node", "kota", "memory", "search", "hello",
				"--semantic",
				"--limit", "3",
			]);
		} finally {
			stdout.restore();
		}

		expect(semanticSearch).toHaveBeenCalledWith(
			"hello",
			3,
			{ tag: undefined, since: undefined },
		);
	});
});
