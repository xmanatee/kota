import type { KotaModule } from "#core/modules/module-types.js";
import { THIN_AGENT_HARNESS_NAME, thinAgentHarness } from "./adapter.js";

const thinAgentHarnessModule: KotaModule = {
  name: "thin-agent-harness",
  description:
    "Registers the thin agent harness — a single-turn text completion loop that works against any ModelClient provider.",
  dependencies: ["model-clients"],
  agentHarnesses: [thinAgentHarness],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${THIN_AGENT_HARNESS_NAME}" (single-turn ModelClient loop).`,
    );
  },
};

export { THIN_AGENT_HARNESS_NAME, thinAgentHarness } from "./adapter.js";

export default thinAgentHarnessModule;
