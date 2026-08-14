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

export type DaemonDashboardOptions = {
	refreshProjection?: (signal: AbortSignal) => Promise<void>;
};

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
	private renderImmediate: ReturnType<typeof setImmediate> | null = null;
	private refreshInFlight: Promise<void> | null = null;
	private refreshAbortController: AbortController | null = null;
	private active = false;
	private originalStderrWrite: typeof process.stderr.write | null = null;
	private readonly screen = new TerminalScreenSession();

	constructor(
		private readonly getSnapshot: () => DashboardSnapshot,
		private readonly options: DaemonDashboardOptions = {},
	) {}

	start(): void {
		this.active = true;
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
				this.scheduleRender();
			}
			return true;
		}) as typeof process.stderr.write;

		this.refreshTimer = setInterval(() => {
			this.scheduleRender();
			this.refreshProjection();
		}, REFRESH_INTERVAL_MS);
		this.render();
		this.refreshProjection();
	}

	stop(): void {
		this.active = false;
		if (this.refreshTimer !== null) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.renderImmediate !== null) {
			clearImmediate(this.renderImmediate);
			this.renderImmediate = null;
		}
		this.refreshAbortController?.abort();
		this.refreshAbortController = null;
		this.refreshInFlight = null;
		if (this.originalStderrWrite) {
			process.stderr.write = this.originalStderrWrite;
			this.originalStderrWrite = null;
		}
		this.screen.stop();
	}

	private scheduleRender(): void {
		if (!this.active || this.renderImmediate !== null) return;
		this.renderImmediate = setImmediate(() => {
			this.renderImmediate = null;
			this.render();
		});
	}

	private refreshProjection(): void {
		if (this.options.refreshProjection === undefined || this.refreshInFlight !== null) {
			return;
		}
		const abortController = new AbortController();
		this.refreshAbortController = abortController;
		const refresh = this.options.refreshProjection(abortController.signal);
		this.refreshInFlight = refresh;
		void refresh
			.then(() => this.scheduleRender())
			.catch((error) => {
				if (!abortController.signal.aborted) {
					this.reportFailure("projection refresh", formatDashboardError(error));
				}
			})
			.finally(() => {
				if (this.refreshInFlight === refresh) this.refreshInFlight = null;
				if (this.refreshAbortController === abortController) {
					this.refreshAbortController = null;
				}
			});
	}

	private render(): void {
		try {
			const snapshot = this.getSnapshot();
			const output = renderDashboard(snapshot, this.logBuffer);
			this.screen.writeFrame(output);
		} catch (error) {
			this.reportFailure("render", formatDashboardError(error));
		}
	}

	private reportFailure(phase: string, error: string): void {
		this.originalStderrWrite?.call(
			process.stderr,
			`[kota-dashboard] ${phase} failed: ${error}\n`,
		);
	}
}

function formatDashboardError(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
