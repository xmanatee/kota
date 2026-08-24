import { randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type GitJsonValue,
	isGitJsonObject,
} from "./worktree-lifecycle-metadata.js";
import { writeMergeGateArtifact } from "./worktree-merge-gate-support.js";
import type { MergeGateResult } from "./worktree-merge-gate-types.js";

const MERGE_GATE_LOCK_POLL_MS = 25;
const STALE_OWNER_CHECK_MS = 1_000;
const INCOMPLETE_OWNER_GRACE_MS = 5_000;

type MergeGateLockOwner = {
	schemaVersion: 1;
	ownerId: string;
	pid: number;
	taskId: string;
	runId: string;
	acquiredAt: string;
};

export type MergeGateLockLease = {
	ownerId: string;
	waitMs: number;
};

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new Error("Merge gate lock wait aborted");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw abortReason(signal);
	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(abortReason(signal!));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function lockDir(projectDir: string): string {
	return join(projectDir, ".kota", "worktrees", "merge-gate.lock");
}

function ownerPath(lockPath: string): string {
	return join(lockPath, "owner.json");
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (
			error !== null &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "EPERM"
		);
	}
}

function errorCode(error: Error): string | undefined {
	return (
		"code" in error &&
		typeof error.code === "string"
		? error.code
		: undefined
	);
}

function parseLockOwner(value: GitJsonValue): MergeGateLockOwner | null {
	if (
		!isGitJsonObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.ownerId !== "string" ||
		value.ownerId.length === 0 ||
		typeof value.pid !== "number" ||
		!Number.isSafeInteger(value.pid) ||
		value.pid <= 0 ||
		typeof value.taskId !== "string" ||
		value.taskId.length === 0 ||
		typeof value.runId !== "string" ||
		value.runId.length === 0 ||
		typeof value.acquiredAt !== "string"
	) {
		return null;
	}
	return {
		schemaVersion: 1,
		ownerId: value.ownerId,
		pid: value.pid,
		taskId: value.taskId,
		runId: value.runId,
		acquiredAt: value.acquiredAt,
	};
}

async function readOwner(lockPath: string): Promise<MergeGateLockOwner | null> {
	try {
		const parsed = JSON.parse(await readFile(ownerPath(lockPath), "utf8")) as GitJsonValue;
		return parseLockOwner(parsed);
	} catch (error) {
		if (error instanceof Error && errorCode(error) === "ENOENT") return null;
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

async function incompleteLockIsStale(lockPath: string): Promise<boolean> {
	try {
		const details = await stat(lockPath);
		return Date.now() - details.mtimeMs >= INCOMPLETE_OWNER_GRACE_MS;
	} catch (error) {
		if (error instanceof Error && errorCode(error) === "ENOENT") return true;
		throw error;
	}
}

async function reclaimStaleLock(lockPath: string): Promise<boolean> {
	const owner = await readOwner(lockPath);
	if (owner !== null && processExists(owner.pid)) return false;
	if (owner === null && !(await incompleteLockIsStale(lockPath))) return false;

	const stalePath = `${lockPath}.stale-${randomUUID()}`;
	try {
		await rename(lockPath, stalePath);
	} catch (error) {
		if (error instanceof Error && errorCode(error) === "ENOENT") return true;
		throw error;
	}
	await rm(stalePath, { recursive: true, force: true });
	return true;
}

export async function acquireMergeGateLock(input: {
	projectDir: string;
	taskId: string;
	runId: string;
	signal?: AbortSignal;
}): Promise<MergeGateLockLease> {
	const startedAt = Date.now();
	let nextStaleCheckAt = startedAt;
	const lockPath = lockDir(input.projectDir);
	await mkdir(dirname(lockPath), { recursive: true });
	while (true) {
		if (input.signal?.aborted) throw abortReason(input.signal);
		const owner: MergeGateLockOwner = {
			schemaVersion: 1,
			ownerId: randomUUID(),
			pid: process.pid,
			taskId: input.taskId,
			runId: input.runId,
			acquiredAt: new Date().toISOString(),
		};
		try {
			await mkdir(lockPath);
			try {
				await writeFile(ownerPath(lockPath), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
			} catch (error) {
				await rm(lockPath, { recursive: true, force: true });
				throw error;
			}
			return { ownerId: owner.ownerId, waitMs: Date.now() - startedAt };
		} catch (error) {
			if (!(error instanceof Error) || errorCode(error) !== "EEXIST") throw error;
			const now = Date.now();
			if (now >= nextStaleCheckAt) {
				nextStaleCheckAt = now + STALE_OWNER_CHECK_MS;
				if (await reclaimStaleLock(lockPath)) continue;
			}
			await sleep(MERGE_GATE_LOCK_POLL_MS, input.signal);
		}
	}
}

export async function releaseMergeGateLock(
	projectDir: string,
	ownerId: string,
): Promise<void> {
	const lockPath = lockDir(projectDir);
	const owner = await readOwner(lockPath);
	if (owner?.ownerId !== ownerId) {
		throw new Error("Merge gate lock ownership changed before release");
	}
	await rm(lockPath, { recursive: true });
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
