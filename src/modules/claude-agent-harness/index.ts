import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { CLAUDE_AGENT_HARNESS_NAME, claudeAgentHarness } from "./adapter.js";

registerAgentHarness(claudeAgentHarness);

const claudeAgentHarnessModule: KotaModule = {
  name: "claude-agent-harness",
  description:
    "Registers the claude-agent-sdk agent harness. Routes agent steps, repair agents, the agent-sdk delegate backend, and the CLI agent-sdk provider through @anthropic-ai/claude-agent-sdk.",
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${CLAUDE_AGENT_HARNESS_NAME}" (Claude Agent SDK).`,
    );
  },
};

export { CLAUDE_AGENT_HARNESS_NAME, claudeAgentHarness } from "./adapter.js";

export default claudeAgentHarnessModule;
