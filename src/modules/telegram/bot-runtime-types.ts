import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import type { ProxyTransport } from "#core/loop/transport.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { TelegramCallbackQuery } from "./client.js";
import type { TelegramInboundSignalConfig } from "./inbound-signal.js";
import type { TelegramPollingOwner } from "./polling-ownership.js";
import type { TelegramProjectSelection } from "./project-selection.js";

export type TelegramBotOptions = {
  token: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  autonomyMode: AutonomyMode;
  moduleLoader?: ModuleLoader;
  /** Current daemon default runtime for single-project Telegram sessions. */
  defaultProjectRuntime: ProjectRuntime;
  /** Resolve the daemon-owned runtime bundle for a selected project id. */
  getProjectRuntime: (projectId: string) => ProjectRuntime;
  /** Whitelist of allowed chat IDs. Empty/undefined = allow all. */
  allowedChatIds?: number[];
  projectSelection?: TelegramProjectSelection;
  onChatReply?: (
    chatId: number,
    replyToMessageId: number,
    text: string,
  ) => Promise<boolean>;
  onCallbackQuery?: (callback: TelegramCallbackQuery) => Promise<boolean>;
  onStatusCommand?: (chatId: number, text: string) => Promise<boolean>;
  /** Optional prefix-configured chat automation signal bridge. */
  inboundSignals?: {
    config: TelegramInboundSignalConfig;
    events: Pick<ModuleContext["events"], "emit">;
  };
  pollOwner?: TelegramPollingOwner;
};

export type TelegramProjectTarget = {
  chatId: number;
  projectId: string;
  projectDir: string;
  projectRuntime: ProjectRuntime;
  sessionKey: string;
};

export type TelegramProjectTargetResolution =
  | { ok: true; target: TelegramProjectTarget }
  | { ok: false; message: string };

export type TelegramSessionAgent = {
  send(text: string): Promise<string | void>;
  close(): void;
  getCostSummary(): string;
};

export type TelegramSession = {
  agent: TelegramSessionAgent;
  proxy: ProxyTransport;
  lastActive: number;
  identity: ChannelUserIdentity;
};
