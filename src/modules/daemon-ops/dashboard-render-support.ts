import type { WorkflowQueuedRun } from "#core/workflow/run-types.js";
import {
	blank,
	type LineNode,
	line,
	plain,
	type RenderNode,
	type SemanticRole,
	span,
	type TextSpan,
} from "#modules/rendering/primitives.js";
import type { DashboardSnapshot, DashboardTaskQueue } from "./dashboard-types.js";
import { abbreviateRunId, formatDuration } from "./format-utils.js";

export const MAX_LOG_LINES = 20;
export const LOG_BUFFER_MAX = 200;
export const REFRESH_INTERVAL_MS = 1_000;
const COLUMN_GAP = 2;
const STATS_INDENT = "  ";

type WaitDescriptor = { text: string; role?: SemanticRole };

export function describeWaitUntil(notBeforeMs: number): WaitDescriptor {
	const remainingMs = notBeforeMs - Date.now();
	if (remainingMs <= 0) return { text: "ready", role: "success" };
	const seconds = Math.ceil(remainingMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const duration =
		hours > 0
			? `${hours}h ${minutes % 60}m`
			: minutes > 0
				? `${minutes}m ${seconds % 60}s`
				: `${seconds}s`;
	return { text: `in ${duration}` };
}

export function pendingRunLine(run: WorkflowQueuedRun): LineNode {
	const wait = describeWaitUntil(run.notBeforeMs);
	const id = run.runId ? abbreviateRunId(run.runId) : "-";
	const spans: TextSpan[] = [
		plain("  "),
		span("○", "warn"),
		plain(` ${run.workflowName}  `),
	];
	spans.push(wait.role ? span(wait.text, wait.role) : plain(wait.text));
	spans.push(plain("  "));
	spans.push(span(run.trigger.event, "muted"));
	spans.push(plain("  "));
	spans.push(span(id, "muted"));
	return line(...spans);
}

type StatCell = { label: string; value: string; valueRole?: SemanticRole };
type StatRow = readonly StatCell[];

export function formatStatsGrid(rows: readonly StatRow[]): LineNode[] {
	const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const labelWidth = Array.from({ length: colCount }, (_, i) =>
		rows.reduce((m, r) => Math.max(m, r[i]?.label.length ?? 0), 0),
	);
	const valueWidth = Array.from({ length: colCount }, (_, i) =>
		rows.reduce((m, r) => Math.max(m, r[i]?.value.length ?? 0), 0),
	);
	return rows.map((row) => {
		const spans: TextSpan[] = [plain(STATS_INDENT)];
		row.forEach((cell, i) => {
			const labelPad = labelWidth[i]! + COLUMN_GAP;
			const isLast = i === row.length - 1;
			const valuePad = isLast ? 0 : valueWidth[i]! + COLUMN_GAP;
			spans.push(plain(cell.label.padEnd(labelPad)));
			const valueText = cell.value.padEnd(valuePad);
			if (cell.valueRole) {
				spans.push(span(cell.value, cell.valueRole));
				const extra = valueText.length - cell.value.length;
				if (extra > 0) spans.push(plain(" ".repeat(extra)));
			} else {
				spans.push(plain(valueText));
			}
		});
		return line(...spans);
	});
}

export function renderStatRows(
	snapshot: DashboardSnapshot,
	pendingCount: number,
): LineNode[] {
	const pausedCell: StatCell = snapshot.dispatchPaused
		? {
				label: "Paused",
					value: snapshot.dispatchPause?.kind === "operator"
							? "operator"
							: "yes",
				valueRole: "warn",
			}
		: { label: "Paused", value: "no" };
	return formatStatsGrid([
		[
			{ label: "Completed", value: String(snapshot.completedRuns) },
			{ label: "Sessions", value: String(snapshot.sessionCount) },
		],
		[{ label: "Definitions", value: String(snapshot.definitionCount) }],
		[
			{ label: "Active", value: String(snapshot.activeRuns.length) },
			{ label: "Pending", value: String(pendingCount) },
		],
		[pausedCell],
	]);
}

export function renderActiveRuns(snapshot: DashboardSnapshot): RenderNode[] {
	if (snapshot.activeRuns.length === 0) return [];
	const nodes: RenderNode[] = [
		line(span(`Active (${snapshot.activeRuns.length})`, undefined, true)),
	];
	for (const run of snapshot.activeRuns) {
		nodes.push(
			line(
				plain("  "),
				span("●", "success"),
				plain(` ${run.workflow}  `),
				span(formatDuration(run.startedAt), "muted"),
			),
		);
	}
	nodes.push(blank());
	return nodes;
}

export function renderControlHelp(): RenderNode[] {
	return [
		line(span("Controls", undefined, true)),
		line(plain("  Host/dashboard only; this terminal does not read commands.")),
		line(plain("  Controls use the daemon API through these clients:")),
		line(
			plain("  status `kota status`  inbox `kota inbox`  workflow `kota workflow status`"),
		),
		line(plain("  pause `kota workflow pause`  resume `kota workflow resume`")),
		line(plain("  follow `kota workflow follow`  client `kota navigate` or bare `kota`")),
		line(plain("  ui `kota ui render runs`  reload `kota daemon reload`")),
		line(plain("  stop `kota daemon stop`")),
		blank(),
	];
}

export function taskQueueHasSignal(task: DashboardTaskQueue): boolean {
	if (task.inboxCount > 0) return true;
	if (taskQueueHasDispatchableWork(task)) return true;
	if (task.pullableCount > 0) return true;
	if (task.actionableCount > 0) return true;
	if (task.openCount > 0) return true;
	const { counts } = task;
	return counts.ready > 0 || counts.doing > 0 || counts.backlog > 0 || counts.blocked > 0;
}

export function taskQueueHasDispatchableWork(task: DashboardTaskQueue): boolean {
	return (
		task.hasDispatchableWork ||
		task.dispatchableCount > 0 ||
		task.inboxCount > 0 ||
		task.actionableCount > 0 ||
		task.promotableBacklogCount > 0
	);
}

export function formatQueueCountsRow(task: DashboardTaskQueue): string {
	const entries: string[] = [];
	if (task.inboxCount > 0) entries.push(`Inbox ${task.inboxCount}`);
	if (task.counts.ready > 0) entries.push(`Ready ${task.counts.ready}`);
	if (task.counts.doing > 0) entries.push(`Doing ${task.counts.doing}`);
	if (task.counts.backlog > 0) entries.push(`Backlog ${task.counts.backlog}`);
	if (task.counts.blocked > 0) entries.push(`Blocked ${task.counts.blocked}`);
	return entries.join("  ");
}
