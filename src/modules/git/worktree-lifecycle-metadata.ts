import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAutomationWorktreeCanonicalReconciliation } from "./worktree-canonical-reconciliation-record.js";
import type {
	AutomationWorktreeMetadata,
	AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";

const METADATA_DIR = join(".kota", "worktrees");

type AutomationWorktreeRuntimeResources = NonNullable<AutomationWorktreeMetadata["runtimeResources"]>;
type AutomationWorktreePortRange = NonNullable<AutomationWorktreeRuntimeResources["ports"]>;

export type GitJsonValue = string | number | boolean | null | GitJsonValue[] | GitJsonObject;
export type GitJsonObject = { [key: string]: GitJsonValue | undefined };

export function readGitJsonFile(path: string): GitJsonValue {
	return JSON.parse(readFileSync(path, "utf8")) as GitJsonValue;
}

export function isGitJsonObject(value: GitJsonValue | undefined): value is GitJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeAutomationWorktreeSegment(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function metadataPath(projectDir: string, taskId: string, runId: string): string {
	return join(
		projectDir,
		METADATA_DIR,
		`${safeAutomationWorktreeSegment(taskId)}-${safeAutomationWorktreeSegment(runId)}.json`,
	);
}

export function metadataDir(projectDir: string): string {
	return join(projectDir, METADATA_DIR);
}

export function writeMetadata(projectDir: string, metadata: AutomationWorktreeMetadata): void {
	const path = metadataPath(projectDir, metadata.taskId, metadata.runId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function readMetadata(selector: AutomationWorktreeSelector): AutomationWorktreeMetadata {
	return readAutomationWorktreeMetadataPath(metadataPath(selector.projectDir, selector.taskId, selector.runId));
}

export function readAutomationWorktreeMetadataPath(path: string): AutomationWorktreeMetadata {
	const parsed = readGitJsonFile(path);
	assertAutomationWorktreeMetadata(path, parsed);
	return parsed;
}

function assertAutomationWorktreeMetadata(
	path: string,
	value: GitJsonValue | AutomationWorktreeMetadata,
): asserts value is AutomationWorktreeMetadata {
	if (!isGitJsonObject(value)) throw new Error(`Invalid worktree metadata at ${path}: expected object`);
	const requiredStrings = [
		"taskId",
		"runId",
		"workflowId",
		"owner",
		"workspaceDir",
		"branch",
		"baseCommit",
		"createdAt",
		"updatedAt",
	] as const;
	if (value.schemaVersion !== 1) throw new Error(`Invalid worktree metadata at ${path}: schemaVersion must be 1`);
	for (const key of requiredStrings) {
		if (typeof value[key] !== "string") throw new Error(`Invalid worktree metadata at ${path}: ${key} must be a string`);
	}
	if (!["active", "pending-merge", "merged", "removed"].includes(String(value.state))) {
		throw new Error(`Invalid worktree metadata at ${path}: unsupported state ${String(value.state)}`);
	}
	if (!Array.isArray(value.copiedSetupFiles) || value.copiedSetupFiles.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid worktree metadata at ${path}: copiedSetupFiles must be a string array`);
	}
	if (value.runtimeResources !== undefined) assertRuntimeResources(path, value.runtimeResources);
	if (
		value.canonicalReconciliation !== undefined &&
		(!isAutomationWorktreeCanonicalReconciliation(value.canonicalReconciliation) ||
			value.canonicalReconciliation.originalBaseCommit !== value.baseCommit)
	) {
		throw new Error(`Invalid worktree metadata at ${path}: malformed canonical reconciliation`);
	}
	if (value.lastCleanupBlockers !== undefined && !isStringArray(value.lastCleanupBlockers)) {
		throw new Error(`Invalid worktree metadata at ${path}: lastCleanupBlockers must be a string array`);
	}
	for (const key of ["recoveryRunId", "stateReason", "removedAt", "mergedAt", "mergedCommit"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw new Error(`Invalid worktree metadata at ${path}: ${key} must be a string`);
		}
	}
}

function assertRuntimeResources(
	path: string,
	value: GitJsonValue | AutomationWorktreeMetadata["runtimeResources"],
): asserts value is AutomationWorktreeRuntimeResources {
	if (!isGitJsonObject(value)) throw new Error(`Invalid worktree metadata at ${path}: runtimeResources must be an object`);
	for (const key of ["profileId", "agentRunDir"] as const) {
		if (typeof value[key] !== "string") {
			throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.${key} must be a string`);
		}
	}
	for (const key of ["tempRoot", "artifactRoot"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.${key} must be a string`);
		}
	}
	if (value.ports !== undefined) assertPortRange(path, value.ports);
}

function assertPortRange(
	path: string,
	value: GitJsonValue | AutomationWorktreePortRange,
): asserts value is AutomationWorktreePortRange {
	if (!isGitJsonObject(value)) throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.ports must be an object`);
	if (typeof value.start !== "number" || typeof value.end !== "number") {
		throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.ports must have numeric start and end`);
	}
}

function isStringArray(value: GitJsonValue | undefined): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
