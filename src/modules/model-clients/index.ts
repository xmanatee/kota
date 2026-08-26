import { registerModelClientFactory } from "#core/model/model-client.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { MODEL_PRICING_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
import { networkReadEffect } from "#core/tools/effect.js";
import { failoverConfigSlice, modelProviderConfigSlice } from "./config-slice.js";
import {
  createModelClientImpl,
  createModelClientWithFailover,
  getActiveFailoverClient,
} from "./factory.js";
import { createShippedModelPricingProvider } from "./pricing.js";

registerModelClientFactory(createModelClientImpl);

const modelClientSetupRequirements: ModuleSetupRequirement[] = [
  {
    id: "openrouter-api-key",
    kind: "secret",
    title: "OpenRouter API key",
    description:
      "OpenRouter provider credential resolved through the shared secret provider.",
    required: false,
    scope: "global",
    owner: "model-clients",
    sensitivity: "secret",
    setup: {
      mode: "url",
      url: "https://openrouter.ai/settings/keys",
      label: "Open OpenRouter API keys",
      pendingTtlMs: 30 * 60 * 1000,
    },
    secretRefs: [{ name: "OPENROUTER_API_KEY", scope: "global" }],
  },
  {
    id: "anthropic-api-key",
    kind: "secret",
    title: "Anthropic API key",
    description:
      "Anthropic provider credential resolved through the shared secret provider.",
    required: false,
    scope: "global",
    owner: "model-clients",
    sensitivity: "secret",
    setup: {
      mode: "url",
      url: "https://console.anthropic.com/settings/keys",
      label: "Open Anthropic API keys",
      pendingTtlMs: 30 * 60 * 1000,
    },
    secretRefs: [{ name: "ANTHROPIC_API_KEY", scope: "global" }],
  },
  {
    id: "openai-api-key",
    kind: "secret",
    title: "OpenAI API key",
    description:
      "OpenAI-compatible provider credential resolved through the shared secret provider.",
    required: false,
    scope: "global",
    owner: "model-clients",
    sensitivity: "secret",
    setup: {
      mode: "url",
      url: "https://platform.openai.com/api-keys",
      label: "Open OpenAI API keys",
      pendingTtlMs: 30 * 60 * 1000,
    },
    secretRefs: [{ name: "OPENAI_API_KEY", scope: "global" }],
  },
];

const modelClientsModule: KotaModule = {
  name: "model-clients",
  description: "ModelClient implementations: Anthropic SDK and OpenAI-compatible providers, with optional failover.",
  configSlices: [modelProviderConfigSlice, failoverConfigSlice],
  setupRequirements: modelClientSetupRequirements,
  manifest: {
    schemaVersion: 1,
    capabilities: [
      {
        id: "model-clients.inference",
        description:
          "Register Anthropic and OpenAI-compatible model clients plus failover routing.",
        scope: "external",
        scopePolicyHooks: ["external-effects", "setup", "retention"],
        setupRequirementIds: [
          "openrouter-api-key",
          "anthropic-api-key",
          "openai-api-key",
        ],
      },
      {
        id: "model-clients.pricing",
        description: "Provide shipped model pricing metadata for cost tracking.",
        scope: "daemon",
        scopePolicyHooks: ["retention"],
      },
    ],
    dataClasses: [
      {
        id: "model-clients.provider-credentials",
        description: "Model provider API key references resolved through the shared secret provider.",
        sensitivity: "credential",
        retention: "scope-durable",
        redaction: "mask-secret",
      },
      {
        id: "model-clients.prompt-content",
        description: "Prompt, tool schema, and model-response payloads sent through provider APIs.",
        sensitivity: "provider-payload",
        retention: "run-artifact",
        redaction: "metadata-only",
      },
      {
        id: "model-clients.pricing-metadata",
        description: "Per-model pricing rows used by CostTracker.",
        sensitivity: "public",
        retention: "scope-durable",
        redaction: "none",
      },
    ],
    additionalEffects: [
      {
        id: "model-clients.provider-request",
        description: "Send inference requests to the configured model provider.",
        source: "lifecycle",
        effect: networkReadEffect(),
        capabilityIds: ["model-clients.inference"],
      },
    ],
    simulation: {
      support: "external-effects-blocked",
      blockedReasons: [
        "Model-provider calls transmit prompt content to an external service and are blocked or mocked in trial fixtures.",
      ],
    },
  },

  onLoad(ctx: ModuleRuntimeContext) {
    ctx.registerProvider(MODEL_PRICING_PROVIDER_TOKEN, createShippedModelPricingProvider());

    const failoverConfig = ctx.config.failover;
    if (failoverConfig) {
      registerModelClientFactory((opts) =>
        createModelClientWithFailover(opts, failoverConfig),
      );
      ctx.log.info(`Failover configured: primary → ${failoverConfig.provider}`);
    }
  },

  healthCheck() {
    const client = getActiveFailoverClient();
    if (!client) {
      return { status: "healthy", message: "No failover configured" };
    }
    const state = client.getHealthState();
    if (state.status === "healthy") {
      return { status: "healthy", message: `Primary healthy (${state.totalCount} requests in window)` };
    }
    return {
      status: "degraded",
      message: `Primary unhealthy since ${state.failedOverSince}, using fallback (${state.errorCount} errors in window)`,
    };
  },
};

export default modelClientsModule;
