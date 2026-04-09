/**
 * Model clients extension — owns all ModelClient implementations.
 *
 * Registers the provider factory with the core model client registry at
 * module load time so it is available before the agent loop starts.
 */

import type { KotaExtension } from "../../extension-types.js";
import { registerModelClientFactory } from "../../model/model-client.js";
import { createModelClientImpl } from "./factory.js";

// Self-register at module load so the registry is ready before initAgentSession.
registerModelClientFactory(createModelClientImpl);

const modelClientsExtension: KotaExtension = {
	name: "model-clients",
	description: "ModelClient implementations: Anthropic SDK and OpenAI-compatible providers.",
};

export default modelClientsExtension;
