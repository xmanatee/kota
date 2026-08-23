import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	claimTask,
	continueTaskClaim,
	markTaskClaimPendingMerge,
} from "./task-claims.js";
import {
	claimInput,
	makeProject,
	writeTask,
} from "./task-claims-test-support.js";

let projectDir: string;

beforeEach(() => {
	projectDir = makeProject();
	writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

describe("pending-merge task claim continuation", () => {
	it("retains the preserved worktree lineage when recovery takes ownership", () => {
		expect(
			claimTask(
				claimInput(
					projectDir,
					"task-alpha",
					"run-pending",
					new Date("2026-06-27T01:00:00.000Z"),
				),
			),
		).toMatchObject({ claimed: true });
		markTaskClaimPendingMerge({
			projectDir,
			taskId: "task-alpha",
			runId: "run-pending",
			workflowId: "builder",
			evidence: "runtime-owned text conflicts await bounded resolution",
			now: new Date("2026-06-27T01:01:00.000Z"),
		});

		const continued = continueTaskClaim({
			projectDir,
			taskId: "task-alpha",
			sourceRunId: "run-pending",
			runId: "run-recovery",
			workflowId: "builder",
			owner: "workflow:builder",
			evidence: "bounded pending-merge recovery accepted",
			now: new Date("2026-06-27T02:00:00.000Z"),
		});

		expect(continued).toMatchObject({
			claimed: true,
			recoveryPath: "continued-preserved-claim",
			claim: {
				runId: "run-recovery",
				worktreeRunId: "run-pending",
				status: "active",
			},
		});
		const historyDir = join(projectDir, ".kota/task-claims/history/task-alpha");
		const historyPath = join(historyDir, readdirSync(historyDir)[0] ?? "missing");
		expect(JSON.parse(readFileSync(historyPath, "utf8"))).toMatchObject({
			runId: "run-pending",
			status: "pending-merge",
		});
	});
});
