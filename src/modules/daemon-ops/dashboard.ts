import { clearScreenDown, cursorTo } from "node:readline";
import { styleText } from "node:util";
import type { WorkflowRunStatus } from "#core/workflow/run-types.js";
import { formatDuration, formatTimeAgo, formatUptime } from "./format-utils.js";

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
	queueLength: number;
	dispatchPaused: boolean;
	definitionCount: number;
	sessionCount: number;
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

	const statRows: StatRow[] = [
		[
			{ label: "Completed", value: String(snapshot.completedRuns) },
			{ label: "Sessions", value: String(snapshot.sessionCount) },
		],
		[
			{ label: "Cost", value: costStr },
			{ label: "Defs", value: String(snapshot.definitionCount) },
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

	if (snapshot.pendingRunCount > 0) {
		lines.push(
			`${styleText("bold", "Pending")} ${snapshot.pendingRunCount}`,
		);
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
