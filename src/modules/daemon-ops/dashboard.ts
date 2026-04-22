import { clearScreenDown, cursorTo } from "node:readline";
import { styleText } from "node:util";
import type { WorkflowQueuedRun, WorkflowRunStatus } from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "#core/workflow/types.js";
import { abbreviateRunId, formatDuration, formatTimeAgo, formatUptime } from "./format-utils.js";

export type DashboardTaskQueue = {
	counts: {
		backlog: number;
		ready: number;
		doing: number;
		blocked: number;
		done: number;
		dropped: number;
	};
	inboxCount: number;
	openCount: number;
	pullableCount: number;
	actionableCount: number;
};

export type DashboardSnapshot = {
	pid: number;
	startedAt: string;
	running: boolean;
	stopping: boolean;
	completedRuns: number;
	totalCostUsd?: number;
	lastCompletedWorkflow?: string;
	lastCompletedAt?: string;
	lastCompletedStatus?: WorkflowRunStatus;
	activeRuns: Array<{ runId: string; workflow: string; startedAt: string }>;
	pendingRunCount: number;
	pendingRuns?: WorkflowQueuedRun[];
	queueLength: number;
	dispatchPaused: boolean;
	dispatchWindowBlocked?: boolean;
	dispatchWindowOpensAt?: string;
	agentBackoff?: WorkflowAgentBackoffState;
	definitionCount: number;
	sessionCount: number;
	taskQueue?: DashboardTaskQueue;
};

const MAX_LOG_LINES = 20;
const LOG_BUFFER_MAX = 200;
const REFRESH_INTERVAL_MS = 1_000;
const COLUMN_GAP = 2;
const STATS_INDENT = "  ";

function statusIndicator(status: WorkflowRunStatus): string {
	switch (status) {
		case "success":
			return styleText("green", "success");
		case "failed":
			return styleText("red", "failed");
		case "interrupted":
			return styleText("yellow", "interrupted");
		case "completed-with-warnings":
			return styleText("yellow", "warnings");
	}
}

function formatWaitUntil(notBeforeMs: number): string {
	const remainingMs = notBeforeMs - Date.now();
	if (remainingMs <= 0) return styleText("green", "ready");
	const seconds = Math.ceil(remainingMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const duration =
		hours > 0
			? `${hours}h ${minutes % 60}m`
			: minutes > 0
				? `${minutes}m ${seconds % 60}s`
				: `${seconds}s`;
	return `in ${duration}`;
}

function pendingRunLine(run: WorkflowQueuedRun): string {
	const wait = formatWaitUntil(run.notBeforeMs);
	const id = run.runId ? abbreviateRunId(run.runId) : "-";
	return `  ${styleText("yellow", "\u25cb")} ${run.workflowName}  ${wait}  ${styleText("dim", run.trigger.event)}  ${styleText("dim", id)}`;
}

function describeOperationalState(
	snapshot: DashboardSnapshot,
	pendingRuns: readonly WorkflowQueuedRun[],
): string {
	if (snapshot.dispatchPaused) return styleText("yellow", "dispatch paused");
	if (snapshot.dispatchWindowBlocked) {
		const opens = snapshot.dispatchWindowOpensAt
			? ` until ${new Date(snapshot.dispatchWindowOpensAt).toLocaleTimeString()}`
			: "";
		return styleText("yellow", `outside dispatch window${opens}`);
	}
	if (snapshot.agentBackoff) {
		return styleText(
			"yellow",
			`agent backoff ${snapshot.agentBackoff.kind} until ${new Date(snapshot.agentBackoff.until).toLocaleTimeString()}`,
		);
	}
	if (snapshot.activeRuns.length > 0) {
		const names = snapshot.activeRuns.map((run) => run.workflow).join(", ");
		return styleText("green", `running ${names}`);
	}
	const readyPending = pendingRuns.filter((run) => run.notBeforeMs <= Date.now());
	if (readyPending.length > 0) {
		return styleText("green", `${readyPending.length} queued run${readyPending.length === 1 ? "" : "s"} ready`);
	}
	if (snapshot.taskQueue && (snapshot.taskQueue.inboxCount > 0 || snapshot.taskQueue.pullableCount > 0)) {
		return "work available; waiting for idle dispatch";
	}
	if (pendingRuns.length > 0) {
		const next = pendingRuns.reduce((best, run) =>
			run.notBeforeMs < best.notBeforeMs ? run : best,
		);
		return `waiting for ${next.workflowName} ${formatWaitUntil(next.notBeforeMs)}`;
	}
	return "idle; waiting for work";
}

type StatCell = { label: string; value: string };
type StatRow = readonly StatCell[];

/**
 * Lays out a 2D grid of label/value cells with per-column widths sized to the
 * widest entry, guaranteeing at least COLUMN_GAP spaces between each value and
 * the next label so adjacent fields can never collide regardless of cost/count
 * magnitudes.
 */
export function formatStatsGrid(rows: readonly StatRow[]): string[] {
	const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
	const labelWidth = Array.from({ length: colCount }, (_, i) =>
		rows.reduce((m, r) => Math.max(m, r[i]?.label.length ?? 0), 0),
	);
	const valueWidth = Array.from({ length: colCount }, (_, i) =>
		rows.reduce((m, r) => Math.max(m, r[i]?.value.length ?? 0), 0),
	);
	return rows.map((row) => {
		const parts = row.map((cell, i) => {
			const labelPad = labelWidth[i]! + COLUMN_GAP;
			const isLast = i === row.length - 1;
			const valuePad = isLast ? 0 : valueWidth[i]! + COLUMN_GAP;
			return `${cell.label.padEnd(labelPad)}${cell.value.padEnd(valuePad)}`;
		});
		return `${STATS_INDENT}${parts.join("")}`;
	});
}

export function renderDashboard(
	snapshot: DashboardSnapshot,
	logs: readonly string[],
): string {
	const lines: string[] = [];

	const status = snapshot.stopping
		? styleText("yellow", "stopping")
		: snapshot.running
			? styleText("green", "running")
			: styleText("red", "stopped");
	const uptime = formatUptime(snapshot.startedAt);
	lines.push(
		`${styleText("bold", "KOTA Daemon")}  pid ${snapshot.pid}  up ${uptime}  ${status}`,
	);
	lines.push("");

	const costStr =
		snapshot.totalCostUsd != null
			? `$${snapshot.totalCostUsd.toFixed(2)}`
			: "-";
	const pausedRaw = snapshot.dispatchPaused ? "yes" : "no";
	const pendingRuns = snapshot.pendingRuns ?? [];
	const pendingCount = pendingRuns.length || snapshot.pendingRunCount;

	const statRows: StatRow[] = [
		[
			{ label: "Completed", value: String(snapshot.completedRuns) },
			{ label: "Sessions", value: String(snapshot.sessionCount) },
		],
		[
			{ label: "Cost", value: costStr },
			{ label: "Defs", value: String(snapshot.definitionCount) },
		],
		[
			{ label: "Active", value: String(snapshot.activeRuns.length) },
			{ label: "Pending", value: String(pendingCount) },
		],
		[{ label: "Paused", value: pausedRaw }],
	];
	const statLines = formatStatsGrid(statRows);
	if (snapshot.dispatchPaused) {
		const last = statLines.length - 1;
		statLines[last] = statLines[last]!.replace(
			/yes$/,
			styleText("yellow", "yes"),
		);
	}
	for (const line of statLines) lines.push(line);
	lines.push("");

	lines.push(styleText("bold", "State"));
	lines.push(`  ${describeOperationalState(snapshot, pendingRuns)}`);
	lines.push("");

	if (snapshot.taskQueue) {
		const task = snapshot.taskQueue;
		lines.push(styleText("bold", "Work"));
		lines.push(
			`  Inbox ${task.inboxCount}  Ready ${task.counts.ready}  Backlog ${task.counts.backlog}  Doing ${task.counts.doing}  Blocked ${task.counts.blocked}`,
		);
		lines.push(
			`  Pullable ${task.pullableCount}  Actionable ${task.actionableCount}  Open ${task.openCount}`,
		);
		lines.push("");
	}

	if (snapshot.activeRuns.length > 0) {
		lines.push(
			styleText("bold", `Active (${snapshot.activeRuns.length})`),
		);
		for (const run of snapshot.activeRuns) {
			const dur = formatDuration(run.startedAt);
			lines.push(
				`  ${styleText("green", "\u25cf")} ${run.workflow}  ${styleText("dim", dur)}`,
			);
		}
		lines.push("");
	}

	if (pendingCount > 0) {
		lines.push(`${styleText("bold", `Pending (${pendingCount})`)}`);
		if (pendingRuns.length > 0) {
			for (const run of pendingRuns
				.slice()
				.sort((a, b) => a.notBeforeMs - b.notBeforeMs)
				.slice(0, 5)) {
				lines.push(pendingRunLine(run));
			}
			if (pendingRuns.length > 5) {
				lines.push(styleText("dim", `  +${pendingRuns.length - 5} more`));
			}
		}
		lines.push("");
	}

	if (snapshot.lastCompletedWorkflow && snapshot.lastCompletedAt) {
		lines.push(styleText("bold", "Last"));
		const ago = formatTimeAgo(snapshot.lastCompletedAt);
		const st = snapshot.lastCompletedStatus
			? statusIndicator(snapshot.lastCompletedStatus)
			: "";
		lines.push(
			`  ${snapshot.lastCompletedWorkflow}  ${st}  ${styleText("dim", ago)}`,
		);
		lines.push("");
	}

	if (logs.length > 0) {
		const heading = "Activity ";
		const fillWidth = Math.max(0, 52 - heading.length);
		lines.push(
			`${styleText("bold", heading)}${styleText("dim", "\u2500".repeat(fillWidth))}`,
		);
		const visible = logs.slice(-MAX_LOG_LINES);
		for (const log of visible) {
			lines.push(styleText("dim", `  ${log}`));
		}
	}

	return lines.join("\n");
}

export class DaemonDashboard {
	private logBuffer: string[] = [];
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private originalStderrWrite: typeof process.stderr.write | null = null;

	constructor(private readonly getSnapshot: () => DashboardSnapshot) {}

	start(): void {
		this.originalStderrWrite = process.stderr.write;
		process.stderr.write = ((chunk: string | Uint8Array): boolean => {
			const text = String(chunk).trimEnd();
			if (text) {
				const cleaned = text.replace(/^\[kota-daemon]\s*/, "");
				this.logBuffer.push(cleaned);
				if (this.logBuffer.length > LOG_BUFFER_MAX) {
					this.logBuffer = this.logBuffer.slice(-MAX_LOG_LINES);
				}
				this.render();
			}
			return true;
		}) as typeof process.stderr.write;

		this.refreshTimer = setInterval(() => this.render(), REFRESH_INTERVAL_MS);
		this.render();
	}

	stop(): void {
		if (this.refreshTimer !== null) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.originalStderrWrite) {
			process.stderr.write = this.originalStderrWrite;
			this.originalStderrWrite = null;
		}
	}

	private render(): void {
		try {
			const snapshot = this.getSnapshot();
			const output = renderDashboard(snapshot, this.logBuffer);
			cursorTo(process.stdout, 0, 0);
			clearScreenDown(process.stdout);
			process.stdout.write(`${output}\n`);
		} catch {
			// Rendering failure must not crash the daemon
		}
	}
}
