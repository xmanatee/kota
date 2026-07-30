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
			const projectDir = ctx.projectDir;
			const bot = new SlackBot({
				botToken: config.botToken,
				appToken: config.appToken,
				notifyChannel: config.notifyChannel,
				config: moduleCtx.config,
				autonomyMode,
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
							projectId: ctx.defaultProjectRuntime.project.projectId,
							config: config.inboundSignals,
							events: moduleCtx.events,
						}
					: undefined,
				attention: {
					snapshot: () => renderOnDemandAttention({
						projectDir,
						runsDir: ctx.getWorkflowStatus().runsDir,
					}),
				},
				digest: { snapshot: () => renderOnDemandDigest({ projectDir }) },
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

			return {
				status: "started",
				adapter: {
					async start() { await bot.start(); },
					stop() {
						unsubscribeApproval();
						bot.stop();
					},
				},
			};
		},
	};
}
