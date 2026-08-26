/**
 * Slack channel module — bidirectional Slack bot for KOTA using Socket Mode.
 *
 * Contributes a channel that routes Slack DMs to per-user sessions and handles
 * approval interactions.
 *
 * Separate from the existing `slack` notification module (one-way webhook).
 */

import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { AUTONOMY_MODES } from "#core/tools/autonomy-mode.js";
import { operatorSurfaceEffect } from "#core/tools/effect.js";
import { makeSlackChannelDef } from "./channel.js";
import { getSlackChannelConfig } from "./config.js";

const slackChannelModule: KotaModule = {
  name: "slack-channel",
  version: "1.0.0",
  description: "Bidirectional Slack bot channel for KOTA (Socket Mode)",
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "slack-channel.dm",
        description:
          "Route Slack direct messages into KOTA sessions and render one-shot command replies.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "setup"],
        setupRequirementIds: ["socket-mode-config", "socket-mode-credentials"],
      },
      {
        id: "slack-channel.approvals",
        description:
          "Post approval prompts and operator notifications into Slack surfaces.",
        scope: "external",
        scopePolicyHooks: ["owner-confirmation", "external-effects", "setup"],
        setupRequirementIds: ["socket-mode-config", "socket-mode-credentials"],
      },
    ],
    dataClasses: [
      {
        id: "slack-channel.tokens",
        description: "Slack bot and app token references used for Socket Mode.",
        sensitivity: "credential",
        retention: "scope-durable",
        redaction: "mask-secret",
      },
      {
        id: "slack-channel.message-content",
        description: "Slack direct-message text, command text, and rendered reply content.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "slack-channel.approval-content",
        description: "Approval request ids, tool names, risk reasons, and button outcomes.",
        sensitivity: "internal",
        retention: "operator-visible",
        redaction: "metadata-only",
      },
    ],
    additionalEffects: [
      {
        id: "slack-channel.message-delivery",
        description: "Deliver command replies, approval prompts, and notifications to Slack.",
        source: "channel",
        effect: operatorSurfaceEffect(),
        capabilityIds: ["slack-channel.dm", "slack-channel.approvals"],
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Slack Socket Mode delivery is operator-visible external I/O and is blocked in workflow trial mode.",
      ],
    },
  },
  setupRequirements: [
    {
      id: "socket-mode-config",
      kind: "config",
      title: "Slack Socket Mode and admission config",
      description:
        "Scope config for stored token references, the expected workspace, the interactive user allowlist, and notification delivery.",
      required: true,
      scope: "scope",
      owner: "slack-channel",
      sensitivity: "none",
      setup: {
        mode: "form",
        fields: [
          {
            id: "bot-token-ref",
            label: "Bot token reference",
            type: "string",
            valueKind: "secret-reference",
            configPath: "modules.slack-channel.botToken",
            required: true,
            placeholder: "$SLACK_BOT_TOKEN",
          },
          {
            id: "app-token-ref",
            label: "App token reference",
            type: "string",
            valueKind: "secret-reference",
            configPath: "modules.slack-channel.appToken",
            required: true,
            placeholder: "$SLACK_APP_TOKEN",
          },
          {
            id: "workspace-id",
            label: "Slack workspace ID",
            type: "string",
            configPath: "modules.slack-channel.workspaceId",
            required: true,
            placeholder: "T0123456789",
            helperText:
              "Interactive input remains disabled until allowedUserIds is also set in the scope module config.",
          },
          {
            id: "notify-channel",
            label: "Notify channel",
            type: "string",
            configPath: "modules.slack-channel.notifyChannel",
            required: false,
            placeholder: "C0123456789",
          },
        ],
      },
    },
    {
      id: "socket-mode-credentials",
      kind: "secret",
      title: "Slack Socket Mode credentials",
      description:
        "Slack bot and app token values stored through the shared secret provider.",
      required: true,
      scope: "scope",
      owner: "slack-channel",
      sensitivity: "secret",
      setup: {
        mode: "url",
        url: "https://api.slack.com/apps",
        label: "Open Slack app settings",
        pendingTtlMs: 30 * 60 * 1000,
      },
      secretRefs: [
        { name: "SLACK_BOT_TOKEN", scope: "scope" },
        { name: "SLACK_APP_TOKEN", scope: "scope" },
      ],
    },
  ] satisfies ModuleSetupRequirement[],
  dependencies: [
    "answer",
    "approval-queue",
    "autonomy",
    "capture",
    "history",
    "knowledge",
    "memory",
    "recall",
    "repo-tasks",
    "retract",
    "inbound-signals",
  ],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["botToken", "appToken"],
    properties: {
      botToken: { type: "string", minLength: 1 },
      appToken: { type: "string", minLength: 1 },
      workspaceId: { type: "string", minLength: 1 },
      allowedUserIds: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
      notifyChannel: { type: "string", minLength: 1 },
      defaultAutonomyMode: { type: "string", enum: AUTONOMY_MODES },
      inboundSignals: {
        type: "object",
        additionalProperties: false,
        required: ["prefixes"],
        properties: {
          prefixes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          trustedUserIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          blockedUserIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },

  channels: (ctx) => [makeSlackChannelDef(ctx)],

  onLoad: (ctx) => {
    const config = getSlackChannelConfig(ctx);
    if (!config) {
      ctx.log.warn(
        "slack-channel module: botToken and appToken are required — module inactive",
      );
      return;
    }
    if (!config.workspaceId || !config.allowedUserIds?.length) {
      ctx.log.warn(
        "slack-channel module: interactive input is disabled until workspaceId and allowedUserIds are configured",
      );
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
