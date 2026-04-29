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
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
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

function makeSlackChannelDef(moduleCtx: ModuleContext): ChannelDef {
  return {
    name: "slack-channel",
    description: "Bidirectional Slack bot channel using Socket Mode",
    create(ctx) {
      const config = getConfig(moduleCtx);
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
        attention: {
          snapshot: () =>
            renderOnDemandAttention({
              projectDir,
              runsDir: ctx.getWorkflowStatus().runsDir,
            }),
        },
        digest: { snapshot: () => renderOnDemandDigest({ projectDir }) },
      });

      const approvalUnsub = moduleCtx.events.subscribe(
        "approval.requested",
        (payload) => {
          const id = payload.id as string;
          const tool = payload.tool as string;
          const risk = payload.risk as string;
          const reason = payload.reason as string;
          bot.postApproval(id, tool, risk, reason).catch((err: unknown) => {
            moduleCtx.log.warn(
              `slack-channel: failed to post approval: ${(err as Error).message}`,
            );
          });
        },
      );

      return {
        status: "started",
        adapter: {
          async start() {
            await bot.start();
          },
          stop() {
            approvalUnsub();
            bot.stop();
          },
        },
      };
    },
  };
}

const slackChannelModule: KotaModule = {
  name: "slack-channel",
  version: "1.0.0",
  description: "Bidirectional Slack bot channel for KOTA (Socket Mode)",
  dependencies: [
    "answer",
    "autonomy",
    "capture",
    "history",
    "knowledge",
    "memory",
    "recall",
    "repo-tasks",
    "retract",
  ],
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

  channels: (ctx) => [makeSlackChannelDef(ctx)],

  onLoad: (ctx) => {
    const config = getConfig(ctx);
    if (!config) {
      ctx.log.warn(
        "slack-channel module: botToken and appToken are required — module inactive",
      );
      return;
    }
    // Resolve autonomy mode early so config errors surface at load time, not
    // at first connection. The channel adapter re-resolves at create time.
    resolveChannelAutonomyMode(
      config.defaultAutonomyMode,
      ctx.config,
      "slack-channel",
    );
  },
};

export default slackChannelModule;
