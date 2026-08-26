import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import type {
	DiffSummaryFacts,
	DiffSummaryFileBucket,
	DiffSummaryNameStatus,
	DiffSummaryNameStatusKind,
} from "./diff-summary-consistency-types.js";
import type { AutonomyRunDeliveryEvidence } from "./run-delivery-evidence.js";

const MAX_CHANGED_FILES_IN_RECORD = 60;
const LARGE_DIFF_FILE_THRESHOLD = 12;

export async function collectGitNameStatus(
	projectDir: string,
	runCommand: WorkflowCommandRunner,
	baseHead = "HEAD~1",
	publishedHead = "HEAD",
): Promise<DiffSummaryNameStatus[]> {
	const result = await runCommand({
		command: "git",
		args: ["diff", "--name-status", `${baseHead}..${publishedHead}`, "--"],
		cwd: projectDir,
	});
	return parseGitNameStatus(result.stdout.text);
}

export function parseGitNameStatus(raw: string): DiffSummaryNameStatus[] {
	const statuses: DiffSummaryNameStatus[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		const parts = line
			.split("\t")
			.map((part) => part.trim())
			.filter(Boolean);
		if (parts.length < 2) continue;
		const code = parts[0];
		const kind = statusKind(code);
		if (kind === "renamed" && parts.length >= 3) {
			statuses.push({
				status: kind,
				previousPath: parts[1],
				path: parts[2],
			});
			continue;
		}
		statuses.push({ status: kind, path: parts[1] });
	}
	return statuses;
}

export function diffFactsFor(
	delivery: AutonomyRunDeliveryEvidence | null,
	nameStatus: readonly DiffSummaryNameStatus[] | null,
): DiffSummaryFacts {
	const paths = sortedUnique(
		nameStatus
			? nameStatus.map((entry) => entry.path)
			: (delivery?.changedPaths ?? []),
	);
	const taskFileCount = paths.filter(isTaskPath).length;
	const productionFileCount = paths.filter(isProductionSourcePath).length;
	const testFileCount = paths.filter(isTestSourcePath).length;
	const docFileCount = paths.filter(isDocPath).length;

	return {
		changedFileCount: paths.length,
		changedFiles: paths.slice(0, MAX_CHANGED_FILES_IN_RECORD),
		truncatedChangedFileCount: Math.max(
			0,
			paths.length - MAX_CHANGED_FILES_IN_RECORD,
		),
		topLevelAreas: sortedUnique(paths.map(topLevelAreaForPath)),
		moduleNames: sortedUnique(
			paths
				.map(moduleNameForPath)
				.filter((name): name is string => name !== null),
		),
		fileBuckets: bucketCounts(paths),
		addedFileCount: countStatus(nameStatus, "added"),
		deletedFileCount: countStatus(nameStatus, "deleted"),
		renamedFileCount: countStatus(nameStatus, "renamed"),
		modifiedFileCount: countStatus(nameStatus, "modified"),
		taskFileCount,
		productionFileCount,
		testFileCount,
		docFileCount,
		generatedOrBaselineChanged: paths.some(isGeneratedOrBaselinePath),
		largeDiff: paths.length >= LARGE_DIFF_FILE_THRESHOLD,
		taskMovedToDone: paths.some((path) => path.startsWith("data/tasks/done/")),
	};
}

export function isGeneratedOrBaselinePath(path: string): boolean {
	return (
		/(^|\/)(__fixtures__|fixtures|recordings|generated)(\/|$)/.test(path) ||
		/\b(baseline|snapshot|golden|generated)\b/i.test(path)
	);
}

function statusKind(code: string): DiffSummaryNameStatusKind {
	if (code.startsWith("A")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("M")) return "modified";
	if (code.startsWith("R")) return "renamed";
	return "other";
}

function countStatus(
	statuses: readonly DiffSummaryNameStatus[] | null,
	status: DiffSummaryNameStatusKind,
): number {
	return statuses?.filter((entry) => entry.status === status).length ?? 0;
}

function bucketCounts(
	paths: readonly string[],
): { bucket: DiffSummaryFileBucket; count: number }[] {
	const counts = new Map<DiffSummaryFileBucket, number>();
	for (const path of paths) {
		const bucket = fileBucketForPath(path);
		counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([bucket, count]) => ({ bucket, count }))
		.sort(
			(left, right) =>
				right.count - left.count || left.bucket.localeCompare(right.bucket),
		);
}

function fileBucketForPath(path: string): DiffSummaryFileBucket {
	if (isGeneratedOrBaselinePath(path)) return "generated-or-baseline";
	if (isTaskPath(path)) return "task";
	if (path.startsWith(".kota/runs/")) return "run-artifact";
	if (isTestSourcePath(path)) return "test";
	if (isProductionSourcePath(path)) return "production";
	if (isDocPath(path)) return "doc";
	if (
		path === "package.json" ||
		path.endsWith(".json") ||
		path.endsWith(".yaml") ||
		path.endsWith(".yml")
	) {
		return "config";
	}
	return "other";
}

function isTaskPath(path: string): boolean {
	return path.startsWith("data/tasks/") && path.endsWith(".md");
}

function isProductionSourcePath(path: string): boolean {
	return (
		path.startsWith("src/") && path.endsWith(".ts") && !isTestSourcePath(path)
	);
}

function isTestSourcePath(path: string): boolean {
	return (
		path.startsWith("src/") &&
		/\.test\.ts$|\.integration\.ts$|\.integration\.test\.ts$/.test(path)
	);
}

function isDocPath(path: string): boolean {
	return (
		path === "AGENTS.md" ||
		path.endsWith("/AGENTS.md") ||
		path.startsWith("docs/") ||
		(path.endsWith(".md") && !isTaskPath(path))
	);
}

function topLevelAreaForPath(path: string): string {
	const first = path.split("/")[0];
	return first || "(root)";
}

function moduleNameForPath(path: string): string | null {
	const parts = path.split("/");
	return parts[0] === "src" && parts[1] === "modules" && parts[2]
		? parts[2]
		: null;
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))].sort();
}
