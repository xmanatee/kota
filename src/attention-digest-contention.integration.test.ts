import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { type BusEvents, EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import * as blocking from "#core/workflow/blocking-operation.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { ATTENTION_DIGEST_COUNTER_STATE_KEY } from "#modules/autonomy/workflows/attention-digest/step.js";
import attentionDigestWorkflow from "#modules/autonomy/workflows/attention-digest/workflow.js";

// Integration cadence: the shipped workflow's resource declaration must reach
// admission and protect SQLite mutations through success-only publication.
it("commits overlapping digest increments once and coordinates only within the scope", async () => {
	const root = mkdtempSync(join(tmpdir(), "kota-digest-contention-"));
	const bus = new EventBus();
	const store = new RunStateDatabase(join(root, "state"));
	// No network service is used by this scenario; control the OS port probe.
	const allocate = RunResourceAllocator.prototype.allocate;
	const allocator = new RunResourceAllocator(store, {
		portStart: 30_000,
		portEnd: 49_999,
		portRangeSize: 20,
		isPortAvailable: async () => true,
	});
	const allocatorSpy = vi
		.spyOn(RunResourceAllocator.prototype, "allocate")
		.mockImplementation((...args) => allocate.apply(allocator, args));
	const epoch = store.beginDaemonSession(new Date().toISOString()).epoch;
	const runtimes = new Map<string, WorkflowRuntime>();
	const coordinator = new RunCoordinator({
		store,
		daemonEpoch: epoch,
		concurrency: 4,
		execute: (run, signal) =>
			runtimes.get(run.scopeId)!.executeAdmittedRun(run, signal),
		deliverPublication: (publication) =>
			runtimes.get(publication.scopeId)!.deliverPublication(publication),
	});
	const deadLetters = new DeadLetterQueueStore(join(root, "dead-letters"));
	const digests: BusEvents["workflow.attention.digest"][] = [];
	bus.on("workflow.attention.digest", (payload) => digests.push(payload));
	const scopes = ["a", "b"].map((name) => {
		const scopeRoot = join(root, name);
		mkdirSync(scopeRoot);
		writeFileSync(join(scopeRoot, ".gitignore"), ".kota/\n");
		const git = (args: string[]) =>
			execFileSync("git", args, { cwd: scopeRoot, stdio: "ignore" });
		git(["init", "--quiet"]);
		git(["add", ".gitignore"]);
		git([
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--quiet",
			"-m",
			"fixture",
		]);
		const scopeId = deriveDirectoryScopeId(scopeRoot);
		store.registerScope({
			id: scopeId,
			rootPath: scopeRoot,
			createdAt: new Date().toISOString(),
		});
		store.compareAndSetScopeStateValue({
			scopeId,
			key: ATTENTION_DIGEST_COUNTER_STATE_KEY,
			expectedRevision: 0,
			value: { count: name === "a" ? 8 : 0 },
			updatedAt: new Date().toISOString(),
		});
		const pbus = new ScopedEventBus(bus, scopeId);
		const runtime = new WorkflowRuntime({
			bus,
			pbus,
			scopeRoot,
			scopeId,
			runState: store,
			runCoordinator: coordinator,
			daemonEpoch: epoch,
			deadLetterQueue: deadLetters,
			idleIntervalMs: 60_000,
			workflows: [
				registerWorkflowDefinition(
					"attention-digest/workflow.ts",
					attentionDigestWorkflow,
				),
			],
		});
		runtimes.set(scopeId, runtime);
		return { scopeId, pbus, runtime };
	});
	const [first, other] = scopes;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let pending = false;
	const runBlocking = blocking.runWorkflowBlockingOperation;
	const spy = vi
		.spyOn(blocking, "runWorkflowBlockingOperation")
		.mockImplementation(async (operation, input, options) => {
			// Delay only the worker port after the production step has staged count 9.
			if (!pending) {
				pending = true;
				await gate;
			}
			return runBlocking(operation, input, options);
		});
	const completed = (pbus: ScopedEventBus, runId: string) =>
		pbus.emit("workflow.completed", {
			workflow: "builder",
			runId,
			status: "success",
			triggerEvent: "manual",
			durationMs: 1,
			definitionPath: "builder/workflow.ts",
			runDir: `.kota/runs/${runId}`,
			tags: ["monitored"],
		});
	const counter = (scopeId: string) =>
		store.readScopeStateValue(scopeId, ATTENTION_DIGEST_COUNTER_STATE_KEY);
	try {
		for (const { runtime } of scopes) runtime.start();
		completed(first.pbus, "first");
		await vi.waitFor(
			() => expect(pending, JSON.stringify(store.listRuns(first.scopeId))).toBe(true),
			{ timeout: 10_000 },
		);
		expect(counter(first.scopeId)).toEqual({
			revision: 1,
			value: { count: 8 },
		});
		expect(digests).toEqual([]);
		completed(first.pbus, "overlap");
		completed(other.pbus, "independent");
		await vi.waitFor(
			() =>
				expect(
					store
						.listRuns(other.scopeId)
						.filter((run) => run.workflow === "attention-digest")
						.map((run) => run.state),
				).toEqual(["succeeded"]),
			{ timeout: 15_000 },
		);
		expect(counter(other.scopeId)).toEqual({
			revision: 2,
			value: { count: 1 },
		});
		const pendingRuns = store
			.listRuns(first.scopeId)
			.filter((run) => run.workflow === "attention-digest");
		expect(
			pendingRuns.map((run) => run.state).sort(),
			JSON.stringify(pendingRuns),
		).toEqual(["queued", "running"]);
		expect(counter(first.scopeId)).toEqual({
			revision: 1,
			value: { count: 8 },
		});
		expect(digests).toEqual([]);
		release();
		await coordinator.whenIdle();
		expect(
			store
				.listRuns(first.scopeId)
				.filter((run) => run.workflow === "attention-digest")
				.map((run) => run.state),
		).toEqual(["succeeded", "succeeded"]);
		expect(counter(first.scopeId)).toEqual({
			revision: 3,
			value: { count: 10 },
		});
		expect(digests).toEqual([
			expect.objectContaining({
				scopeId: first.scopeId,
				items: [
					{
						label: "Empty task queue",
						detail: "Builder has no open task to pick up.",
					},
				],
				text: "Attention digest (1 item):\n• *Empty task queue*: Builder has no open task to pick up.",
			}),
		]);
		expect(deadLetters.list()).toEqual([]);
	} finally {
		release();
		for (const { runtime } of scopes) await runtime.stop(0);
		await coordinator.dispose();
		spy.mockRestore();
		allocatorSpy.mockRestore();
		store.close();
		rmSync(root, { recursive: true, force: true });
	}
}, 30_000);
