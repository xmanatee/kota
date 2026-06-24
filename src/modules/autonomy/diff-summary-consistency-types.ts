import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { WorkflowRunSummary } from "./run-summary.js";

export const DIFF_SUMMARY_CONSISTENCY_ARTIFACT =
	"diff-summary-consistency.json";

export type DiffSummaryFileBucket =
	| "production"
	| "test"
	| "task"
	| "doc"
	| "generated-or-baseline"
	| "run-artifact"
	| "config"
	| "other";

export type DiffSummaryMismatchCategory =
	| "module-mentioned-not-touched"
	| "task-only-implementation-claim"
	| "broad-source-churn-omitted"
	| "generated-or-baseline-omitted";

export type DiffSummaryMissingData =
	| "run-summary"
	| "commit-message-file"
	| "task-metadata"
	| "diff-name-status";

export type DiffSummaryNameStatusKind =
	| "added"
	| "deleted"
	| "modified"
	| "renamed"
	| "other";

export type DiffSummaryNameStatus = {
	status: DiffSummaryNameStatusKind;
	path: string;
	previousPath?: string;
};

export type DiffSummaryDeclaredText = {
	commitSubject: string | null;
	commitMessageFile: string | null;
	taskTitle: string | null;
	taskSummary: string | null;
};

export type DiffSummaryFacts = {
	changedFileCount: number;
	changedFiles: string[];
	truncatedChangedFileCount: number;
	topLevelAreas: string[];
	moduleNames: string[];
	fileBuckets: { bucket: DiffSummaryFileBucket; count: number }[];
	addedFileCount: number;
	deletedFileCount: number;
	renamedFileCount: number;
	modifiedFileCount: number;
	taskFileCount: number;
	productionFileCount: number;
	testFileCount: number;
	docFileCount: number;
	generatedOrBaselineChanged: boolean;
	largeDiff: boolean;
	taskMovedToDone: boolean;
};

export type DiffSummaryMismatch = {
	category: DiffSummaryMismatchCategory;
	severity: "advisory";
	message: string;
	evidence: {
		mentionedModules?: readonly string[];
		touchedModules?: readonly string[];
		fileBuckets?: readonly { bucket: DiffSummaryFileBucket; count: number }[];
		changedFileCount?: number;
		changedFiles?: readonly string[];
	};
};

export type DiffSummaryConsistencyRecord = {
	version: 1;
	runId: string | null;
	taskId: string | null;
	taskTitle: string | null;
	commitSha: string | null;
	declared: DiffSummaryDeclaredText;
	facts: DiffSummaryFacts;
	mismatches: DiffSummaryMismatch[];
	missingData: DiffSummaryMissingData[];
};

export type BuildDiffSummaryConsistencyRecordInput = {
	runSummary: WorkflowRunSummary | null;
	commitMessageFile: string | null;
	task: Pick<RepoTaskFullRecord, "id" | "title" | "summary" | "state"> | null;
	nameStatus: readonly DiffSummaryNameStatus[] | null;
	knownModuleNames?: readonly string[];
};
