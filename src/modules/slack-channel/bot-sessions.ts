import type { ChannelSession, ChannelUserIdentity } from "#core/channels/channel.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { ProxyTransport } from "#core/loop/transport.js";
import type { SlackBotOptions } from "./bot-options.js";

export function createSlackChannelSession(
  options: SlackBotOptions,
  userId: string,
  runtime: ScopeRuntime,
): ChannelSession {
  const proxy = new ProxyTransport();
  const identity: ChannelUserIdentity = {
    channelUserId: userId,
    channel: "slack-channel",
    meta: {
      scopeId: runtime.scope.scopeId,
    },
  };
  const loopOptions: LoopOptions = {
    autonomyMode: options.autonomyMode,
    model: options.model ?? options.config?.model,
    verbose: options.verbose ?? options.config?.verbose,
    transport: proxy,
    config: options.config,
    channelIdentity: identity,
    scopeRoot: runtime.scope.scopeRoot,
    scopeRuntime: runtime,
    moduleLoader: options.moduleLoader,
  };
  return {
    agent: new AgentSession(loopOptions),
    proxy,
    lastActive: Date.now(),
    identity,
  };
}
