import type { KotaModule } from "#core/modules/module-types.js";
import { GEMINI_AGENT_HARNESS_NAME, geminiAgentHarness } from "./adapter.js";

const geminiAgentHarnessModule: KotaModule = {
  name: "gemini-agent-harness",
  description:
    "Registers the gemini agent harness — a multi-turn tool-calling loop driven by the Google Gen AI SDK (models.generateContentStream + functionDeclarations). Routes tool dispatch through the core tool registry and honors canUseTool, allowedTools, and disallowedTools.",
  dependencies: [],
  agentHarnesses: [geminiAgentHarness],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${GEMINI_AGENT_HARNESS_NAME}" (Google Gen AI SDK tool loop).`,
    );
  },
};

export {
  GEMINI_AGENT_HARNESS_NAME,
  geminiAgentHarness,
} from "./adapter.js";

export default geminiAgentHarnessModule;
