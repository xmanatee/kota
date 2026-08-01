import { resolveAgentHarness } from "#core/agent-harness/index.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { CapabilityReadiness, CapabilityReadinessSource } from "#core/daemon/capability-readiness.js";
import { checkPresetAuth } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { autonomyHealthSignal, normalizeHealthSignal } from "#modules/autonomy/health-signal.js";
import { apiKeyNameForProvider, resolveApiKey, resolveModelProviderName } from "#modules/model-clients/factory.js";
import { isModelClientHarness, resolveTelegramInteractiveBackend } from "./backend.js";
import type { TelegramInboundSignalConfig } from "./inbound-signal.js";
import type { TelegramChatProjectBinding } from "./project-selection.js";

export type TelegramConfig = {
  /** Subset of opt-in notification events to forward. Default: none. */
  events?: string[];
  /** Autonomy mode applied to Telegram chat sessions. */
  defaultAutonomyMode?: AutonomyMode;
  /** Whitelist of chat IDs allowed to open interactive sessions. Empty/undefined = allow all. */
  allowedChatIds?: number[];
  /** Default Telegram chat -> project bindings used when the daemon hosts multiple projects. */
  chatProjectBindings?: TelegramChatProjectBinding[];
  /** Prefix-configured text updates that emit inbound.signal.received. */
  inboundSignals?: TelegramInboundSignalConfig;
};

export const TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID =
  "telegram.interactive.backend";

export const telegramSetupRequirements: ModuleSetupRequirement[] = [
  {
    id: "bot-credentials",
    kind: "secret",
    title: "Telegram bot credentials",
    description:
      "Bot token and default alert chat reference used by Telegram channels.",
    required: true,
    scope: "project",
    owner: "telegram",
    sensitivity: "secret",
    setup: {
      mode: "url",
      url: "https://t.me/BotFather",
      label: "Open BotFather",
      pendingTtlMs: 30 * 60 * 1000,
    },
    secretRefs: [
      { name: "TELEGRAM_BOT_TOKEN", scope: "project" },
      { name: "TELEGRAM_ALERT_CHAT_ID", scope: "project" },
    ],
  },
  {
    id: "interactive-model-backend",
    kind: "capability",
    title: "Telegram interactive model backend",
    description:
      "Model or harness backend used by Telegram chat sessions after bot credentials are present.",
    required: true,
    scope: "project",
    owner: "telegram",
    sensitivity: "none",
    setup: { mode: "none" },
    capabilityIds: [TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID],
  },
];

export const reportedTelegramPollConflicts = new Set<string>();

export function getCredentials(ctx: ModuleContext): { token: string; chatId: string } | null {
  const token = ctx.getSecret("TELEGRAM_BOT_TOKEN");
  const chatId = ctx.getSecret("TELEGRAM_ALERT_CHAT_ID");
  if (!token || !chatId) return null;
  return { token, chatId };
}

export function telegramInteractiveProviderError(
  ctx: ModuleContext,
  model: string,
  explicitProvider?: {
    provider?: string;
    apiKey?: string;
  },
): string | null {
  const provider = resolveModelProviderName(model, explicitProvider?.provider);
  if (!provider) {
    return `Telegram interactive sessions require a model provider for "${model}". Set config.modelProvider.type, use provider/model notation, or select a multi-turn harness preset that does not require ModelClient.`;
  }
  const apiKeyEnv = apiKeyNameForProvider(provider);
  if (apiKeyEnv && !resolveApiKey(provider, explicitProvider?.apiKey, { projectDir: ctx.cwd })) {
    return `Telegram interactive sessions require ${apiKeyEnv} or config.modelProvider.apiKey for provider "${provider}".`;
  }
  return null;
}

export function telegramInteractiveBackendReadiness(
  ctx: ModuleContext,
): CapabilityReadiness {
  const telegramConfig = ctx.getModuleConfig<TelegramConfig>();
  let autonomyMode: AutonomyMode;
  try {
    autonomyMode = resolveChannelAutonomyMode(
      telegramConfig?.defaultAutonomyMode,
      ctx.config,
      "telegram",
    );
  } catch (err) {
    return {
      id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
      moduleName: "telegram",
      status: "unavailable",
      reason: "autonomy_mode_missing",
      message: (err as Error).message,
    };
  }

  const backendError = telegramInteractiveBackendError(ctx, autonomyMode);
  if (backendError) {
    return {
      id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
      moduleName: "telegram",
      status: "unavailable",
      reason: "interactive_backend_unavailable",
      message: backendError,
    };
  }

  const backend = resolveTelegramInteractiveBackend(ctx.config);
  if (backend.kind === "harness") {
    return {
      id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
      moduleName: "telegram",
      status: "ready",
      reason: "harness_ready",
      message: `Telegram interactive chat is ready through the "${backend.harnessName}" harness.`,
      meta: {
        backend: "harness",
        harness: backend.harnessName,
        model: backend.model,
      },
    };
  }

  return {
    id: TELEGRAM_INTERACTIVE_BACKEND_CAPABILITY_ID,
    moduleName: "telegram",
    status: "ready",
    reason: "model_client_ready",
    message: "Telegram interactive chat is ready through the configured ModelClient provider.",
    meta: {
      backend: "model-client",
      model: backend.modelSpec,
    },
  };
}

export function createTelegramReadinessSource(ctx: ModuleContext): CapabilityReadinessSource {
  return {
    moduleName: "telegram",
    probe: () => [telegramInteractiveBackendReadiness(ctx)],
  };
}

export function emitTelegramPollConflictHealthSignal(
  ctx: ModuleContext,
  projectId: string,
): void {
  const dedupeKey = "module:telegram:getupdates-conflict";
  const reportKey = `${projectId}:${dedupeKey}`;
  if (reportedTelegramPollConflicts.has(reportKey)) return;
  reportedTelegramPollConflicts.add(reportKey);

  const signal = normalizeHealthSignal({
    source: { kind: "module", id: "telegram-interactive", module: "telegram" },
    severity: "warning",
    labels: ["external-service", "polling", "telegram"],
    summary:
      "Telegram Bot API reported a getUpdates conflict for telegram-interactive. Another process or poller is using the same bot token; stop the duplicate consumer before enabling Telegram chat.",
    evidenceRefs: [
      {
        kind: "module-log",
        ref: "telegram-interactive:getUpdates",
        summary:
          "Bot API getUpdates returned a conflict while the interactive Telegram channel was running.",
      },
    ],
    actionability: "external-service",
    dedupeKey,
    observationCount: 1,
    createdAt: new Date().toISOString(),
  });

  try {
    ctx.events.emit(autonomyHealthSignal, {
      scopeId: projectId,
      projectId,
      ...signal,
    });
  } catch (err) {
    ctx.log.warn(
      `Telegram getUpdates conflict health signal failed: ${(err as Error).message}`,
    );
  }
}

export function telegramInteractiveBackendError(
  ctx: ModuleContext,
  autonomyMode: AutonomyMode,
): string | null {
  const backend = resolveTelegramInteractiveBackend(ctx.config);
  if (backend.kind === "model-client") {
    return telegramInteractiveProviderError(
      ctx,
      backend.modelSpec,
      backend.modelProvider,
    );
  }

  let harness: ReturnType<typeof resolveAgentHarness>;
  try {
    harness = resolveAgentHarness(backend.harnessName);
  } catch (err) {
    return (err as Error).message;
  }

  if (!harness.supportsMultiTurn) {
    return `Telegram interactive sessions require a multi-turn agent harness; "${harness.name}" does not support multi-turn conversation.`;
  }

  if (autonomyMode === "supervised") {
    const unsupported = harness.unsupportedRunOptions?.find(
      (entry) => entry.runOption === "autonomyMode.supervised",
    );
    if (unsupported) {
      return `Telegram interactive sessions cannot use autonomyMode "supervised" with harness "${harness.name}": ${unsupported.reason}`;
    }
  }

  if (backend.usesPresetHarness) {
    const auth = checkPresetAuth(backend.preset);
    if (auth.missing.length > 0) {
      return `Telegram interactive sessions require ${auth.missing.join(" or ")} for preset "${backend.preset.id}".`;
    }
  }

  if (isModelClientHarness(backend.harnessName)) {
    return telegramInteractiveProviderError(
      ctx,
      backend.model,
      backend.modelProvider,
    );
  }

  return null;
}
