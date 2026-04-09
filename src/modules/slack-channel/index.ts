/**
 * Slack channel module — bidirectional Slack bot for KOTA using Socket Mode.
 *
 * Contributes a `slack-channel` ChannelDef that:
 * - Accepts DM messages from operators and routes them to per-user AgentSessions.
 * - Posts interactive Block Kit Approve/Reject messages when approval.requested fires.
 * - Handles button clicks to resolve pending approvals without leaving Slack.
 *
 * Separate from the existing `slack` notification module (one-way webhook).
 *
 * Config (kota.config under the "slackChannel" key):
 *   {
 *     botToken: string,      // xoxb- Bot Token
 *     appToken: string,      // xapp- App-Level Token (Socket Mode)
 *     notifyChannel?: string // Channel ID for approval notifications (optional)
 *   }
 */

import type { ChannelDef } from "../../channel.js";
import type { ModuleContext, KotaModule } from "../../module-types.js";
import { SlackBot } from "./bot.js";

type SlackChannelConfig = {
  /** Bot Token — starts with xoxb- */
  botToken: string;
  /** App-Level Token — starts with xapp- (enables Socket Mode) */
  appToken: string;
  /** Slack channel ID to post approval notifications to (optional). */
  notifyChannel?: string;
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

  channels: [slackChannelDef],

  onLoad: (ctx) => {
    const config = getConfig(ctx);
    if (!config) {
      ctx.log.warn(
        "slack-channel module: botToken and appToken are required — module inactive",
      );
      return;
    }

    bot = new SlackBot({
      botToken: config.botToken,
      appToken: config.appToken,
      notifyChannel: config.notifyChannel,
      config: ctx.config,
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
