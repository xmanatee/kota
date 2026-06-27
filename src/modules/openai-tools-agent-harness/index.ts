import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  openaiToolsAgentHarness,
} from "./adapter.js";
import { OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME } from "./constants.js";
import { openaiToolsScaffoldAgentHarness } from "./scaffold-harness.js";

registerAgentHarness(openaiToolsAgentHarness);
registerAgentHarness(openaiToolsScaffoldAgentHarness);

const openaiToolsAgentHarnessModule: KotaModule = {
  name: "openai-tools-agent-harness",
  description:
    "Registers OpenAI-compatible tool-loop harnesses: openai-tools for the raw KOTA tool catalog and openai-tools-scaffold for weaker/local models using compound guarded operations.",
  dependencies: ["model-clients"],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${OPENAI_TOOLS_AGENT_HARNESS_NAME}" (OpenAI-compatible tool loop).`,
    );
    ctx.log.info(
      `Registered agent harness "${OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME}" (scaffolded weak/local model loop).`,
    );
  },
};

export {
  OPENAI_TOOLS_AGENT_HARNESS_NAME,
  openaiToolsAgentHarness,
} from "./adapter.js";
export { OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME } from "./constants.js";
export { openaiToolsScaffoldAgentHarness } from "./scaffold-harness.js";

export default openaiToolsAgentHarnessModule;
