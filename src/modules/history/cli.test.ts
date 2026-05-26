/**
 * Coverage for `kota history search` — the CLI surface that consumes
 * `/api/history/search` via `ctx.client.history.search`. The tests
 * install a stub `KotaClient` through `setActiveKotaClient` so each
 * branch the daemon route declares (populated, empty, semantic-
 * unavailable, plus the CLI-only empty-query and keyword paths) is
 * exercised against the registered Commander program rather than the
 * real provider stack.
 */

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
import type { ConversationRecord } from "#core/modules/provider-types.js";
import {
	resetActiveKotaClient,
	setActiveKotaClient,
} from "#core/server/client-holder.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import {
	setTerminalTransport,
	TerminalTransport,
} from "#modules/rendering/transport.js";
import {
	resolveExplicitConversationResume,
	resolveRunContinue,
	validateConversationResumeCwd,
} from "./cli.js";
import { registerHistoryCommands } from "./cli-commands.js";
import type {
	HistoryDetail,
	HistoryDiscoveredProjectFilter,
	HistoryListFilter,
	HistorySearchFilter,
	HistorySearchResult,
	HistoryShowOptions,
	HistoryShowResult,
} from "./client.js";
import { listLocalProjectHistoryRecords } from "./local-history-scan.js";

vi.mock("#core/modules/cli-providers.js", () => ({
	ensureCliProvidersFor: vi.fn(async () => {}),
}));

type SearchCall = {
	query: string;
	filter: HistorySearchFilter | undefined;
};

type ListCall = {
	filter: HistoryListFilter | undefined;
};

type SearchStub = {
	calls: SearchCall[];
	respond: (
		query: string,
		filter: HistorySearchFilter | undefined,
	) => HistorySearchResult;
};

type ShowCall = {
	id: string;
	options: HistoryShowOptions | undefined;
};

type ShowStub = {
	calls: ShowCall[];
	respond: (
		id: string,
		options: HistoryShowOptions | undefined,
	) => HistoryShowResult;
};

function makeRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
	return {
		id: "conv-aaa",
		title: "Sample conversation",
		createdAt: "2026-04-01T00:00:00.000Z",
		updatedAt: "2026-04-02T03:04:05.000Z",
		model: "claude-sonnet-4-6",
		messageCount: 3,
		cwd: "/repo",
		source: "user",
		...overrides,
	};
}

function makeWindowDetail(record = makeRecord()): HistoryDetail {
	return {
		view: "window",
		record,
		messages: [
			{
				index: 40,
				role: "user",
				content: "short bounded",
				contentTruncation: {
					maxCharacters: 12,
					originalCharacters: 12,
					truncated: false,
				},
			},
			{
				index: 41,
				role: "assistant",
				content: "long assistant reply",
				contentTruncation: {
					maxCharacters: 12,
					originalCharacters: 240,
					truncated: true,
				},
			},
		],
		compactionCount: 0,
		lastInputTokens: 0,
		contentLimit: 12,
		messageWindow: {
			offset: 40,
			limit: 2,
			total: 205,
			returned: 2,
			hasMoreBefore: true,
			hasMoreAfter: true,
		},
	};
}

function makeMetadataDetail(record = makeRecord()): HistoryDetail {
	return {
		view: "metadata",
		record,
		messageWindow: {
			offset: 0,
			limit: 0,
			total: record.messageCount,
			returned: 0,
			hasMoreBefore: false,
			hasMoreAfter: record.messageCount > 0,
		},
	};
}

function installClient(stub: SearchStub): void {
	const client = {
		history: {
			async search(query: string, filter?: HistorySearchFilter) {
				stub.calls.push({ query, filter });
				return stub.respond(query, filter);
			},
		},
	} as unknown as KotaClient;
	setActiveKotaClient(client);
}

function installShowClient(stub: ShowStub, records: ConversationRecord[]): void {
	const client = {
		history: {
			async list() {
				return { conversations: records };
			},
			async show(id: string, options?: HistoryShowOptions) {
				stub.calls.push({ id, options });
				return stub.respond(id, options);
			},
		},
	} as unknown as KotaClient;
	setActiveKotaClient(client);
}

function makeHistoryClient(records: ConversationRecord[]): {
	client: KotaClient;
	calls: ListCall[];
} {
	const calls: ListCall[] = [];
	const client = {
		history: {
			async list(filter?: HistoryListFilter) {
				calls.push({ filter });
				return { conversations: records };
			},
			async listDiscoveredProjectRecords(
				filter?: HistoryDiscoveredProjectFilter,
			) {
				return {
					conversations: listLocalProjectHistoryRecords({
						cwd: process.cwd(),
						limit: filter?.limit,
					}),
				};
			},
		},
	} as unknown as KotaClient;
	return { client, calls };
}

function captureTransport(): { stdout: string[]; stderr: string[]; restore: () => void } {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const stdoutStream = {
		write(chunk: string): boolean {
			stdoutChunks.push(chunk);
			return true;
		},
		isTTY: false,
		columns: 100,
	};
	setTerminalTransport(
		new TerminalTransport({
			stream: stdoutStream,
			theme: NO_COLOR_THEME,
			width: 100,
		}),
	);
	const stdoutWriteSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: string | Uint8Array) => {
			stdoutChunks.push(
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
			);
			return true;
		});
	const stderrWriteSpy = vi
		.spyOn(process.stderr, "write")
		.mockImplementation((chunk: string | Uint8Array) => {
			stderrChunks.push(
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
			);
			return true;
		});
	return {
		stdout: stdoutChunks,
		stderr: stderrChunks,
		restore: () => {
			setTerminalTransport(null);
			stdoutWriteSpy.mockRestore();
			stderrWriteSpy.mockRestore();
		},
	};
}

function makeProgram(): Command {
	const program = new Command();
	program.exitOverride();
	registerHistoryCommands(program);
	return program;
}

describe("kota history search", () => {
	let stub: SearchStub;
	let captured: ReturnType<typeof captureTransport>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stub = {
			calls: [],
			respond: () => ({ ok: true, conversations: [] }),
		};
		installClient(stub);
		captured = captureTransport();
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: number) => {
				throw new Error(`process.exit:${code ?? 0}`);
			}) as never);
	});

	afterEach(() => {
		captured.restore();
		exitSpy.mockRestore();
		resetActiveKotaClient();
	});

	it("renders per-conversation lines for non-empty results and defaults to semantic", async () => {
		stub.respond = () => ({
			ok: true,
			conversations: [
				makeRecord({ id: "conv-aaa", title: "First chat", messageCount: 7 }),
				makeRecord({
					id: "conv-bbb",
					title: "Second chat",
					updatedAt: "2026-04-03T10:11:12.000Z",
					messageCount: 12,
				}),
			],
		});
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"hello",
		]);
		expect(stub.calls).toHaveLength(1);
		expect(stub.calls[0].query).toBe("hello");
		expect(stub.calls[0].filter?.semantic).toBe(true);
		expect(stub.calls[0].filter?.limit).toBe(20);
		expect(stub.calls[0].filter?.cwd).toBe(process.cwd());
		const out = captured.stdout.join("");
		expect(out).toContain("conv-aaa");
		expect(out).toContain("First chat");
		expect(out).toContain("conv-bbb");
		expect(out).toContain("Second chat");
		expect(out).toContain("2026-04-02 03:04");
		expect(out).toContain("7 msgs");
		expect(out).toContain("12 msgs");
	});

	it("renders the fixed empty-result body when the daemon returns an empty list", async () => {
		stub.respond = () => ({ ok: true, conversations: [] });
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"nothing-matches",
		]);
		expect(stub.calls).toHaveLength(1);
		expect(captured.stdout.join("")).toContain("No matching conversations.");
	});

	it("prints the inline usage hint and skips the request on a whitespace-only query", async () => {
		await expect(
			makeProgram().parseAsync([
				"node",
				"kota",
				"history",
				"search",
				"   ",
			]),
		).rejects.toThrow("process.exit:1");
		expect(stub.calls).toHaveLength(0);
		expect(captured.stderr.join("")).toContain(
			"Usage: kota history search <query>",
		);
	});

	it("surfaces the semantic-unavailable branch explicitly without degrading to keyword", async () => {
		stub.respond = () => ({ ok: false, reason: "semantic_unavailable" });
		await expect(
			makeProgram().parseAsync([
				"node",
				"kota",
				"history",
				"search",
				"hello",
			]),
		).rejects.toThrow("process.exit:1");
		expect(stub.calls).toHaveLength(1);
		expect(stub.calls[0].filter?.semantic).toBe(true);
		expect(captured.stderr.join("")).toContain(
			"Semantic conversation search requires an embedding-backed history provider.",
		);
	});

	it("--keyword routes through the keyword search path", async () => {
		stub.respond = () => ({ ok: true, conversations: [] });
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"hello",
			"--keyword",
		]);
		expect(stub.calls).toHaveLength(1);
		expect(stub.calls[0].filter?.semantic).toBe(false);
	});

	it("--no-semantic also routes through the keyword search path", async () => {
		stub.respond = () => ({ ok: true, conversations: [] });
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"hello",
			"--no-semantic",
		]);
		expect(stub.calls).toHaveLength(1);
		expect(stub.calls[0].filter?.semantic).toBe(false);
	});

	it("--json emits the structured ok:true conversations payload", async () => {
		stub.respond = () => ({
			ok: true,
			conversations: [makeRecord({ id: "conv-json", title: "JSON chat" })],
		});
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"hello",
			"--json",
		]);
		const out = captured.stdout.join("");
		expect(out.trim().endsWith("}")).toBe(true);
		const parsed = JSON.parse(out.trim());
		expect(parsed.ok).toBe(true);
		expect(parsed.conversations).toHaveLength(1);
		expect(parsed.conversations[0].id).toBe("conv-json");
	});

	it("--json emits the structured ok:false reason payload on semantic-unavailable", async () => {
		stub.respond = () => ({ ok: false, reason: "semantic_unavailable" });
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"hello",
			"--json",
		]);
		const out = captured.stdout.join("").trim();
		expect(JSON.parse(out)).toEqual({
			ok: false,
			reason: "semantic_unavailable",
		});
	});

	it("--all clears the cwd filter on the search call", async () => {
		stub.respond = () => ({ ok: true, conversations: [] });
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"search",
			"hello",
			"--all",
		]);
		expect(stub.calls[0].filter?.cwd).toBeUndefined();
	});
});

describe("kota history show", () => {
	let stub: ShowStub;
	let captured: ReturnType<typeof captureTransport>;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let record: ConversationRecord;

	beforeEach(() => {
		record = makeRecord({
			id: "conv-show",
			title: "Long conversation",
			messageCount: 205,
		});
		stub = {
			calls: [],
			respond: () => ({ found: true, detail: makeWindowDetail(record) }),
		};
		installShowClient(stub, [record]);
		captured = captureTransport();
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: number) => {
				throw new Error(`process.exit:${code ?? 0}`);
			}) as never);
	});

	afterEach(() => {
		captured.restore();
		exitSpy.mockRestore();
		resetActiveKotaClient();
	});

	it("defaults to a bounded window and reports window metadata", async () => {
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"show",
			"conv-show",
			"--offset",
			"40",
			"--limit",
			"2",
			"--content-limit",
			"12",
		]);

		expect(stub.calls).toEqual([
			{
				id: "conv-show",
				options: {
					view: "window",
					offset: 40,
					limit: 2,
					contentLimit: 12,
				},
			},
		]);
		const out = captured.stdout.join("");
		expect(out).toContain("Long conversation");
		expect(out).toContain("View");
		expect(out).toContain("window");
		expect(out).toContain("40-41 of 205");
		expect(out).toContain("[40 user]");
		expect(out).toContain("[41 assistant]");
		expect(out).toContain("truncated 12/240");
	});

	it("supports metadata-only display without rendering messages", async () => {
		stub.respond = () => ({ found: true, detail: makeMetadataDetail(record) });
		await makeProgram().parseAsync([
			"node",
			"kota",
			"history",
			"show",
			"conv-show",
			"--view",
			"metadata",
		]);

		expect(stub.calls[0]).toEqual({
			id: "conv-show",
			options: { view: "metadata" },
		});
		const out = captured.stdout.join("");
		expect(out).toContain("metadata");
		expect(out).toContain("0-0 of 205");
		expect(out).not.toContain("[40 user]");
	});

	it("rejects malformed show view input before calling the client", async () => {
		await expect(
			makeProgram().parseAsync([
				"node",
				"kota",
				"history",
				"show",
				"conv-show",
				"--view",
				"bogus",
			]),
		).rejects.toThrow("process.exit:1");
		expect(stub.calls).toHaveLength(0);
		expect(captured.stderr.join("")).toContain(
			"--view must be one of metadata, window, full",
		);
	});

	it("rejects window-only flags for non-window views", async () => {
		await expect(
			makeProgram().parseAsync([
				"node",
				"kota",
				"history",
				"show",
				"conv-show",
				"--view",
				"full",
				"--limit",
				"2",
			]),
		).rejects.toThrow("process.exit:1");
		expect(stub.calls).toHaveLength(0);
		expect(captured.stderr.join("")).toContain(
			"only valid with --view window",
		);
	});
});

describe("conversation resume cwd selection", () => {
	let originalCwd: string;
	let tempDirs: string[];

	beforeEach(() => {
		originalCwd = process.cwd();
		tempDirs = [];
	});

	afterEach(() => {
		process.chdir(originalCwd);
		for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	});

	function tempDir(prefix: string): string {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
		tempDirs.push(dir);
		return dir;
	}

	function tempProjectPair(prefix: string): { callerCwd: string; savedCwd: string } {
		const root = tempDir(`${prefix}root-`);
		const callerCwd = join(root, "caller");
		const savedCwd = join(root, "saved");
		mkdirSync(callerCwd, { recursive: true });
		mkdirSync(savedCwd, { recursive: true });
		return {
			callerCwd: realpathSync(callerCwd),
			savedCwd: realpathSync(savedCwd),
		};
	}

	function seedProjectHistory(
		projectDir: string,
		record: ConversationRecord,
	): void {
		const historyDir = join(projectDir, ".kota", "history");
		mkdirSync(historyDir, { recursive: true });
		writeFileSync(
			join(historyDir, "index.json"),
			JSON.stringify({ conversations: [record] }),
		);
		writeFileSync(
			join(historyDir, `${record.id}.json`),
			JSON.stringify({
				record,
				messages: [{ role: "user", content: "original prompt" }],
				compactionCount: 0,
				lastInputTokens: 0,
			}),
		);
	}

	it("explicit run continue resolves to the saved cwd", async () => {
		const savedCwd = tempDir("kota-resume-saved-");
		const record = makeRecord({ id: "conv-resume", cwd: savedCwd });
		const { client } = makeHistoryClient([record]);

		const result = await resolveRunContinue(client, {
			continue: "conv-resume",
		});

		expect(result?.id).toBe("conv-resume");
		expect(result?.projectDir).toBe(savedCwd);
		expect(result?.explicit).toBe(true);
		expect(result?.cwdOverridden).toBe(false);
	});

	it("explicit run continue finds a record that exists only in its saved project history", async () => {
		const { callerCwd, savedCwd } = tempProjectPair("kota-resume-local-");
		process.chdir(callerCwd);
		const record = makeRecord({
			id: "conv-local-cross",
			cwd: savedCwd,
		});
		seedProjectHistory(savedCwd, record);
		const { client } = makeHistoryClient([]);

		const result = await resolveRunContinue(client, {
			continue: "conv-local-cross",
		});

		expect(result?.id).toBe("conv-local-cross");
		expect(result?.projectDir).toBe(savedCwd);
		expect(result?.explicit).toBe(true);
	});

	it("bare run continue still filters by the caller cwd", async () => {
		const callerCwd = tempDir("kota-resume-caller-");
		process.chdir(callerCwd);
		const record = makeRecord({ id: "conv-latest", cwd: callerCwd });
		const { client, calls } = makeHistoryClient([record]);

		const result = await resolveRunContinue(client, { continue: true });

		expect(calls[0].filter).toEqual({ cwd: callerCwd, limit: 1 });
		expect(result?.id).toBe("conv-latest");
		expect(result?.projectDir).toBe(callerCwd);
		expect(result?.explicit).toBe(false);
	});

	it("missing saved cwd fails validation with the override hint", () => {
		const record = makeRecord({
			id: "conv-missing",
			cwd: join(tempDir("kota-resume-gone-parent-"), "gone"),
		});

		const result = validateConversationResumeCwd(record);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain("saved cwd is missing or inaccessible");
			expect(result.message).toContain("--resume-here");
		}
	});

	it("explicit override uses the caller cwd even when the saved cwd is gone", async () => {
		const callerCwd = tempDir("kota-resume-here-");
		process.chdir(callerCwd);
		const record = makeRecord({
			id: "conv-override",
			cwd: join(tempDir("kota-resume-missing-"), "gone"),
		});
		const { client } = makeHistoryClient([record]);

		const result = await resolveExplicitConversationResume(client, "conv-override", {
			resumeHere: true,
		});

		expect(result.projectDir).toBe(callerCwd);
		expect(result.savedCwd).toBe(record.cwd);
		expect(result.cwdOverridden).toBe(true);
	});
});
