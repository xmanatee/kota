import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeMergeGateArtifact } from "./worktree-merge-gate-support.js";
import type { MergeGateResult } from "./worktree-merge-gate-types.js";

const DEFAULT_MERGE_GATE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const MERGE_GATE_LOCK_POLL_MS = 25;

export type MergeGateLockResult =
	| { acquired: true; waitMs: number }
	| { acquired: false; waitMs: number; reason: string };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockDir(projectDir: string): string {
	return join(projectDir, ".kota", "worktrees", "merge-gate.lock");
}

export async function acquireMergeGateLock(input: {
	projectDir: string;
	taskId: string;
	runId: string;
	timeoutMs?: number;
}): Promise<MergeGateLockResult> {
	const startedAt = Date.now();
	const timeoutMs = input.timeoutMs ?? DEFAULT_MERGE_GATE_LOCK_TIMEOUT_MS;
	const lockPath = lockDir(input.projectDir);
	await mkdir(dirname(lockPath), { recursive: true });
	while (true) {
		try {
			await mkdir(lockPath);
			await writeFile(
				join(lockPath, "owner.json"),
				`${JSON.stringify(
					{
						taskId: input.taskId,
						runId: input.runId,
						acquiredAt: new Date().toISOString(),
					},
					null,
					2,
				)}\n`,
				"utf8",
			);
			return { acquired: true, waitMs: Date.now() - startedAt };
		} catch (error) {
			let code: string | undefined;
			if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
				code = error.code;
			}
			if (code !== "EEXIST") throw error;
			const waitMs = Date.now() - startedAt;
			if (waitMs >= timeoutMs) {
				return { acquired: false, waitMs, reason: "merge gate lock is held by another run" };
			}
			await sleep(MERGE_GATE_LOCK_POLL_MS);
		}
	}
}

export async function releaseMergeGateLock(projectDir: string): Promise<void> {
	await rm(lockDir(projectDir), { recursive: true, force: true });
}

export function writeMergeGateMetrics(
	result: MergeGateResult,
	input: {
		waitMs: number;
		mergeDurationMs: number;
		serializedByLock: boolean;
	},
): MergeGateResult {
	return writeMergeGateArtifact({
		...result,
		metrics: {
			waitMs: input.waitMs,
			mergeDurationMs: input.mergeDurationMs,
			conflictCount: result.conflicts.length,
			resolverAttempts: result.resolutionAttempts,
			validationFailures: result.validation && !result.validation.passed ? 1 : 0,
			serializedByLock: input.serializedByLock,
		},
	});
}
