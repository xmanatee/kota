import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKnowledgeStore } from "../../core/memory/knowledge-store.js";
import { registerKnowledgeCommands } from "./cli.js";

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

	beforeEach(() => {
		projectDir = makeProjectDir();
		origCwd = process.cwd();
		process.chdir(projectDir);
		resetKnowledgeStore();
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(projectDir, { recursive: true, force: true });
		resetKnowledgeStore();
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
		resetKnowledgeStore();
		const { getKnowledgeStore } = await import("../../core/memory/knowledge-store.js");
		const store = getKnowledgeStore(projectDir);
		const entry = store.read(id!);
		expect(entry).not.toBeNull();
		expect(entry!.type).toBe("reference");
		expect(entry!.tags).toEqual(["foo", "bar"]);
		expect(entry!.status).toBe("archived");
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
		resetKnowledgeStore();
		const { getKnowledgeStore } = await import("../../core/memory/knowledge-store.js");
		const store = getKnowledgeStore(projectDir);
		const entry = store.read(id!);
		expect(entry).not.toBeNull();
		expect(entry!.content).toBe("piped body");
		expect(entry!.title).toBe("Piped");
	});
});
