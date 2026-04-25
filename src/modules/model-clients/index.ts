import { registerModelClientFactory } from "#core/model/model-client.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { createAnthropicModelPricingProvider } from "./anthropic-pricing.js";
import {
  createModelClientImpl,
  createModelClientWithFailover,
  getActiveFailoverClient,
} from "./factory.js";

registerModelClientFactory(createModelClientImpl);

const modelClientsModule: KotaModule = {
  name: "model-clients",
  description: "ModelClient implementations: Anthropic SDK and OpenAI-compatible providers, with optional failover.",

  onLoad(ctx: ModuleContext) {
    ctx.registerProvider("model-pricing", createAnthropicModelPricingProvider());

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
