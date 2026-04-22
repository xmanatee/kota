import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  openaiToolsAgentHarness,
} from "./adapter.js";

registerAgentHarness(openaiToolsAgentHarness);

const openaiToolsAgentHarnessModule: KotaModule = {
  name: "openai-tools-agent-harness",
  description:
    "Registers the openai-tools agent harness — a multi-turn tool-calling loop driven by any OpenAI-compatible ModelClient. Routes tool dispatch through the core tool registry and honors canUseTool, allowedTools, and disallowedTools.",
  dependencies: ["model-clients"],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${OPENAI_TOOLS_AGENT_HARNESS_NAME}" (OpenAI-compatible tool loop).`,
    );
  },
};

export {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  openaiToolsAgentHarness,
} from "./adapter.js";

export default openaiToolsAgentHarnessModule;
