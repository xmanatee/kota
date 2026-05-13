import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { CODEX_AGENT_HARNESS_NAME, codexAgentHarness } from "./adapter.js";

registerAgentHarness(codexAgentHarness);

const codexAgentHarnessModule: KotaModule = {
  name: "codex-agent-harness",
  description:
    "Registers the codex agent harness — a non-interactive Codex CLI runner that honors local `codex login` ChatGPT-plan auth.",
  dependencies: [],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${CODEX_AGENT_HARNESS_NAME}" (Codex CLI exec).`,
    );
  },
};

export {
  CODEX_AGENT_HARNESS_NAME,
  codexAgentHarness,
} from "./adapter.js";

export default codexAgentHarnessModule;
