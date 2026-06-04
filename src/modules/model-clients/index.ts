import { registerModelClientFactory } from "#core/model/model-client.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { MODEL_PRICING_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { ModuleSetupRequirement } from "#core/modules/setup-requirements.js";
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
    id: "anthropic-api-key",
    kind: "secret",
    title: "Anthropic API key",
    description:
      "Default Anthropic provider credential resolved through the shared secret provider.",
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
