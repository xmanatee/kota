import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DaemonDashboard,
	type DashboardSnapshot,
	formatStatsGrid,
	renderDashboard,
} from "./dashboard.js";

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching the ESC control char
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeSnapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
	return {
		pid: 12345,
		startedAt: new Date(Date.now() - 3_600_000).toISOString(),
		running: true,
		stopping: false,
		completedRuns: 42,
		activeRuns: [],
		pendingRunCount: 0,
		queueLength: 0,
		dispatchPaused: false,
		definitionCount: 5,
		sessionCount: 2,
		...overrides,
	};
}

describe("renderDashboard", () => {
	it("shows daemon header with pid and uptime", () => {
		const output = stripAnsi(renderDashboard(makeSnapshot(), []));
		expect(output).toContain("KOTA Daemon");
		expect(output).toContain("pid 12345");
		expect(output).toContain("running");
	});

	it("shows completed runs and session count", () => {
		const output = stripAnsi(renderDashboard(makeSnapshot(), []));
		expect(output).toContain("42");
		expect(output).toContain("Sessions  2");
	});

	it("shows definition count", () => {
		const output = stripAnsi(renderDashboard(makeSnapshot(), []));
		expect(output).toContain("Defs      5");
	});

	it("never collides cost value with the next label even at large amounts", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ totalCostUsd: 1930.84 }), []),
		);
		expect(output).toContain("$1930.84");
		expect(output).not.toMatch(/\$\d[\d.]*Defs/);
		expect(output).toMatch(/Cost\s+\$1930\.84\s{2,}Defs/);
	});

	it("never collides completed run count with the next label at high counts", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ completedRuns: 12345678 }), []),
		);
		expect(output).toMatch(/Completed\s+12345678\s{2,}Sessions/);
	});

	it("shows stopping status", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ stopping: true }), []),
		);
		expect(output).toContain("stopping");
	});

	it("shows stopped status when not running", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ running: false }), []),
		);
		expect(output).toContain("stopped");
	});

	it("shows paused indicator when dispatch is paused", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ dispatchPaused: true }), []),
		);
		expect(output).toContain("Paused     yes");
	});

	it("shows active runs with duration", () => {
		const snapshot = makeSnapshot({
			activeRuns: [
				{
					runId: "run-1",
					workflow: "builder",
					startedAt: new Date(Date.now() - 90_000).toISOString(),
				},
			],
		});
		const output = stripAnsi(renderDashboard(snapshot, []));
		expect(output).toContain("Active (1)");
		expect(output).toContain("builder");
		expect(output).toContain("1m 30s");
	});

	it("shows pending run count", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ pendingRunCount: 3 }), []),
		);
		expect(output).toContain("Pending 3");
	});

	it("shows last completed workflow", () => {
		const snapshot = makeSnapshot({
			lastCompletedWorkflow: "sorter",
			lastCompletedAt: new Date(Date.now() - 300_000).toISOString(),
			lastCompletedStatus: "success",
		});
		const output = stripAnsi(renderDashboard(snapshot, []));
		expect(output).toContain("Last");
		expect(output).toContain("sorter");
		expect(output).toContain("success");
		expect(output).toContain("5m ago");
	});

	it("shows log messages", () => {
		const logs = ["Daemon starting...", "Control API on http://127.0.0.1:8080"];
		const output = stripAnsi(renderDashboard(makeSnapshot(), logs));
		expect(output).toContain("Daemon starting...");
		expect(output).toContain("Control API on http://127.0.0.1:8080");
	});

	it("separates static status from streaming activity with a labeled rule", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot(), ["Daemon starting..."]),
		);
		expect(output).toContain("Activity ");
		const activityIdx = output.indexOf("Activity ");
		expect(activityIdx).toBeGreaterThan(output.indexOf("KOTA Daemon"));
		expect(activityIdx).toBeLessThan(output.indexOf("Daemon starting..."));
	});

	it("does not render decorative dashes that look like a second frame", () => {
		const output = stripAnsi(renderDashboard(makeSnapshot(), []));
		// A standalone full-width row of box-drawing characters would visually
		// duplicate the dashboard frame. Header rules are allowed only as the
		// activity separator (covered above).
		const lines = output.split("\n");
		for (const line of lines) {
			const stripped = line.trim();
			if (/^\u2500{20,}$/.test(stripped)) {
				throw new Error(`unexpected decorative rule line: "${line}"`);
			}
		}
	});

	it("shows cost when available", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ totalCostUsd: 12.5 }), []),
		);
		expect(output).toContain("$12.50");
	});

	it("renders paused indicator only as a single-cell row (no trailing column)", () => {
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ dispatchPaused: true }), []),
		);
		expect(output).toMatch(/Paused\s+yes(\s|$)/m);
	});

	it("truncates logs to 20 lines", () => {
		const logs = Array.from({ length: 30 }, (_, i) => `log line ${i}`);
		const output = stripAnsi(renderDashboard(makeSnapshot(), logs));
		expect(output).not.toContain("log line 0");
		expect(output).toContain("log line 29");
	});
});

describe("formatStatsGrid", () => {
	it("guarantees at least two spaces between value and next label", () => {
		const lines = formatStatsGrid([
			[
				{ label: "Cost", value: "$1930.84" },
				{ label: "Defs", value: "5" },
			],
		]);
		expect(lines[0]).toMatch(/\$1930\.84\s{2,}Defs/);
	});

	it("aligns labels and values across rows by widest entry per column", () => {
		const lines = formatStatsGrid([
			[
				{ label: "Completed", value: "42" },
				{ label: "Sessions", value: "2" },
			],
			[
				{ label: "Cost", value: "$1.00" },
				{ label: "Defs", value: "5" },
			],
		]);
		const completedIdx = lines[0]!.indexOf("Sessions");
		const defsIdx = lines[1]!.indexOf("Defs");
		expect(completedIdx).toBe(defsIdx);
	});

	it("places single-cell rows without padding the only value", () => {
		const lines = formatStatsGrid([[{ label: "Paused", value: "yes" }]]);
		expect(lines[0]).toBe("  Paused  yes");
	});
});

describe("DaemonDashboard", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.spyOn(process.stderr, "write").mockReturnValue(true);
		stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("captures stderr log messages into the dashboard", () => {
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			process.stderr.write("[kota-daemon] Hello world\n");
			expect(stdoutSpy).toHaveBeenCalled();
			const rendered = stripAnsi(
				stdoutSpy.mock.calls.at(-1)?.[0] as string,
			);
			expect(rendered).toContain("Hello world");
		} finally {
			dashboard.stop();
		}
	});

	it("strips [kota-daemon] prefix from captured logs", () => {
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			process.stderr.write("[kota-daemon] Daemon starting...\n");
			const rendered = stripAnsi(
				stdoutSpy.mock.calls.at(-1)?.[0] as string,
			);
			expect(rendered).toContain("Daemon starting...");
			expect(rendered).not.toContain("[kota-daemon]");
		} finally {
			dashboard.stop();
		}
	});

	it("restores stderr on stop", () => {
		const writeBeforeStart = process.stderr.write;
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		const writeAfterStart = process.stderr.write;
		expect(writeAfterStart).not.toBe(writeBeforeStart);
		dashboard.stop();
		expect(process.stderr.write).toBe(writeBeforeStart);
	});
});
