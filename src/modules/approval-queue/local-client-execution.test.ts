import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { listActiveApprovalExecutionIds } from "#core/daemon/approval-execution-activity.js";
import {
	ApprovalQueue,
	resetApprovalQueue,
} from "#core/daemon/approval-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import {
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import {
	clearCustomTools,
	registerTool,
} from "#core/tools/index.js";
import approvalQueueModule from "./index.js";

const TOOL_NAME = "channel_approval_execution_test";
const testTool: KotaTool = {
	name: TOOL_NAME,
	description: "Records an approval-channel execution",
	input_schema: { type: "object", properties: {} },
};

let testDir: string | undefined;

afterEach(() => {
	clearCustomTools();
	resetProviderRegistry();
	resetApprovalQueue();
	if (testDir !== undefined) rmSync(testDir, { recursive: true, force: true });
	testDir = undefined;
});

describe("approval-queue local client execution", () => {
	it("dispatches through the daemon runtime registered after client construction", async () => {
		testDir = mkdtempSync(join(tmpdir(), "approval-local-client-"));
		const project = buildConfiguredProject({
			projectDir: testDir,
			displayName: "approval runtime",
		});
		const queue = new ApprovalQueue(
			join(testDir, ".kota", "approvals"),
			null,
			{ scopeId: project.projectId },
		);
		const client = approvalQueueModule.localClient!({} as never).approvals!;
		initProviderRegistry().register(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE, "daemon", {
			getProjectRegistryProjection: () => ({
				defaultProjectId: project.projectId,
				projects: [project],
			}),
			getActiveProjectId: () => project.projectId,
			resolveProjectRuntime: () => ({
				ok: true,
				runtime: {
					project,
					approvalQueue: queue,
					secretStore: {} as never,
					ownerDecisionStore: {} as never,
					ownerQuestionQueue: {} as never,
				},
			}),
		});
		let finishExecution!: () => void;
		const run = vi.fn(() => new Promise<{ content: string }>((resolve) => {
			finishExecution = () => resolve({ content: "executed" });
		}));
		registerTool(testTool, run);
		const pending = queue.enqueue(
			TOOL_NAME,
			{ operation: "deploy", accessToken: "raw-secret" },
			"dangerous",
			"deploy production",
		);
		const review = queue.projectForClient(pending).review;
		if (review.status !== "available") throw new Error("expected review descriptor");

		const approval = client.approve(
			pending.id,
			review.digest,
			undefined,
			{ projectId: project.projectId },
		);
		await vi.waitFor(() => {
			expect(queue.get(pending.id)?.status).toBe("approved");
			expect(listActiveApprovalExecutionIds(queue)).toEqual([pending.id]);
		});
		finishExecution();
		const result = await approval;

		expect(result).toMatchObject({
			ok: true,
			approval: { id: pending.id, status: "approved" },
			resolution: {
				kind: "tool_execution",
				execution: { status: "succeeded", output: { redacted: true, reason: "tool-io" } },
			},
		});
		expect(run).toHaveBeenCalledWith(
			{ operation: "deploy", accessToken: "raw-secret" },
			expect.objectContaining({
				cwd: testDir,
				projectId: project.projectId,
				scopeId: project.projectId,
			}),
		);
		expect(listActiveApprovalExecutionIds(queue)).toEqual([]);
	});
});
