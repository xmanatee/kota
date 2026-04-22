import { clearScreenDown, cursorTo } from "node:readline";
import type { WorkflowQueuedRun, WorkflowRunStatus } from "#core/workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "#core/workflow/types.js";
import {
	blank,
	type LineNode,
	line,
	plain,
	type RenderNode,
	type SemanticRole,
	span,
	stack,
	type TextSpan,
} from "#modules/rendering/primitives.js";
import { renderToString } from "#modules/rendering/transport.js";
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
	pendingRuns: WorkflowQueuedRun[];
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
const ACTIVITY_HEADER_WIDTH = 52;

type StatusTextRole = { text: string; role: SemanticRole };

function statusRunText(status: WorkflowRunStatus): StatusTextRole {
	switch (status) {
		case "success":
			return { text: "success", role: "success" };
		case "failed":
			return { text: "failed", role: "error" };
		case "interrupted":
			return { text: "interrupted", role: "warn" };
		case "completed-with-warnings":
			return { text: "warnings", role: "warn" };
	}
}

type WaitDescriptor = { text: string; role?: SemanticRole };

function describeWaitUntil(notBeforeMs: number): WaitDescriptor {
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

function pendingRunLine(run: WorkflowQueuedRun): LineNode {
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

function describeOperationalState(
	snapshot: DashboardSnapshot,
	pendingRuns: readonly WorkflowQueuedRun[],
): TextSpan[] {
	if (snapshot.dispatchPaused) return [span("dispatch paused", "warn")];
	if (snapshot.dispatchWindowBlocked) {
		const opens = snapshot.dispatchWindowOpensAt
			? ` until ${new Date(snapshot.dispatchWindowOpensAt).toLocaleTimeString()}`
			: "";
		return [span(`outside dispatch window${opens}`, "warn")];
	}
	if (snapshot.agentBackoff) {
		return [
			span(
				`agent backoff ${snapshot.agentBackoff.kind} until ${new Date(snapshot.agentBackoff.until).toLocaleTimeString()}`,
				"warn",
			),
		];
	}
	if (snapshot.activeRuns.length > 0) {
		const names = snapshot.activeRuns.map((run) => run.workflow).join(", ");
		return [span(`running ${names}`, "success")];
	}
	const readyPending = pendingRuns.filter((run) => run.notBeforeMs <= Date.now());
	if (readyPending.length > 0) {
		return [
			span(
				`${readyPending.length} queued run${readyPending.length === 1 ? "" : "s"} ready`,
				"success",
			),
		];
	}
	if (snapshot.taskQueue && (snapshot.taskQueue.inboxCount > 0 || snapshot.taskQueue.pullableCount > 0)) {
		return [plain("work available; waiting for idle dispatch")];
	}
	if (pendingRuns.length > 0) {
		const next = pendingRuns.reduce((best, run) =>
			run.notBeforeMs < best.notBeforeMs ? run : best,
		);
		const wait = describeWaitUntil(next.notBeforeMs);
		const head = plain(`waiting for ${next.workflowName} `);
		const tail = wait.role ? span(wait.text, wait.role) : plain(wait.text);
		return [head, tail];
	}
	return [plain("idle; waiting for work")];
}

type StatCell = { label: string; value: string; valueRole?: SemanticRole };
type StatRow = readonly StatCell[];

/**
 * Lays out a 2D grid of label/value cells with per-column widths sized to the
 * widest entry, guaranteeing at least COLUMN_GAP spaces between each value and
 * the next label so adjacent fields can never collide regardless of cost/count
 * magnitudes.
 */
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

function renderStatRows(snapshot: DashboardSnapshot, pendingCount: number): LineNode[] {
	const costStr =
		snapshot.totalCostUsd != null ? `$${snapshot.totalCostUsd.toFixed(2)}` : "-";
	const pausedCell: StatCell = snapshot.dispatchPaused
		? { label: "Paused", value: "yes", valueRole: "warn" }
		: { label: "Paused", value: "no" };
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
		[pausedCell],
	];
	return formatStatsGrid(statRows);
}

function statusHeaderSpan(snapshot: DashboardSnapshot): TextSpan {
	if (snapshot.stopping) return span("stopping", "warn");
	if (snapshot.running) return span("running", "success");
	return span("stopped", "error");
}

export function buildDashboardNode(
	snapshot: DashboardSnapshot,
	logs: readonly string[],
): RenderNode {
	const children: RenderNode[] = [];
	const uptime = formatUptime(snapshot.startedAt);
	children.push(
		line(
			span("KOTA Daemon", undefined, true),
			plain(`  pid ${snapshot.pid}  up ${uptime}  `),
			statusHeaderSpan(snapshot),
		),
	);
	children.push(blank());

	for (const statLine of renderStatRows(snapshot, snapshot.pendingRuns.length)) {
		children.push(statLine);
	}
	children.push(blank());

	children.push(line(span("State", undefined, true)));
	children.push(line(plain("  "), ...describeOperationalState(snapshot, snapshot.pendingRuns)));
	children.push(blank());

	if (snapshot.taskQueue) {
		const task = snapshot.taskQueue;
		children.push(line(span("Work", undefined, true)));
		children.push(
			line(
				plain(
					`  Inbox ${task.inboxCount}  Ready ${task.counts.ready}  Backlog ${task.counts.backlog}  Doing ${task.counts.doing}  Blocked ${task.counts.blocked}`,
				),
			),
		);
		children.push(
			line(
				plain(
					`  Pullable ${task.pullableCount}  Actionable ${task.actionableCount}  Open ${task.openCount}`,
				),
			),
		);
		children.push(blank());
	}

	if (snapshot.activeRuns.length > 0) {
		children.push(line(span(`Active (${snapshot.activeRuns.length})`, undefined, true)));
		for (const run of snapshot.activeRuns) {
			const dur = formatDuration(run.startedAt);
			children.push(
				line(
					plain("  "),
					span("●", "success"),
					plain(` ${run.workflow}  `),
					span(dur, "muted"),
				),
			);
		}
		children.push(blank());
	}

	const pendingCount = snapshot.pendingRuns.length;
	if (pendingCount > 0) {
		children.push(line(span(`Pending (${pendingCount})`, undefined, true)));
		const sorted = snapshot.pendingRuns
			.slice()
			.sort((a, b) => a.notBeforeMs - b.notBeforeMs);
		for (const run of sorted.slice(0, 5)) {
			children.push(pendingRunLine(run));
		}
		if (pendingCount > 5) {
			children.push(line(span(`  +${pendingCount - 5} more`, "muted")));
		}
		children.push(blank());
	}

	if (snapshot.lastCompletedWorkflow && snapshot.lastCompletedAt) {
		children.push(line(span("Last", undefined, true)));
		const ago = formatTimeAgo(snapshot.lastCompletedAt);
		const statusSpan = snapshot.lastCompletedStatus
			? span(
					statusRunText(snapshot.lastCompletedStatus).text,
					statusRunText(snapshot.lastCompletedStatus).role,
				)
			: plain("");
		children.push(
			line(
				plain(`  ${snapshot.lastCompletedWorkflow}  `),
				statusSpan,
				plain("  "),
				span(ago, "muted"),
			),
		);
		children.push(blank());
	}

	if (logs.length > 0) {
		const heading = "Activity ";
		const fillWidth = Math.max(0, ACTIVITY_HEADER_WIDTH - heading.length);
		children.push(
			line(
				span(heading, undefined, true),
				span("─".repeat(fillWidth), "muted"),
			),
		);
		const visible = logs.slice(-MAX_LOG_LINES);
		for (const log of visible) {
			children.push(line(span(`  ${log}`, "muted")));
		}
	}

	return stack(...children);
}

export function renderDashboard(
	snapshot: DashboardSnapshot,
	logs: readonly string[],
): string {
	return renderToString(buildDashboardNode(snapshot, logs));
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
					this.logBuffer = this.logBuffer.slice(-LOG_BUFFER_MAX);
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
		} catch (error) {
			this.originalStderrWrite?.call(
				process.stderr,
				`[kota-dashboard] render failed: ${formatDashboardError(error)}\n`,
			);
		}
	}
}

function formatDashboardError(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
