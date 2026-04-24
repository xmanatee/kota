import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "#modules/rendering/transport.js";
import {
	DaemonDashboard,
	type DashboardSnapshot,
	type DashboardTaskQueue,
	formatStatsGrid,
	renderDashboard,
} from "./dashboard.js";

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching the ESC control char
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderGridLines(lines: ReturnType<typeof formatStatsGrid>): string[] {
	return lines.map((node) => stripAnsi(renderToString(node)));
}

function makeSnapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
	return {
		pid: 12345,
		startedAt: new Date(Date.now() - 3_600_000).toISOString(),
		running: true,
		stopping: false,
		completedRuns: 42,
		activeRuns: [],
		pendingRuns: [],
		dispatchPaused: false,
		definitionCount: 5,
		sessionCount: 2,
		...overrides,
	};
}

function pendingRun(
	workflowName: string,
	notBeforeMs = Date.now(),
): DashboardSnapshot["pendingRuns"][number] {
	return {
		runId: `2026-04-21T17-01-09-667Z-${workflowName}-w8047d`,
		workflowName,
		trigger: { event: "workflow.completed", payload: {} },
		enqueuedAtMs: Date.now() - 60_000,
		notBeforeMs,
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
			renderDashboard(
				makeSnapshot({
					pendingRuns: [
						pendingRun("builder"),
						pendingRun("explorer"),
						pendingRun("improver"),
					],
				}),
				[],
			),
		);
		expect(output).toContain("Pending");
		expect(output).toContain("3");
	});

	it("shows pending run names, trigger events, and readiness", () => {
		const output = stripAnsi(
			renderDashboard(
				makeSnapshot({
					pendingRuns: [
						pendingRun("improver", Date.now() - 1_000),
					],
				}),
				[],
			),
		);
		expect(output).toContain("Pending (1)");
		expect(output).toContain("improver");
		expect(output).toContain("workflow.completed");
		expect(output).toContain("ready");
		expect(output).toContain("w8047d");
	});

	it("shows task queue context when present", () => {
		const output = stripAnsi(
			renderDashboard(
				makeSnapshot({
					taskQueue: {
						inboxCount: 3,
						openCount: 12,
						pullableCount: 8,
						actionableCount: 2,
						counts: {
							backlog: 6,
							ready: 2,
							doing: 0,
							blocked: 3,
							done: 100,
							dropped: 4,
						},
					},
				}),
				[],
			),
		);
		expect(output).toContain("Work");
		expect(output).toContain("Inbox 3");
		expect(output).toContain("Backlog 6");
		expect(output).toContain("Actionable 2");
	});

	it("omits zero-valued states from the Work counts row so it never looks blank", () => {
		const output = stripAnsi(
			renderDashboard(
				makeSnapshot({
					taskQueue: {
						inboxCount: 3,
						openCount: 12,
						pullableCount: 8,
						actionableCount: 2,
						counts: {
							backlog: 6,
							ready: 2,
							doing: 0,
							blocked: 3,
							done: 100,
							dropped: 4,
						},
					},
				}),
				[],
			),
		);
		expect(output).toContain("Work");
		// Doing 0 / Ready etc. with 0 must not render; all-zero noise is what
		// made the Work section look blank in the owner's transcript.
		expect(output).not.toMatch(/Doing\s+0/);
	});

	it("skips the Work section entirely when the task queue has no open signal", () => {
		const emptyQueue: DashboardTaskQueue = {
			inboxCount: 0,
			openCount: 0,
			pullableCount: 0,
			actionableCount: 0,
			counts: {
				backlog: 0,
				ready: 0,
				doing: 0,
				blocked: 0,
				done: 500,
				dropped: 10,
			},
		};
		const output = stripAnsi(
			renderDashboard(makeSnapshot({ taskQueue: emptyQueue }), []),
		);
		expect(output).not.toContain("Work");
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

	it("activity rule fills the available width at each common terminal size", () => {
		const logs = ["Daemon starting..."];
		for (const width of [80, 120, 160]) {
			const output = stripAnsi(
				renderDashboard(makeSnapshot(), logs, { width }),
			);
			const activityLine = output
				.split("\n")
				.find((l) => l.trim().startsWith("Activity "));
			expect(activityLine, `width=${width}`).toBeDefined();
			// The rule should fill the remaining columns (width - "Activity " length)
			// so the section heading never looks like a stray 52-char nub at 160 cols.
			expect(activityLine!.length).toBe(width);
			expect(activityLine!.endsWith("─")).toBe(true);
		}
	});
});

/**
 * Fixture-style regression for the owner's copied-scrollback transcript:
 * the daemon reports 668 done / 1 ready, has nonzero cost and completed
 * runs, has no active/pending runs, and is idle. The snapshot must render
 * cleanly at 80-, 120-, and 160-col terminals with no merged stat cells,
 * no blank Work section, a clean state line, and a width-aware Activity
 * rule leading into the captured log buffer.
 */
describe("renderDashboard - owner transcript regression fixture", () => {
	const fixtureSnapshot: DashboardSnapshot = {
		pid: 54321,
		startedAt: new Date(Date.now() - 7_200_000).toISOString(),
		running: true,
		stopping: false,
		completedRuns: 668,
		totalCostUsd: 1930.84,
		activeRuns: [],
		pendingRuns: [],
		dispatchPaused: false,
		definitionCount: 14,
		sessionCount: 1,
		lastCompletedWorkflow: "builder",
		lastCompletedAt: new Date(Date.now() - 120_000).toISOString(),
		lastCompletedStatus: "success",
		taskQueue: {
			inboxCount: 0,
			openCount: 8,
			pullableCount: 1,
			actionableCount: 1,
			counts: {
				backlog: 0,
				ready: 1,
				doing: 0,
				blocked: 7,
				done: 668,
				dropped: 17,
			},
		},
	};

	const fixtureLogs = [
		"Daemon ready (pid 54321): 14 workflows, 0 scheduled items, poll 30s",
		"[dispatch] runtime.idle: checking queue",
		"[dispatch] no eligible workflow",
		"[heartbeat] 30s elapsed",
	];

	for (const width of [80, 120, 160]) {
		it(`renders the owner regression scenario cleanly at ${width} columns`, () => {
			const output = stripAnsi(
				renderDashboard(fixtureSnapshot, fixtureLogs, { width }),
			);

			// Merged cost/defs regression guard (from the earlier owner transcript).
			expect(output).toMatch(/Cost\s+\$1930\.84\s{2,}Defs/);

			// Exactly one full status block per render; no duplicated frame
			// inside a single render. "KOTA Daemon" header must appear once.
			const kotaOccurrences = output.match(/KOTA Daemon/g) ?? [];
			expect(kotaOccurrences.length).toBe(1);

			// Work section shows actionable signal rather than a row of zeros.
			expect(output).toContain("Work");
			expect(output).toMatch(/Ready\s+1/);
			expect(output).toMatch(/Blocked\s+7/);
			expect(output).not.toMatch(/Doing\s+0/);
			expect(output).not.toMatch(/Backlog\s+0/);

			// Activity rule fills the terminal width — the heading/rule pair
			// must occupy the full column count at every tested size.
			const activityLine = output
				.split("\n")
				.find((l) => l.trim().startsWith("Activity "));
			expect(activityLine, `width=${width}`).toBeDefined();
			expect(activityLine!.length).toBe(width);

			// State and log streams stay visibly separated: Activity heading
			// appears between the static stat/state block and the first log.
			const activityIdx = output.indexOf("Activity ");
			expect(activityIdx).toBeGreaterThan(output.indexOf("State"));
			expect(activityIdx).toBeLessThan(output.indexOf("Daemon ready"));
		});
	}
});

describe("formatStatsGrid", () => {
	it("guarantees at least two spaces between value and next label", () => {
		const lines = renderGridLines(
			formatStatsGrid([
				[
					{ label: "Cost", value: "$1930.84" },
					{ label: "Defs", value: "5" },
				],
			]),
		);
		expect(lines[0]).toMatch(/\$1930\.84\s{2,}Defs/);
	});

	it("aligns labels and values across rows by widest entry per column", () => {
		const lines = renderGridLines(
			formatStatsGrid([
				[
					{ label: "Completed", value: "42" },
					{ label: "Sessions", value: "2" },
				],
				[
					{ label: "Cost", value: "$1.00" },
					{ label: "Defs", value: "5" },
				],
			]),
		);
		const completedIdx = lines[0]!.indexOf("Sessions");
		const defsIdx = lines[1]!.indexOf("Defs");
		expect(completedIdx).toBe(defsIdx);
	});

	it("places single-cell rows without padding the only value", () => {
		const lines = renderGridLines(
			formatStatsGrid([[{ label: "Paused", value: "yes" }]]),
		);
		expect(lines[0]).toBe("  Paused  yes");
	});
});

describe("DaemonDashboard", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	let originalIsTTY: boolean | undefined;

	function setIsTTY(value: boolean): void {
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value,
		});
	}

	beforeEach(() => {
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		originalIsTTY = process.stdout.isTTY;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: originalIsTTY,
		});
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

	it("reports dashboard render failures through the original stderr writer", () => {
		const dashboard = new DaemonDashboard(() => {
			throw new Error("snapshot unavailable");
		});
		dashboard.start();
		try {
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("[kota-dashboard] render failed"),
			);
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("snapshot unavailable"),
			);
		} finally {
			dashboard.stop();
		}
	});

	it("enters the alternate screen buffer on a TTY so refreshes cannot leak into scrollback", () => {
		setIsTTY(true);
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
			expect(calls[0]).toContain("\x1b[?1049h");
			expect(calls[0]).toContain("\x1b[?25l");
		} finally {
			dashboard.stop();
		}
		const afterStopCalls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
		const lastCall = afterStopCalls.at(-1) ?? "";
		expect(lastCall).toContain("\x1b[?1049l");
		expect(lastCall).toContain("\x1b[?25h");
	});

	it("does not enter the alternate screen buffer in non-TTY contexts", () => {
		setIsTTY(false);
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			const joined = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string).join("");
			expect(joined).not.toContain("\x1b[?1049h");
			expect(joined).not.toContain("\x1b[?25l");
		} finally {
			dashboard.stop();
		}
		const joinedAfter = stdoutSpy.mock.calls
			.map((c: unknown[]) => c[0] as string)
			.join("");
		expect(joinedAfter).not.toContain("\x1b[?1049l");
	});
});
