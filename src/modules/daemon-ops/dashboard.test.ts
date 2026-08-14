import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonDashboard, formatStatsGrid } from "./dashboard.js";
import {
	makeSnapshot,
	renderGridLines,
	stripAnsi,
} from "./dashboard-test-support.js";

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

	it("captures stderr log messages into the dashboard", async () => {
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			process.stderr.write("[kota-daemon] Hello world\n");
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(stdoutSpy).toHaveBeenCalled();
			const rendered = stripAnsi(
				stdoutSpy.mock.calls.at(-1)?.[0] as string,
			);
			expect(rendered).toContain("Hello world");
		} finally {
			dashboard.stop();
		}
	});

	it("strips [kota-daemon] prefix from captured logs", async () => {
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			process.stderr.write("[kota-daemon] Daemon starting...\n");
			await new Promise<void>((resolve) => setImmediate(resolve));
			const rendered = stripAnsi(
				stdoutSpy.mock.calls.at(-1)?.[0] as string,
			);
			expect(rendered).toContain("Daemon starting...");
			expect(rendered).not.toContain("[kota-daemon]");
		} finally {
			dashboard.stop();
		}
	});

	it("coalesces stderr bursts into one cached render", async () => {
		const getSnapshot = vi.fn(() => makeSnapshot());
		const dashboard = new DaemonDashboard(getSnapshot);
		dashboard.start();
		try {
			const initialSnapshots = getSnapshot.mock.calls.length;
			for (let index = 0; index < 100; index += 1) {
				process.stderr.write(`[kota-daemon] burst ${index}\n`);
			}
			expect(getSnapshot).toHaveBeenCalledTimes(initialSnapshots);
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(getSnapshot).toHaveBeenCalledTimes(initialSnapshots + 1);
			const rendered = stripAnsi(
				stdoutSpy.mock.calls.at(-1)?.[0] as string,
			);
			expect(rendered).toContain("burst 99");
		} finally {
			dashboard.stop();
		}
	});

	it("does not overlap expensive projection refreshes", async () => {
		vi.useFakeTimers();
		let resolveRefresh: (() => void) | undefined;
		const refreshProjection = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveRefresh = resolve;
				}),
		);
		const dashboard = new DaemonDashboard(() => makeSnapshot(), {
			refreshProjection,
		});
		dashboard.start();
		try {
			expect(refreshProjection).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(5_000);
			expect(refreshProjection).toHaveBeenCalledTimes(1);
			resolveRefresh?.();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(refreshProjection).toHaveBeenCalledTimes(2);
		} finally {
			dashboard.stop();
			vi.useRealTimers();
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
			const calls = stdoutSpy.mock.calls.map(
				(call: unknown[]) => call[0] as string,
			);
			expect(calls[0]).toContain("\x1b[?1049h");
			expect(calls[0]).toContain("\x1b[?25l");
		} finally {
			dashboard.stop();
		}
		const afterStopCalls = stdoutSpy.mock.calls.map(
			(call: unknown[]) => call[0] as string,
		);
		const lastCall = afterStopCalls.at(-1) ?? "";
		expect(lastCall).toContain("\x1b[?1049l");
		expect(lastCall).toContain("\x1b[?25h");
	});

	it("does not enter the alternate screen buffer in non-TTY contexts", () => {
		setIsTTY(false);
		const dashboard = new DaemonDashboard(() => makeSnapshot());
		dashboard.start();
		try {
			const joined = stdoutSpy.mock.calls
				.map((call: unknown[]) => call[0] as string)
				.join("");
			expect(joined).not.toContain("\x1b[?1049h");
			expect(joined).not.toContain("\x1b[?25l");
		} finally {
			dashboard.stop();
		}
		const joinedAfter = stdoutSpy.mock.calls
			.map((call: unknown[]) => call[0] as string)
			.join("");
		expect(joinedAfter).not.toContain("\x1b[?1049l");
	});
});
