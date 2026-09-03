import type { KotaModule } from "#core/modules/module-types.js";
import {
  GEMINI_CLI_AGENT_HARNESS_NAME,
  geminiCliAgentHarness,
} from "./adapter.js";

const geminiCliAgentHarnessModule: KotaModule = {
  name: "gemini-cli-agent-harness",
  description:
    "Registers the enterprise/API-key Gemini CLI harness for headless structured runs.",
  dependencies: [],
  agentHarnesses: [geminiCliAgentHarness],
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
