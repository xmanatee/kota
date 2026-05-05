/**
 * Coverage for `kota history search` — the CLI surface that consumes
 * `/api/history/search` via `ctx.client.history.search`. The tests
 * install a stub `KotaClient` through `setActiveKotaClient` so each
 * branch the daemon route declares (populated, empty, semantic-
 * unavailable, plus the CLI-only empty-query and keyword paths) is
 * exercised against the registered Commander program rather than the
 * real provider stack.
 */

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
import { registerHistoryCommands } from "./cli-commands.js";
import type {
	HistorySearchFilter,
	HistorySearchResult,
} from "./client.js";

vi.mock("#core/modules/cli-providers.js", () => ({
	ensureCliProvidersFor: vi.fn(async () => {}),
}));

type SearchCall = {
	query: string;
	filter: HistorySearchFilter | undefined;
};

type SearchStub = {
	calls: SearchCall[];
	respond: (
		query: string,
		filter: HistorySearchFilter | undefined,
	) => HistorySearchResult;
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
