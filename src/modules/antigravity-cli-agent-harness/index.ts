import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
} from "./adapter.js";

registerAgentHarness(antigravityCliAgentHarness);

const antigravityCliAgentHarnessModule: KotaModule = {
  name: "antigravity-cli-agent-harness",
  description:
    "Registers the antigravity-cli agent harness — a readiness-first AGY CLI adapter for Google's current native terminal-agent runtime.",
  dependencies: [],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${ANTIGRAVITY_CLI_AGENT_HARNESS_NAME}" (Antigravity CLI readiness).`,
    );
  },
};

export {
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME,
  antigravityCliAgentHarness,
} from "./adapter.js";

export default antigravityCliAgentHarnessModule;
