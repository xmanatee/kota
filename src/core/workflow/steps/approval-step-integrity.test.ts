import {
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { WorkflowApprovalStepInput } from "../step-input-control-flow.js";
import { executeApprovalStep } from "./step-executor-approval.js";

let queue: ApprovalQueue;
let tmpDir: string;

beforeEach(() => {
	vi.useFakeTimers();
	tmpDir = mkdtempSync(join(tmpdir(), "approval-step-integrity-test-"));
	queue = new ApprovalQueue(tmpDir);
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	rmSync(tmpDir, { recursive: true, force: true });
});

function makeContext() {
	return {
		workspaceRoot: "/project",
		workflow: {
			name: "test-wf",
			definitionPath: "src/wf.ts",
			runId: "run-1",
			runDir: ".kota/runs/run-1",
			runDirPath: "/project/.kota/runs/run-1",
		},
		trigger: { event: "runtime.idle" as const, payload: {} },
		approvalQueue: queue,
		previousOutput: null,
		stepOutputs: {},
		stepResults: {},
		stepOutputList: [],
		runTool: () => Promise.reject(new Error("not used")),
		emit: vi.fn(),
		requestRestart: () => {},
		readPrompt: () => "",
		readRuntimeState: () => ({ completedRuns: 0, workflows: {} }),
		triggerWorkflow: () => Promise.reject(new Error("not used")),
	};
}

function makeApprovalStep(
	overrides: Partial<WorkflowApprovalStepInput> = {},
): WorkflowApprovalStepInput {
	return { id: "gate", type: "approval", ...overrides };
}

describe("executeApprovalStep scope-local record integrity", () => {
	it.each(["edit", "replace"] as const)(
		"does not resume when a same-user writer %ss a pending gate record",
		async (mutation) => {
			const stepPromise = executeApprovalStep(
				makeApprovalStep() as never,
				makeContext() as never,
				new AbortController().signal,
			);
			const rejectedStep = expect(stepPromise).rejects.toThrow(
				/authenticated approval resolution|integrity/i,
			);
			const pending = queue.list("pending");
			expect(pending).toHaveLength(1);
			const recordPath = join(tmpDir, `${pending[0].id}.json`);
			const stored = JSON.parse(readFileSync(recordPath, "utf8"));
			if (mutation === "replace") unlinkSync(recordPath);
			writeFileSync(recordPath, JSON.stringify({
				...stored,
				status: "approved",
				resolvedAt: new Date().toISOString(),
				resolutionSource: "human",
			}, null, 2));

			await vi.runOnlyPendingTimersAsync();

			await rejectedStep;
		},
	);

	it("does not let the endpoint authenticate a pending record for a different run", async () => {
		const stepPromise = executeApprovalStep(
			makeApprovalStep() as never,
			makeContext() as never,
			new AbortController().signal,
		);
		const rejectedStep = expect(stepPromise).rejects.toThrow(
			/authenticated approval resolution|integrity/i,
		);
		const pending = queue.list("pending");
		const recordPath = join(tmpDir, `${pending[0].id}.json`);
		const stored = JSON.parse(readFileSync(recordPath, "utf8"));
		writeFileSync(recordPath, JSON.stringify({
			...stored,
			input: {
				...stored.input,
				runId: "substituted-run",
			},
		}, null, 2));
		expect(queue.getExecutionSnapshot(pending[0].id)).toMatchObject({
			ok: false,
			reason: "descriptor_mismatch",
			approval: {
				id: pending[0].id,
				status: "pending",
				input: { runId: "substituted-run" },
			},
		});

		await vi.runOnlyPendingTimersAsync();

		await rejectedStep;
	});

	it("emits an approved expiry only after authenticating the original timeout policy", async () => {
		const ctx = makeContext();
		const stepPromise = executeApprovalStep(
			makeApprovalStep({ timeoutMs: 1, defaultResolution: "approve" }) as never,
			ctx as never,
			new AbortController().signal,
		);

		vi.advanceTimersByTime(10);
		queue.expireStale(1);
		await vi.runOnlyPendingTimersAsync();

		await expect(stepPromise).resolves.toMatchObject({ approved: true });
		const expiredCalls = ctx.emit.mock.calls.filter(
			([event]) => event === "workflow.approval.expired",
		);
		expect(expiredCalls).toHaveLength(1);
		expect(expiredCalls[0][1]).toMatchObject({
			workflowName: "test-wf",
			runId: "run-1",
			stepId: "gate",
			resolution: "approve",
		});
	});

	it("does not resume through forged pending timeout policy", async () => {
		const stepPromise = executeApprovalStep(
			makeApprovalStep({ defaultResolution: "deny" }) as never,
			makeContext() as never,
			new AbortController().signal,
		);
		const rejectedStep = expect(stepPromise).rejects.toThrow(
			/authenticated approval resolution|integrity/i,
		);
		const pending = queue.list("pending");
		const recordPath = join(tmpDir, `${pending[0].id}.json`);
		const stored = JSON.parse(readFileSync(recordPath, "utf8"));
		writeFileSync(recordPath, JSON.stringify({
			...stored,
			createdAt: new Date(Date.now() - 60_000).toISOString(),
			timeoutMs: 1,
			defaultResolution: "approve",
		}, null, 2));

		expect(queue.expireStale()).toMatchObject({
			expired: [],
			blocked: [{
				approvalId: pending[0].id,
				reason: "pending_integrity_unavailable",
			}],
		});
		await vi.runOnlyPendingTimersAsync();

		await rejectedStep;
		expect(queue.list("approved")).toHaveLength(0);
	});
});
