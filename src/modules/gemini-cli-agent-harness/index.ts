import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  GEMINI_CLI_AGENT_HARNESS_NAME,
  geminiCliAgentHarness,
} from "./adapter.js";

registerAgentHarness(geminiCliAgentHarness);

const geminiCliAgentHarnessModule: KotaModule = {
  name: "gemini-cli-agent-harness",
  description:
    "Registers the gemini-cli agent harness — a non-interactive Gemini CLI runner that honors local Google login / Code Assist auth.",
  dependencies: [],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${GEMINI_CLI_AGENT_HARNESS_NAME}" (Gemini CLI headless).`,
    );
  },
};

export {
  GEMINI_CLI_AGENT_HARNESS_NAME,
  geminiCliAgentHarness,
} from "./adapter.js";

export default geminiCliAgentHarnessModule;
