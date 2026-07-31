import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { vi } from "vitest";
import {
	type ApprovalClientProjection,
	ApprovalQueue,
	defaultApprovalPendingTtlMs,
	isWorkflowGateApproval,
	type PendingApproval,
	projectApprovalForClient,
	resetApprovalQueue,
} from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerApprovalCommands } from "./cli.js";
import type { ApprovalsClient } from "./client.js";

vi.mock("#core/events/event-bus.js", () => ({
	tryEmit: vi.fn(),
	getEventBus: () => null,
}));

export let testQueue: ApprovalQueue;
export let testDir = "";

vi.mock("#core/daemon/approval-queue.js", async (importOriginal) => {
	const mod = await importOriginal<typeof import("#core/daemon/approval-queue.js")>();
	return { ...mod, getApprovalQueue: () => testQueue };
});

const toolMocks = vi.hoisted(() => ({
	executeTool: vi.fn(async (_name: string, _input: Record<string, unknown>) => ({ content: "" })),
}));

vi.mock("#core/tools/index.js", () => toolMocks);

export const executeTool = toolMocks.executeTool;

export const CSI_RED = "\x1b[31m";
export const CSI_RESET = "\x1b[0m";
export const OSC_TITLE = "\x1b]0;approval-pwned\x07";
export const C1_CSI_GREEN = "\x9b32m";
export const C1_OSC_TITLE = "\x9d0;approval-c1-pwned\x07";
export const ARABIC_LETTER_MARK = "\u061c";
export const RIGHT_TO_LEFT_MARK = "\u200f";
export const LEFT_TO_RIGHT_OVERRIDE = "\u202d";
export const RIGHT_TO_LEFT_OVERRIDE = "\u202e";
export const LEFT_TO_RIGHT_ISOLATE = "\u2066";
export const POP_DIRECTIONAL_ISOLATE = "\u2069";
// biome-ignore lint/suspicious/noControlCharactersInRegex: regression checks assert raw terminal controls are absent
export const RAW_TERMINAL_CONTROL_PATTERN = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
export const UNICODE_BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function setupApprovalCliTest(): void {
	testDir = mkdtempSync(join(tmpdir(), "approval-cli-test-"));
	testQueue = new ApprovalQueue(testDir);
}

export function teardownApprovalCliTest(): void {
	rmSync(testDir, { recursive: true, force: true });
	resetApprovalQueue();
	vi.clearAllMocks();
}

export function testApprovalsClient(): ApprovalsClient {
	return {
		async list(filter) {
			testQueue.expireStale(defaultApprovalPendingTtlMs());
			const status = filter?.status;
			const items = status === undefined
				? testQueue.list("pending")
				: status === "all" ? testQueue.list() : testQueue.list(status);
			return { approvals: items.map((item) => testQueue.projectForClient(item)) };
		},
		async approve(id, reviewDigest, note) {
			const selection = testQueue.getExecutionSnapshot(id);
			if (!selection.ok) {
				return {
					ok: false,
					reason: selection.reason === "descriptor_mismatch"
						? "review_mismatch"
						: selection.reason,
				};
			}
			if (selection.snapshot.descriptor.reviewDigest !== reviewDigest) {
				return { ok: false, reason: "review_mismatch" };
			}
			const result = testQueue.approveForExecution(selection.snapshot.descriptor, note);
			const item = result.ok ? result.approval : null;
			if (!item) return { ok: false, reason: "not_found" };
			if (isWorkflowGateApproval(item)) {
				return {
					ok: true,
					approval: item,
					resolution: { kind: "workflow_gate_approved" },
				};
			}
			const execution = await executeTool(item.tool, item.input);
			return {
				ok: true,
				approval: item,
				resolution: {
					kind: "tool_execution",
					execution: {
						status: "is_error" in execution && execution.is_error
							? "failed"
							: "succeeded",
						output: {
							redacted: true,
							reason: "tool-io",
							bytes: Buffer.byteLength(execution.content, "utf8"),
						},
					},
				},
			};
		},
		async reject(id, reason) {
			const item = testQueue.reject(id, reason);
			return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
		},
	};
}

export function approvePendingForTest(
	id: string,
	note?: string,
	resolutionSource?: string,
): PendingApproval | null {
	const selection = testQueue.getExecutionSnapshot(id);
	if (!selection.ok) return null;
	const result = testQueue.approveForExecution(
		selection.snapshot.descriptor,
		note,
		resolutionSource,
	);
	return result.ok ? result.approval : null;
}

function stubCtx(approvals: ApprovalsClient): ModuleContext {
	return { client: { approvals } } as unknown as ModuleContext;
}

export function withRedactedAccessToken(item: PendingApproval): ApprovalClientProjection {
	const projected = projectApprovalForClient(item, "daemon-api", item.input);
	return { ...projected, input: { ...projected.input, accessToken: "[redacted]" } };
}

export function makeProgram(approvals = testApprovalsClient()): Command {
	const program = new Command();
	program.exitOverride();
	registerApprovalCommands(program, stubCtx(approvals));
	return program;
}

export async function run(program: Command, ...args: string[]): Promise<void> {
	await program.parseAsync(["node", "cli", ...args]);
}

export async function captureOutput(fn: () => Promise<void>): Promise<string> {
	const lines: string[] = [];
	const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
		lines.push(`${args.join(" ")}\n`);
	});
	const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
		lines.push(String(data));
		return true;
	});
	try { await fn(); } finally {
		logSpy.mockRestore();
		stdoutSpy.mockRestore();
	}
	return lines.join("");
}

export async function captureNoColorOutput(fn: () => Promise<void>): Promise<string> {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try { return await captureOutput(fn); } finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
}

export async function captureStderr(fn: () => Promise<void>): Promise<string> {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
		lines.push(String(data));
		return true;
	});
	try { await fn(); } catch { /* expected mocked exit */ } finally { spy.mockRestore(); }
	return lines.join("");
}

export function writeApprovalReviewTranscript(id: string, output: string): void {
	const artifactDir = process.env.KOTA_RUN_ARTIFACT_DIR;
	if (!artifactDir) return;
	mkdirSync(artifactDir, { recursive: true });
	writeFileSync(join(artifactDir, "transcript.txt"), `$ kota approval approve ${id}\n${output}`, "utf8");
}
