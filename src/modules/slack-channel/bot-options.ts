import type { KotaConfig } from "#core/config/config.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import type { SlackCommandClients } from "./commands.js";
import type { SlackChannelInboundSignalConfig } from "./inbound-signal.js";

export type SlackInboundSignalRuntime = {
	getScopeId: () => string;
	config: SlackChannelInboundSignalConfig;
	events: Pick<ModuleContext["events"], "emit">;
};

export type SlackBotOptions = SlackCommandClients & {
	botToken: string;
	appToken: string;
	workspaceId?: string;
	allowedUserIds: readonly string[];
	notifyChannel?: string;
	model?: string;
	verbose?: boolean;
	config?: KotaConfig;
	autonomyMode: AutonomyMode;
	moduleLoader?: ModuleLoader;
	getDefaultScopeRuntime: () => ScopeRuntime;
	getApprovals: (scopeId: string) => ApprovalsClient;
	onConnectionHealthy?: () => void;
	inboundSignals?: SlackInboundSignalRuntime;
};
