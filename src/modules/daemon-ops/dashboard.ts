import { type RenderContext, render } from "#modules/rendering/render.js";
import { renderToString, TerminalScreenSession } from "#modules/rendering/transport.js";
import { buildDashboardNode } from "./dashboard-node.js";
import {
	LOG_BUFFER_MAX,
	REFRESH_INTERVAL_MS,
} from "./dashboard-render-support.js";
import type { DashboardSnapshot } from "./dashboard-types.js";

export { buildDashboardNode } from "./dashboard-node.js";
export { formatStatsGrid } from "./dashboard-render-support.js";
export type { DashboardSnapshot, DashboardTaskQueue } from "./dashboard-types.js";

export function renderDashboard(
	snapshot: DashboardSnapshot,
	logs: readonly string[],
	ctx?: Partial<RenderContext>,
): string {
	if (ctx) return render(buildDashboardNode(snapshot, logs), ctx);
	return renderToString(buildDashboardNode(snapshot, logs));
}

export class DaemonDashboard {
	private logBuffer: string[] = [];
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private originalStderrWrite: typeof process.stderr.write | null = null;
	private readonly screen = new TerminalScreenSession();

	constructor(private readonly getSnapshot: () => DashboardSnapshot) {}

	start(): void {
		this.screen.start();

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
		this.screen.stop();
	}

	private render(): void {
		try {
			const snapshot = this.getSnapshot();
			const output = renderDashboard(snapshot, this.logBuffer);
			this.screen.writeFrame(output);
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
