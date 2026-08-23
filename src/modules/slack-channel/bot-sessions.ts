import type { ChannelSession, ChannelUserIdentity } from "#core/channels/channel.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { AgentSession, type LoopOptions } from "#core/loop/loop.js";
import { ProxyTransport } from "#core/loop/transport.js";
import type { SlackBotOptions } from "./bot-options.js";

export function createSlackChannelSession(
  options: SlackBotOptions,
  userId: string,
  runtime: ProjectRuntime,
): ChannelSession {
  const proxy = new ProxyTransport();
  const identity: ChannelUserIdentity = {
    channelUserId: userId,
    channel: "slack-channel",
    meta: {
      scopeId: runtime.project.projectId,
      projectId: runtime.project.projectId,
    },
  };
  const loopOptions: LoopOptions = {
    autonomyMode: options.autonomyMode,
    model: options.model ?? options.config?.model,
    verbose: options.verbose ?? options.config?.verbose,
    transport: proxy,
    config: options.config,
    channelIdentity: identity,
    projectDir: runtime.project.projectDir,
    projectRuntime: runtime,
    moduleLoader: options.moduleLoader,
  };
  return {
    agent: new AgentSession(loopOptions),
    proxy,
    lastActive: Date.now(),
    identity,
  };
}
