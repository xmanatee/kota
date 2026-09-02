import type { WorkflowRunStatus } from "#core/workflow/run-types.js";
import {
	blank,
	line,
	plain,
	type RenderNode,
	type SemanticRole,
	sectionRule,
	span,
	stack,
	type TextSpan,
} from "#modules/rendering/primitives.js";
import {
	describeWaitUntil,
	formatQueueCountsRow,
	MAX_LOG_LINES,
	pendingRunLine,
	renderActiveRuns,
	renderControlHelp,
	renderStatRows,
	taskQueueHasDispatchableWork,
	taskQueueHasSignal,
} from "./dashboard-render-support.js";
import type { DashboardSnapshot } from "./dashboard-types.js";
import { formatTimeAgo, formatUptime } from "./format-utils.js";

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

function describeOperationalState(snapshot: DashboardSnapshot): TextSpan[] {
	if (snapshot.agentOperatingState?.state === "quality-paused") {
		return [
			span(`${snapshot.agentOperatingState.runtimeId} quality-paused`, "error"),
			plain(" - inspect `kota workflow status`; resume only with `--retry-agent` after review"),
		];
	}
	if (snapshot.agentOperatingState?.state === "quota-parked") {
		return [
			span(
				`${snapshot.agentOperatingState.runtimeId} quota-parked until ${new Date(snapshot.agentOperatingState.resumeAt!).toLocaleTimeString()}`,
				"warn",
			),
			plain(" - deterministic maintenance remains available"),
		];
	}
	if (snapshot.agentOperatingState?.state === "provider-parked") {
		return [
			span(
				`${snapshot.agentOperatingState.runtimeId} provider-parked until ${new Date(snapshot.agentOperatingState.resumeAt!).toLocaleTimeString()}`,
				"warn",
			),
			plain(" - inspect `kota workflow status`; fix provider/setup before `kota workflow resume --retry-agent`"),
		];
	}
	if (snapshot.dispatchPaused) {
		if (snapshot.dispatchPause?.kind === "operator") {
			return [
				span("dispatch paused by operator", "warn"),
				plain(" - run `kota workflow resume` or open `kota navigate` > Runtime"),
			];
		}
		return [
			span("dispatch paused", "warn"),
			plain(" - inspect `kota workflow status` before resuming"),
		];
	}
	if (snapshot.dispatchWindowBlocked) {
		const opens = snapshot.dispatchWindowOpensAt
			? ` until ${new Date(snapshot.dispatchWindowOpensAt).toLocaleTimeString()}`
			: "";
		return [
			span(`outside dispatch window${opens}`, "warn"),
			plain(" - inspect with `kota workflow status`; reload config with `kota daemon reload`"),
		];
	}
	if (snapshot.agentBackoff) {
		return [
			span(
				`agent backoff ${snapshot.agentBackoff.kind} until ${new Date(snapshot.agentBackoff.until).toLocaleTimeString()}`,
				"warn",
			),
			plain(" - inspect with `kota workflow status`; fix provider/setup before resume"),
		];
	}
	if (snapshot.activeRuns.length > 0) {
		const prefix = snapshot.agentOperatingState?.state === "working"
			? `${snapshot.agentOperatingState.runtimeId} working; `
			: "";
		return [span(`${prefix}running ${snapshot.activeRuns.map((run) => run.workflow).join(", ")}`, "success")];
	}
	const readyPending = snapshot.pendingRuns.filter((run) => run.notBeforeMs <= Date.now());
	if (readyPending.length > 0) {
		return [
			span(
				`${readyPending.length} queued run${readyPending.length === 1 ? "" : "s"} ready`,
				"success",
			),
		];
	}
	if (snapshot.taskQueue) {
		if (taskQueueHasDispatchableWork(snapshot.taskQueue)) {
			return [plain("dispatchable work available; waiting for idle dispatch - inspect `kota workflow status`")];
		}
		if (snapshot.taskQueue.activeCount > 0) {
			return [plain("open work parked; no dispatchable tasks - inspect `kota status` or open `kota navigate` > Work")];
		}
	}
	if (snapshot.pendingRuns.length > 0) {
		const next = snapshot.pendingRuns.reduce((best, run) =>
			run.notBeforeMs < best.notBeforeMs ? run : best,
		);
		const wait = describeWaitUntil(next.notBeforeMs);
		const tail = wait.role ? span(wait.text, wait.role) : plain(wait.text);
		return [plain(`waiting for ${next.workflowName} `), tail];
	}
	const prefix = snapshot.agentOperatingState?.state === "idle"
		? `${snapshot.agentOperatingState.runtimeId} idle; `
		: "idle; ";
	return [plain(`${prefix}no queued or dispatchable work - review \`kota inbox\` or open \`kota navigate\` > Inbox`)];
}

function statusHeaderSpan(snapshot: DashboardSnapshot): TextSpan {
	if (snapshot.stopping) return span("stopping", "warn");
	if (snapshot.running) return span("running", "success");
	return span("stopped", "error");
}

function renderWorkSection(snapshot: DashboardSnapshot): RenderNode[] {
	if (!snapshot.taskQueue || !taskQueueHasSignal(snapshot.taskQueue)) return [];
	const task = snapshot.taskQueue;
	return [
		line(span("Work", undefined, true)),
		line(plain(`  ${formatQueueCountsRow(task)}`)),
		line(
			plain(
				`  Active ${task.activeCount}  Dispatchable ${task.dispatchableCount}` +
					`  Actionable ${task.actionableCount}`,
			),
		),
		blank(),
	];
}

function renderPendingRuns(snapshot: DashboardSnapshot): RenderNode[] {
	const pendingCount = snapshot.pendingRuns.length;
	if (pendingCount === 0) return [];
	const nodes: RenderNode[] = [line(span(`Pending (${pendingCount})`, undefined, true))];
	const sorted = snapshot.pendingRuns.slice().sort((a, b) => a.notBeforeMs - b.notBeforeMs);
	for (const run of sorted.slice(0, 5)) nodes.push(pendingRunLine(run));
	if (pendingCount > 5) nodes.push(line(span(`  +${pendingCount - 5} more`, "muted")));
	nodes.push(blank());
	return nodes;
}

function renderLastCompleted(snapshot: DashboardSnapshot): RenderNode[] {
	if (!snapshot.lastCompletedWorkflow || !snapshot.lastCompletedAt) return [];
	const status = snapshot.lastCompletedStatus
		? statusRunText(snapshot.lastCompletedStatus)
		: null;
	return [
		line(span("Last", undefined, true)),
		line(
			plain(`  ${snapshot.lastCompletedWorkflow}  `),
			status ? span(status.text, status.role) : plain(""),
			plain("  "),
			span(formatTimeAgo(snapshot.lastCompletedAt), "muted"),
		),
		blank(),
	];
}

export function buildDashboardNode(
	snapshot: DashboardSnapshot,
	logs: readonly string[],
): RenderNode {
	const children: RenderNode[] = [];
	children.push(
		line(
			span("KOTA Daemon", undefined, true),
			plain(`  pid ${snapshot.pid}  up ${formatUptime(snapshot.startedAt)}  `),
			statusHeaderSpan(snapshot),
		),
		blank(),
	);
	children.push(...renderStatRows(snapshot, snapshot.pendingRuns.length), blank());
	children.push(line(span("State", undefined, true)));
	children.push(line(plain("  "), ...describeOperationalState(snapshot)));
	children.push(blank());
	children.push(...renderWorkSection(snapshot));
	children.push(...renderActiveRuns(snapshot));
	children.push(...renderPendingRuns(snapshot));
	children.push(...renderLastCompleted(snapshot));
	children.push(...renderControlHelp());

	if (logs.length > 0) {
		children.push(sectionRule("Activity"));
		for (const log of logs.slice(-MAX_LOG_LINES)) {
			children.push(line(span(`  ${log}`, "muted")));
		}
	}

	return stack(...children);
}
