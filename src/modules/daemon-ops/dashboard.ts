import { clearScreenDown, cursorTo } from "node:readline";
import { styleText } from "node:util";
import type { WorkflowRunStatus } from "#core/workflow/run-types.js";

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

function formatUptime(startedAt: string): string {
	const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function formatDuration(startedAt: string): string {
	const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
	const minutes = Math.floor(seconds / 60);
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

function formatTimeAgo(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ago`;
	if (minutes > 0) return `${minutes}m ago`;
	return `${seconds}s ago`;
}

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

export function renderDashboard(
	snapshot: DashboardSnapshot,
	logs: readonly string[],
): string {
	const lines: string[] = [];
	const rule = styleText("dim", "\u2500".repeat(52));

	const status = snapshot.stopping
		? styleText("yellow", "stopping")
		: snapshot.running
			? styleText("green", "running")
			: styleText("red", "stopped");
	const uptime = formatUptime(snapshot.startedAt);
	lines.push(
		`${styleText("bold", "KOTA Daemon")}  pid ${snapshot.pid}  up ${uptime}  ${status}`,
	);
	lines.push(rule);
	lines.push("");

	const costStr =
		snapshot.totalCostUsd != null
			? `$${snapshot.totalCostUsd.toFixed(2)}`
			: "-";
	const pausedStr = snapshot.dispatchPaused
		? styleText("yellow", "yes")
		: "no";

	lines.push(
		`  Completed  ${String(snapshot.completedRuns).padEnd(8)}Sessions  ${snapshot.sessionCount}`,
	);
	lines.push(
		`  Cost       ${costStr.padEnd(8)}Defs      ${snapshot.definitionCount}`,
	);
	lines.push(`  Paused     ${pausedStr}`);
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
		lines.push(rule);
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
