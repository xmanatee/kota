import type { ChannelUserIdentity } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import type { ProxyTransport } from "#core/loop/transport.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { OutboundHttpRequestPort } from "#core/outbound-http/index.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { TelegramCallbackQuery } from "./client.js";
import type { TelegramInboundSignalConfig } from "./inbound-signal.js";
import type { TelegramPollingOwner } from "./polling-ownership.js";
import type { TelegramScopeSelection } from "./scope-selection.js";

export type TelegramBotOptions = {
  token: string;
  model?: string;
  verbose?: boolean;
  config?: KotaConfig;
  autonomyMode: AutonomyMode;
  moduleLoader?: ModuleLoader;
  /** Current daemon default runtime for single-scope Telegram sessions. */
  defaultScopeRuntime: ScopeRuntime;
  /** Resolve the daemon-owned runtime bundle for a selected scope id. */
  getScopeRuntime: (scopeId: string) => ScopeRuntime;
  /** Whitelist of allowed chat IDs. Empty/undefined = allow all. */
  allowedChatIds?: number[];
  scopeSelection?: TelegramScopeSelection;
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
  http?: OutboundHttpRequestPort;
};

export type TelegramScopeTarget = {
  chatId: number;
  scopeId: string;
  scopeRoot: string;
  scopeRuntime: ScopeRuntime;
  sessionKey: string;
};

export type TelegramScopeTargetResolution =
  | { ok: true; target: TelegramScopeTarget }
  | { ok: false; message: string };

export type TelegramSessionAgent = {
  send(text: string): Promise<string | void>;
  close(): void | Promise<void>;
  getCostSummary(): string;
};

export type TelegramSession = {
  agent: TelegramSessionAgent;
  proxy: ProxyTransport;
  lastActive: number;
  identity: ChannelUserIdentity;
};
