import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getKnowledgeStore } from "#core/memory/knowledge-store.js";

type RunSummary = {
	runId: string;
	workflow: string;
	taskId?: string;
	taskTitle?: string;
	outcome: string;
	commitMessage?: string;
	filesChanged?: string[];
	costUsd?: number;
	durationMs?: number;
	completedAt?: string;
};

export type CaptureResult = {
	captured: boolean;
	reason: string;
	entryId?: string;
};

/** Check whether a knowledge entry already exists for this run. */
function alreadyCaptured(
	store: ReturnType<typeof getKnowledgeStore>,
	runId: string,
): boolean {
	const existing = store.search(runId, { tag: `run:${runId}` });
	return existing.length > 0;
}

function readJsonFile<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return null;
	}
}

function readTextFile(path: string): string | null {
	if (!existsSync(path)) return null;
	try {
		return readFileSync(path, "utf-8").trim();
	} catch {
		return null;
	}
}

function formatDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	return `${Math.round(ms / 60_000)}m`;
}

function buildContent(summary: RunSummary, commitDetail: string | null): string {
	const lines: string[] = [];

	if (summary.taskTitle) {
		lines.push(`Task: ${summary.taskTitle}`);
	}
	if (summary.commitMessage) {
		lines.push(`Commit: ${summary.commitMessage}`);
	}
	if (commitDetail && commitDetail !== summary.commitMessage) {
		lines.push("");
		lines.push(commitDetail);
	}
	if (summary.filesChanged && summary.filesChanged.length > 0) {
		lines.push("");
		lines.push(`Files changed (${summary.filesChanged.length}):`);
		const display = summary.filesChanged.slice(0, 20);
		for (const f of display) {
			lines.push(`- ${f}`);
		}
		if (summary.filesChanged.length > 20) {
			lines.push(`- ... and ${summary.filesChanged.length - 20} more`);
		}
	}

	const stats: string[] = [];
	if (summary.durationMs != null) stats.push(`duration: ${formatDuration(summary.durationMs)}`);
	if (summary.costUsd != null) stats.push(`cost: $${summary.costUsd.toFixed(2)}`);
	if (stats.length > 0) {
		lines.push("");
		lines.push(stats.join(", "));
	}

	return lines.join("\n");
}

/**
 * Extract a structured knowledge entry from a completed workflow run.
 * Returns null if the run has no run-summary.json or was already captured.
 */
export function captureRunInsight(
	projectDir: string,
	runDir: string,
	runId: string,
	workflow: string,
): CaptureResult {
	const store = getKnowledgeStore(projectDir);

	if (alreadyCaptured(store, runId)) {
		return { captured: false, reason: "already captured" };
	}

	const runDirPath = join(projectDir, runDir);
	const summary = readJsonFile<RunSummary>(join(runDirPath, "run-summary.json"));

	if (!summary) {
		return { captured: false, reason: "no run-summary.json" };
	}

	if (summary.outcome !== "success") {
		return { captured: false, reason: `run outcome: ${summary.outcome}` };
	}

	const commitDetail = readTextFile(join(runDirPath, "commit-message.txt"));

	const title = summary.commitMessage
		|| summary.taskTitle
		|| `${workflow} run ${runId}`;

	const tags = [`run:${runId}`, `workflow:${workflow}`];
	if (summary.taskId) tags.push(`task:${summary.taskId}`);

	const content = buildContent(summary, commitDetail);

	const entryId = store.create({
		title,
		content,
		type: "run-insight",
		tags,
		scope: "project",
		meta: {
			runId,
			workflow,
			...(summary.taskId ? { taskId: summary.taskId } : {}),
			...(summary.completedAt ? { completedAt: summary.completedAt } : {}),
		},
	});

	return { captured: true, reason: "ok", entryId };
}
