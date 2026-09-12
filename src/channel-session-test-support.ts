import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { KotaMessageStream, KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { createScopeRuntime, type ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { EventBus } from "#core/events/event-bus.js";
import { type MessageStreamParams, registerModelClientFactory } from "#core/model/model-client.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

// Shared Telegram/Slack composition: real session dependencies, with only the
// external model response controlled. Channel transports remain in their owners.
export function channelSessionFixture() {
	const root = mkdtempSync(join(tmpdir(), "kota-channel-session-"));
	const runState = new RunStateDatabase(join(root, ".kota"));
	const now = new Date().toISOString();
	const daemonEpoch = runState.beginDaemonSession(now).epoch;
	const runtimes = new Map<string, ScopeRuntime>();
	const coordinator = new RunCoordinator({
		store: runState,
		daemonEpoch,
		concurrency: 1,
		execute: () => {
			throw new Error("Channel delivery must not execute workflows");
		},
	});
	const loader = new ModuleLoader({});
	const modelRequests: MessageStreamParams[] = [];
	const respond = vi.fn(
		async (): Promise<KotaModelResponse> => ({
			id: "controlled",
			role: "assistant",
			model: "controlled",
			content: [{ type: "text", text: "Delivered model reply" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 1, output_tokens: 1 },
		}),
	);
	registerModelClientFactory(({ model }) => ({
		model,
		providerName: "controlled",
		client: {
			messages: {
				create: () => respond(),
				stream(params): KotaMessageStream {
					modelRequests.push(structuredClone({ ...params, signal: undefined }));
					const callbacks: ((text: string) => void)[] = [];
					return {
						on(event, callback) {
							if (event === "text") callbacks.push(callback);
							return this;
						},
						async finalMessage() {
							const result = await respond();
							for (const block of result.content) {
								if (block.type === "text") for (const callback of callbacks) callback(block.text);
							}
							return result;
						},
					};
				},
			},
		},
	}));
	return {
		loader,
		modelRequests,
		respond,
		runtime(scopeId = "test-scope") {
			let runtime = runtimes.get(scopeId);
			if (runtime) return runtime;
			const scopeRoot = join(root, scopeId);
			mkdirSync(scopeRoot);
			const scope = { ...buildDirectoryScope({ scopeRoot }), scopeId };
			runState.registerScope({
				id: scopeId,
				rootPath: scopeRoot,
				displayName: scopeId,
				createdAt: now,
			});
			runtime = createScopeRuntime({
				scope,
				bus: new EventBus(),
				onLog: () => {},
				installSingletons: false,
				runState,
				runCoordinator: coordinator,
				daemonEpoch,
			});
			runtimes.set(scopeId, runtime);
			return runtime;
		},
		async close() {
			await loader.unloadAll();
			for (const runtime of runtimes.values()) {
				runtime.scheduler.stopTimer();
				runtime.scheduler.disconnectBus();
				await runtime.workflowRuntime.stop();
			}
			runState.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
