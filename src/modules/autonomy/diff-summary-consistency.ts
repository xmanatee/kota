import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
	listFullRepoTasks,
	type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
	collectGitNameStatus,
	diffFactsFor,
	isGeneratedOrBaselinePath,
	parseGitNameStatus,
} from "./diff-summary-consistency-facts.js";
import {
	type BuildDiffSummaryConsistencyRecordInput,
	DIFF_SUMMARY_CONSISTENCY_ARTIFACT,
	type DiffSummaryConsistencyRecord,
	type DiffSummaryFacts,
	type DiffSummaryMismatch,
	type DiffSummaryMissingData,
} from "./diff-summary-consistency-types.js";
import type { AutonomyRunDeliveryEvidence } from "./run-delivery-evidence.js";

export type {
	BuildDiffSummaryConsistencyRecordInput,
	DiffSummaryConsistencyRecord,
	DiffSummaryDeclaredText,
	DiffSummaryFacts,
	DiffSummaryFileBucket,
	DiffSummaryMismatch,
	DiffSummaryMismatchCategory,
	DiffSummaryMissingData,
	DiffSummaryNameStatus,
	DiffSummaryNameStatusKind,
} from "./diff-summary-consistency-types.js";
export { collectGitNameStatus, DIFF_SUMMARY_CONSISTENCY_ARTIFACT, parseGitNameStatus };

const MAX_DECLARED_TEXT_CHARS = 500;
const BROAD_TERMS =
	/\b(across|baseline|broad|cleanup|cross|generated|multiple|repo-wide|several|surfaces|system|wide)\b/i;
const GENERATED_TERMS =
	/\b(baseline|fixture|generated|golden|recording|snapshot)\b/i;
const IMPLEMENTATION_CLAIM_TERMS =
	/\b(add(?:ed|s)?|client|daemon|fix(?:ed|es)?|guard|harden(?:ed|s)?|implement(?:ed|s)?|module|repair(?:ed|s)?|route|runtime|test(?:ed|s)?|update(?:d|s)?|workflow)\b/i;

export async function writeDiffSummaryConsistencyArtifact(
	workspaceRoot: string,
	runDirPath: string,
	delivery: AutonomyRunDeliveryEvidence,
	runCommand: WorkflowCommandRunner,
): Promise<DiffSummaryConsistencyRecord> {
	const record = buildDiffSummaryConsistencyRecord({
		delivery,
		commitMessageFile: readTrimmedFile(join(runDirPath, "commit-message.txt")),
		task: findTaskForDelivery(workspaceRoot, delivery),
		nameStatus: await collectGitNameStatus(
			workspaceRoot,
			runCommand,
			delivery.integratedFromHead,
			delivery.publishedHead,
		),
		knownModuleNames: collectKnownModuleNames(workspaceRoot),
	});
	writeFileSync(
		join(runDirPath, DIFF_SUMMARY_CONSISTENCY_ARTIFACT),
		`${JSON.stringify(record, null, 2)}\n`,
		"utf-8",
	);
	return record;
}

export function buildDiffSummaryConsistencyRecord(
	input: BuildDiffSummaryConsistencyRecordInput,
): DiffSummaryConsistencyRecord {
	const missingData = missingDataFor(input);
	const declared = declaredTextFor(input);
	const facts = diffFactsFor(input.delivery, input.nameStatus);
	const declaredScopeText = [
		declared.commitSubject,
		declared.commitMessageFile,
		declared.taskTitle,
		declared.taskSummary,
	]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join("\n");
	const mentionedModules = mentionedModuleNames(
		declaredScopeText,
		input.knownModuleNames ?? facts.moduleNames,
	);

	return {
		version: 1,
		runId: input.delivery?.runId ?? null,
		taskId: input.delivery?.taskId ?? input.task?.id ?? null,
		taskTitle: input.delivery?.taskTitle ?? input.task?.title ?? null,
		commitSha: input.delivery?.publishedHead ?? null,
		declared,
		facts,
		mismatches: mismatchRecords(facts, mentionedModules, declaredScopeText),
		missingData,
	};
}

function missingDataFor(
	input: BuildDiffSummaryConsistencyRecordInput,
): DiffSummaryMissingData[] {
	const missing: DiffSummaryMissingData[] = [];
	if (!input.delivery) missing.push("writer-integration");
	if (!input.commitMessageFile) missing.push("commit-message-file");
	if (input.delivery?.taskId && !input.task) missing.push("task-metadata");
	if (input.nameStatus === null) missing.push("diff-name-status");
	return missing;
}

function declaredTextFor(input: BuildDiffSummaryConsistencyRecordInput) {
	return {
		commitSubject: boundText(input.delivery?.commitSubject ?? null),
		commitMessageFile: boundText(input.commitMessageFile),
		taskTitle: boundText(input.delivery?.taskTitle ?? input.task?.title ?? null),
		taskSummary: boundText(input.task?.body ?? null),
	};
}

function mismatchRecords(
	facts: DiffSummaryFacts,
	mentionedModules: readonly string[],
	declaredScopeText: string,
): DiffSummaryMismatch[] {
	const mismatches: DiffSummaryMismatch[] = [];
	const untouchedMentionedModules = mentionedModules.filter(
		(name) => !facts.moduleNames.includes(name),
	);
	if (untouchedMentionedModules.length > 0) {
		mismatches.push({
			category: "module-mentioned-not-touched",
			severity: "advisory",
			message: "Declared summary names module(s) not present in changed paths.",
			evidence: {
				mentionedModules: untouchedMentionedModules,
				touchedModules: facts.moduleNames,
			},
		});
	}
	if (isTaskOnlyImplementationClaim(facts, declaredScopeText)) {
		mismatches.push({
			category: "task-only-implementation-claim",
			severity: "advisory",
			message:
				"Declared summary claims implementation work, but the diff only changes task files.",
			evidence: {
				fileBuckets: facts.fileBuckets,
				changedFileCount: facts.changedFileCount,
			},
		});
	}
	if (isBroadProductionChurnHidden(facts, mentionedModules, declaredScopeText)) {
		mismatches.push({
			category: "broad-source-churn-omitted",
			severity: "advisory",
			message: "Declared summary is narrower than the changed production modules.",
			evidence: {
				mentionedModules,
				touchedModules: facts.moduleNames,
				changedFileCount: facts.changedFileCount,
			},
		});
	}
	if (facts.generatedOrBaselineChanged && !GENERATED_TERMS.test(declaredScopeText)) {
		mismatches.push({
			category: "generated-or-baseline-omitted",
			severity: "advisory",
			message:
				"Generated, fixture, snapshot, or baseline changes are not named in the declared summary.",
			evidence: {
				changedFiles: facts.changedFiles.filter(isGeneratedOrBaselinePath),
			},
		});
	}
	return mismatches;
}

function isTaskOnlyImplementationClaim(
	facts: DiffSummaryFacts,
	declaredScopeText: string,
): boolean {
	const nonTaskChangedFileCount = facts.changedFileCount - facts.taskFileCount;
	return (
		facts.taskFileCount > 0 &&
		nonTaskChangedFileCount === 0 &&
		IMPLEMENTATION_CLAIM_TERMS.test(declaredScopeText)
	);
}

function isBroadProductionChurnHidden(
	facts: DiffSummaryFacts,
	mentionedModules: readonly string[],
	declaredScopeText: string,
): boolean {
	if (facts.productionFileCount < 2 || facts.moduleNames.length < 2) return false;
	if (BROAD_TERMS.test(declaredScopeText)) return false;
	if (mentionedModules.length === 0) return facts.largeDiff;
	const touchedMentionedModules = mentionedModules.filter((name) =>
		facts.moduleNames.includes(name),
	);
	return (
		touchedMentionedModules.length > 0 &&
		touchedMentionedModules.length < facts.moduleNames.length
	);
}

function collectKnownModuleNames(workspaceRoot: string): string[] {
	const modulesDir = join(workspaceRoot, "src", "modules");
	if (!existsSync(modulesDir)) return [];
	return readdirSync(modulesDir)
		.filter((name) => {
			try {
				return statSync(join(modulesDir, name)).isDirectory();
			} catch {
				return false;
			}
		})
		.sort();
}

function findTaskForDelivery(
	workspaceRoot: string,
	delivery: AutonomyRunDeliveryEvidence,
): RepoTaskFullRecord | null {
	if (!delivery.taskId) return null;
	return (
		listFullRepoTasks(workspaceRoot).find((task) => task.id === delivery.taskId) ??
		null
	);
}

function readTrimmedFile(path: string): string | null {
	if (!existsSync(path)) return null;
	const trimmed = readFileSync(path, "utf-8").trim();
	return trimmed.length > 0 ? trimmed : null;
}

function boundText(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.length > MAX_DECLARED_TEXT_CHARS
		? `${trimmed.slice(0, MAX_DECLARED_TEXT_CHARS)}...`
		: trimmed;
}

function mentionedModuleNames(
	text: string,
	knownModuleNames: readonly string[],
): string[] {
	const lowerText = text.toLowerCase();
	const mentioned = new Set<string>();
	for (const moduleName of knownModuleNames) {
		if (moduleName.length < 4 && !moduleName.includes("-")) continue;
		const variants = [moduleName, moduleName.replaceAll("-", " ")];
		if (variants.some((variant) => containsToken(lowerText, variant))) {
			mentioned.add(moduleName);
		}
	}
	return [...mentioned].sort();
}

function containsToken(lowerText: string, lowerToken: string): boolean {
	const escaped = lowerToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`).test(
		lowerText,
	);
}
