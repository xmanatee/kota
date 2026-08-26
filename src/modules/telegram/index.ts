import type { KotaModule } from "#core/modules/module-types.js";
import { type OutboundHttpRequestPort, outboundHttp } from "#core/outbound-http/index.js";
import { AUTONOMY_MODES } from "#core/tools/autonomy-mode.js";
import { operatorSurfaceEffect } from "#core/tools/effect.js";
import { makeTelegramInteractiveChannel, makeTelegramStatusChannel } from "./channels.js";
import { loadTelegramModule, unloadTelegramModule } from "./notification-subscriptions.js";
import { type TelegramConfig, telegramSetupRequirements } from "./readiness.js";

export { TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID } from "./readiness.js";

export function createTelegramModule(
  http: OutboundHttpRequestPort = outboundHttp,
): KotaModule {
  return {
  name: "telegram",
  version: "1.0.0",
  description: "Telegram bot frontend for KOTA",
  dependencies: ["answer", "approval-queue", "autonomy", "capture", "daemon-ops", "history", "inbound-signals", "knowledge", "memory", "model-clients", "recall", "repo-tasks", "retract", "secrets", "transcription"],
  setupRequirements: telegramSetupRequirements,
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "telegram.status",
        description:
          "Serve operator status, recall, answer, capture, retract, digest, and attention commands in Telegram.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "setup"],
        setupRequirementIds: ["bot-credentials"],
      },
      {
        id: "telegram.interactive",
        description: "Route Telegram chats into KOTA sessions with explicit autonomy mode.",
        scope: "external",
        scopePolicyHooks: ["channels", "external-effects", "setup"],
        setupRequirementIds: ["bot-credentials", "interactive-model-backend"],
      },
      {
        id: "telegram.owner-escalation",
        description:
          "Deliver owner questions, approvals, failure alerts, and digest notifications to Telegram.",
        scope: "external",
        scopePolicyHooks: ["owner-confirmation", "external-effects", "setup"],
        setupRequirementIds: ["bot-credentials"],
      },
    ],
    dataClasses: [
      {
        id: "telegram.bot-credentials",
        description: "Telegram bot token and alert chat id secret references.",
        sensitivity: "credential",
        retention: "scope-durable",
        redaction: "mask-secret",
      },
      {
        id: "telegram.message-content",
        description: "Telegram command text, chat replies, inbound signal text, and rendered responses.",
        sensitivity: "personal",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "telegram.owner-escalation-content",
        description: "Owner question, approval, failure alert, and digest message metadata.",
        sensitivity: "internal",
        retention: "operator-visible",
        redaction: "metadata-only",
      },
    ],
    additionalEffects: [
      {
        id: "telegram.message-delivery",
        description: "Deliver operator commands, approvals, owner questions, and notifications to Telegram.",
        source: "channel",
        effect: operatorSurfaceEffect(),
        capabilityIds: [
          "telegram.status",
          "telegram.interactive",
          "telegram.owner-escalation",
        ],
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Telegram delivery is operator-visible external I/O and is blocked in workflow trial mode.",
      ],
    },
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        items: { type: "string", minLength: 1 },
        uniqueItems: true,
      },
      defaultAutonomyMode: { type: "string", enum: AUTONOMY_MODES },
      allowedChatIds: {
        type: "array",
        items: { type: "integer" },
        uniqueItems: true,
      },
      chatScopeBindings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["chatId", "scopeId"],
          properties: {
            chatId: { type: "integer" },
            scopeId: { type: "string", minLength: 1 },
          },
        },
      },
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
          trustedChatIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "integer" },
          },
          blockedChatIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "integer" },
          },
        },
      },
    },
  },

  channels: (ctx) => {
    const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
    const chatScopeBindings = telegramConfig?.chatScopeBindings ?? [];
    return [
      makeTelegramStatusChannel(ctx),
      makeTelegramInteractiveChannel(ctx, chatScopeBindings, http),
    ];
  },

  onLoad: async (ctx) => {
    await loadTelegramModule(ctx);
    return { dispose: unloadTelegramModule };
  },
  // Direct module consumers are migrated to loader-owned activation in Stage 10.
  onUnload: unloadTelegramModule,
  };
}

export default createTelegramModule();
