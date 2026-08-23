import { resolveSecretReference } from "#core/config/secret-reference.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { SlackChannelInboundSignalConfig } from "./inbound-signal.js";

export type SlackChannelConfig = {
	botToken: string;
	appToken: string;
	workspaceId?: string;
	allowedUserIds?: readonly string[];
	notifyChannel?: string;
	defaultAutonomyMode?: AutonomyMode;
	inboundSignals?: SlackChannelInboundSignalConfig;
};

export function getSlackChannelConfig(ctx: ModuleContext): SlackChannelConfig | null {
	const config = ctx.getModuleConfig<SlackChannelConfig>();
	if (!config?.botToken || !config?.appToken) return null;
	const botToken = resolveSecretReference(config.botToken, ctx.getSecret);
	const appToken = resolveSecretReference(config.appToken, ctx.getSecret);
	if (!botToken || !appToken) return null;
	return { ...config, botToken, appToken };
}
