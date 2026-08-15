import type { ChannelDef } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import { SlackBot } from "./bot.js";
import { getSlackChannelConfig } from "./config.js";

export function makeSlackChannelDef(moduleCtx: ModuleContext): ChannelDef {
	return {
		name: "slack-channel",
		description: "Bidirectional Slack bot channel using Socket Mode",
		create(ctx) {
			const config = getSlackChannelConfig(moduleCtx);
			if (!config) {
				ctx.log("[kota-slack] No config — channel disabled");
				return {
					status: "disabled",
					reason: "slack-channel config is missing — set botToken and appToken to enable",
				};
			}

			const autonomyMode = resolveChannelAutonomyMode(
				config.defaultAutonomyMode,
				moduleCtx.config,
				"slack-channel",
			);
			const bot = new SlackBot({
				botToken: config.botToken,
				appToken: config.appToken,
				workspaceId: config.workspaceId,
				allowedUserIds: config.allowedUserIds ?? [],
				notifyChannel: config.notifyChannel,
				config: moduleCtx.config,
				autonomyMode,
				moduleLoader: ctx.moduleLoader,
				getDefaultProjectRuntime: ctx.getDefaultProjectRuntime,
				recall: moduleCtx.client.recall,
				answer: moduleCtx.client.answer,
				capture: moduleCtx.client.capture,
				retract: moduleCtx.client.retract,
				memory: moduleCtx.client.memory,
				knowledge: moduleCtx.client.knowledge,
				history: moduleCtx.client.history,
				tasks: moduleCtx.client.tasks,
				approvals: moduleCtx.client.approvals,
				inboundSignals: config.inboundSignals
					? {
							getProjectId: () =>
								ctx.getDefaultProjectRuntime().project.projectId,
							config: config.inboundSignals,
							events: moduleCtx.events,
						}
					: undefined,
				attention: {
					snapshot: () => renderOnDemandAttention({
						projectDir: ctx.getDefaultProjectRuntime().project.projectDir,
						runsDir: ctx.getWorkflowStatus().runsDir,
					}),
				},
				digest: {
					snapshot: () => renderOnDemandDigest({
						projectDir: ctx.getDefaultProjectRuntime().project.projectDir,
					}),
				},
			});

			const unsubscribeApproval = moduleCtx.events.subscribe(
				"approval.requested",
				(payload) => {
					const id = payload.id as string;
					void moduleCtx.client.approvals.list({ status: "pending" }).then((listed) => {
						const approval = listed.approvals.find((item) => item.id === id);
						return approval ? bot.postApproval(approval) : undefined;
					}).catch((error) => {
						moduleCtx.log.warn(
							`slack-channel: failed to post approval: ${error instanceof Error ? error.message : String(error)}`,
						);
					});
				},
			);
			const unsubscribeScopeLifecycle = moduleCtx.events.subscribe(
				"scope.lifecycle.changed",
				(payload) => {
					if (
						payload.transition === "default-changed" &&
						payload.previousDefaultScopeId !== undefined
					) bot.closeScopeSessions(payload.previousDefaultScopeId);
				},
			);
			let startPromise: Promise<void> | null = null;

			return {
				status: "started",
				adapter: {
					listScopeSessionIds: (scopeId) => bot.listScopeSessionIds(scopeId),
					async start() {
						startPromise = bot.start().catch((error) => {
							const message = error instanceof Error ? error.message : String(error);
							moduleCtx.log.error(`slack-channel poll loop exited: ${message}`);
							ctx.reportFailure(message);
						});
					},
					async stop() {
						unsubscribeApproval();
						unsubscribeScopeLifecycle();
						bot.stop();
						if (startPromise) {
							await startPromise;
							startPromise = null;
						}
					},
				},
			};
		},
	};
}
