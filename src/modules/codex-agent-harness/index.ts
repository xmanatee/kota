import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { CODEX_AGENT_HARNESS_NAME, codexAgentHarness } from "./adapter.js";

registerAgentHarness(codexAgentHarness);

const codexAgentHarnessModule: KotaModule = {
  name: "codex-agent-harness",
  description:
    "Registers the codex agent harness — a multi-turn tool-calling loop driven by the OpenAI Agents SDK (Agent + run + tool). Routes tool dispatch through the core tool registry and honors canUseTool, allowedTools, and disallowedTools.",
  dependencies: [],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${CODEX_AGENT_HARNESS_NAME}" (OpenAI Agents SDK tool loop).`,
    );
  },
};

export {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
} from "./adapter.js";

export default codexAgentHarnessModule;
