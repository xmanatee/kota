/**
 * Slack channel module — bidirectional Slack bot for KOTA using Socket Mode.
 *
 * Contributes a channel that routes Slack DMs to per-user sessions and handles
 * approval interactions.
 *
 * Separate from the existing `slack` notification module (one-way webhook).
 */

import type { ChannelDef } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { AUTONOMY_MODES, type AutonomyMode } from "#core/tools/autonomy-mode.js";
import { SlackBot } from "./bot.js";

type SlackChannelConfig = {
  /** Bot Token — starts with xoxb- */
  botToken: string;
  /** App-Level Token — starts with xapp- (enables Socket Mode) */
  appToken: string;
  /** Slack channel ID to post approval notifications to (optional). */
  notifyChannel?: string;
  /** Autonomy mode applied to Slack DM sessions. */
  defaultAutonomyMode?: AutonomyMode;
};

function getConfig(ctx: ModuleContext): SlackChannelConfig | null {
  const config = ctx.getModuleConfig<SlackChannelConfig>();
  if (!config?.botToken || !config?.appToken) return null;
  return config;
}

let bot: SlackBot | null = null;
let approvalUnsub: (() => void) | null = null;

const slackChannelDef: ChannelDef = {
  name: "slack-channel",
  description: "Bidirectional Slack bot channel using Socket Mode",
  create(ctx) {
    // Channel adapter defers to the loaded bot instance.
    // onLoad sets up the bot; the daemon calls start/stop on the adapter.
    return {
      async start() {
        if (!bot) {
          ctx.log("[kota-slack] No config — channel disabled");
          return;
        }
        await bot.start();
      },
      stop() {
        bot?.stop();
      },
    };
  },
};

const slackChannelModule: KotaModule = {
  name: "slack-channel",
  version: "1.0.0",
  description: "Bidirectional Slack bot channel for KOTA (Socket Mode)",
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["botToken", "appToken"],
    properties: {
      botToken: { type: "string", minLength: 1 },
      appToken: { type: "string", minLength: 1 },
      notifyChannel: { type: "string", minLength: 1 },
      defaultAutonomyMode: { type: "string", enum: AUTONOMY_MODES },
    },
  },

  channels: [slackChannelDef],

  onLoad: (ctx) => {
    const config = getConfig(ctx);
    if (!config) {
      ctx.log.warn(
        "slack-channel module: botToken and appToken are required — module inactive",
      );
      return;
    }

    const autonomyMode = resolveChannelAutonomyMode(
      config.defaultAutonomyMode,
      ctx.config,
      "slack-channel",
    );

    bot = new SlackBot({
      botToken: config.botToken,
      appToken: config.appToken,
      notifyChannel: config.notifyChannel,
      config: ctx.config,
      autonomyMode,
    });

    approvalUnsub = ctx.events.subscribe("approval.requested", (payload) => {
      if (!bot) return;
      const id = payload.id as string;
      const tool = payload.tool as string;
      const risk = payload.risk as string;
      const reason = payload.reason as string;
      bot.postApproval(id, tool, risk, reason).catch((err: unknown) => {
        ctx.log.warn(`slack-channel: failed to post approval: ${(err as Error).message}`);
      });
    });
  },

  onUnload: () => {
    approvalUnsub?.();
    approvalUnsub = null;
    bot?.stop();
    bot = null;
  },
};

export default slackChannelModule;
