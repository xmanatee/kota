import { describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "./dashboard.js";
import { renderDashboard } from "./dashboard.js";

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
		pendingRuns: [],
		dispatchPaused: false,
		definitionCount: 5,
		sessionCount: 2,
		...overrides,
	};
}

describe("dashboard foreground control affordances", () => {
	it("renders a controls footer with the canonical operator commands", () => {
		const output = stripAnsi(renderDashboard(makeSnapshot(), []));
		expect(output).toContain("Controls");
		expect(output).toContain("Host/dashboard only; this terminal does not read commands.");
		expect(output).toContain("kota status");
		expect(output).toContain("kota inbox");
		expect(output).toContain("kota workflow status");
		expect(output).toContain("kota workflow pause");
		expect(output).toContain("kota workflow resume");
		expect(output).toContain("kota workflow follow");
		expect(output).toContain("kota navigate");
		expect(output).toContain("kota ui render runs");
		expect(output).toContain("kota daemon reload");
		expect(output).toContain("kota daemon stop");
	});

	it("shows paused dispatch with the exact resume and operator-client paths", () => {
		const output = stripAnsi(
			renderDashboard(
				makeSnapshot({
					dispatchPaused: true,
					dispatchPause: {
						paused: true,
						kind: "operator",
						source: "signal",
						message: "Persistent operator pause.",
						nextAction: "Run `kota workflow resume` to re-enable dispatch.",
					},
				}),
				[],
			),
		);
		expect(output).toContain("dispatch paused by operator - run `kota workflow resume`");
		expect(output).toContain("open `kota navigate` > Runtime");
	});

	it("shows dispatch-window blockage with inspection and reload paths", () => {
		const output = stripAnsi(
			renderDashboard(
				makeSnapshot({
					dispatchWindowBlocked: true,
					dispatchWindowOpensAt: "2026-07-06T12:00:00.000Z",
				}),
				[],
			),
		);
		expect(output).toContain("outside dispatch window");
		expect(output).toContain("inspect with `kota workflow status`");
		expect(output).toContain("reload config with `kota daemon reload`");
	});

	it("shows idle no-actionable-work state with inbox and navigator paths", () => {
		const output = stripAnsi(renderDashboard(makeSnapshot(), []));
		expect(output).toContain("idle; no queued or dispatchable work");
		expect(output).toContain("review `kota inbox`");
		expect(output).toContain("open `kota navigate` > Inbox");
	});

});
