import type {
	GitJsonObject,
	GitJsonValue,
} from "./worktree-lifecycle-support.js";
import { isGitAncestor } from "./worktree-lifecycle-support.js";
import type {
	AutomationWorktreeCanonicalConflict,
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeCanonicalValidation,
} from "./worktree-lifecycle-types.js";

type ReconciliationJsonValue =
	| GitJsonValue
	| AutomationWorktreeCanonicalReconciliation;

function isObject(
	value: ReconciliationJsonValue | undefined,
): value is GitJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: GitJsonValue | undefined): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNullableString(value: GitJsonValue | undefined): value is string | null {
	return value === null || typeof value === "string";
}

function isNullableCount(value: GitJsonValue | undefined): value is number | null {
	return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isConflict(
	value: GitJsonValue | undefined,
): value is AutomationWorktreeCanonicalConflict {
	if (!isObject(value)) return false;
	return (
		typeof value.path === "string" &&
		(value.kind === "text" || value.kind === "binary" || value.kind === "blocked-path") &&
		typeof value.reason === "string"
	);
}

function isValidation(
	value: GitJsonValue | undefined,
): value is AutomationWorktreeCanonicalValidation {
	if (!isObject(value)) return false;
	return (
		isStringArray(value.command) &&
		(value.exitCode === null || typeof value.exitCode === "number") &&
		typeof value.stdoutTail === "string" &&
		typeof value.stderrTail === "string" &&
		typeof value.passed === "boolean"
	);
}

function phaseMatchesDisposition(value: GitJsonObject): boolean {
	if (value.phase === "checkpointing" || value.phase === "reconciling-canonical") {
		return value.disposition === "pending";
	}
	if (value.phase === "conflict-blocked") return value.disposition === "needs-review";
	return (
		value.phase === "ready-to-resume" &&
		value.disposition === "ready-to-resume" &&
		typeof value.checkpointCommit === "string" &&
		typeof value.integratedCanonicalHeadCommit === "string" &&
		value.branchBehindAtResume === 0 &&
		Array.isArray(value.validations) &&
		value.validations.every((validation) => isValidation(validation) && validation.passed)
	);
}

export function isAutomationWorktreeCanonicalReconciliation(
	value: ReconciliationJsonValue,
): value is AutomationWorktreeCanonicalReconciliation {
	if (!isObject(value)) return false;
	return (
		(value.phase === "checkpointing" ||
			value.phase === "reconciling-canonical" ||
			value.phase === "conflict-blocked" ||
			value.phase === "ready-to-resume") &&
		(value.disposition === "pending" ||
			value.disposition === "needs-review" ||
			value.disposition === "ready-to-resume") &&
		phaseMatchesDisposition(value) &&
		typeof value.originalBaseCommit === "string" &&
		isNullableString(value.checkpointCommit) &&
		typeof value.canonicalHeadCommit === "string" &&
		isNullableString(value.integratedCanonicalHeadCommit) &&
		isNullableCount(value.branchBehindAtStart) &&
		isNullableCount(value.branchBehindAtResume) &&
		isStringArray(value.overlappingPaths) &&
		isStringArray(value.canonicalDestructivePaths) &&
		Array.isArray(value.conflicts) &&
		value.conflicts.every(isConflict) &&
		Array.isArray(value.validations) &&
		value.validations.every(isValidation) &&
		isNullableString(value.reason) &&
		typeof value.artifactPath === "string" &&
		typeof value.updatedAt === "string"
	);
}

export function hasReusableCanonicalCheckpoint(
	value: ReconciliationJsonValue | undefined,
	workspaceDir: string,
	headCommit: string,
): value is AutomationWorktreeCanonicalReconciliation & {
	checkpointCommit: string;
	integratedCanonicalHeadCommit: string;
} {
	return (
		value !== undefined &&
		isAutomationWorktreeCanonicalReconciliation(value) &&
		value.disposition === "ready-to-resume" &&
		typeof value.checkpointCommit === "string" &&
		typeof value.integratedCanonicalHeadCommit === "string" &&
		isGitAncestor(workspaceDir, value.checkpointCommit, headCommit) &&
		isGitAncestor(
			workspaceDir,
			value.integratedCanonicalHeadCommit,
			headCommit,
		)
	);
}
