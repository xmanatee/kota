import type { KotaConfig } from "#core/config/config.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { AnswerClient } from "#modules/answer/client.js";
import type { ApprovalsClient } from "#modules/approval-queue/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import type {
	AttentionSnapshotClient,
	DigestSnapshotClient,
} from "./commands.js";
import type { SlackChannelInboundSignalConfig } from "./inbound-signal.js";

export type SlackInboundSignalRuntime = {
	getProjectId: () => string;
	config: SlackChannelInboundSignalConfig;
	events: Pick<ModuleContext["events"], "emit">;
};

export type SlackBotOptions = {
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
	getDefaultProjectRuntime: () => ProjectRuntime;
	recall: RecallClient;
	answer: AnswerClient;
	capture: CaptureClient;
	retract: RetractClient;
	memory: MemoryClient;
	knowledge: KnowledgeClient;
	history: HistoryClient;
	tasks: RepoTasksClient;
	attention: AttentionSnapshotClient;
	digest: DigestSnapshotClient;
	approvals: ApprovalsClient;
	inboundSignals?: SlackInboundSignalRuntime;
};
