/**
 * Model clients module — owns all ModelClient implementations.
 *
 * Registers the provider factory with the core model client registry at
 * module load time so it is available before the agent loop starts.
 */

import { registerModelClientFactory } from "../../model/model-client.js";
import type { KotaModule } from "../../core/modules/module-types.js";
import { createModelClientImpl } from "./factory.js";

// Self-register at module load so the registry is ready before initAgentSession.
registerModelClientFactory(createModelClientImpl);

const modelClientsModule: KotaModule = {
	name: "model-clients",
	description: "ModelClient implementations: Anthropic SDK and OpenAI-compatible providers.",
};

export default modelClientsModule;
