import { registerAgentHarness } from "#core/agent-harness/index.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { VERCEL_AGENT_HARNESS_NAME, vercelAgentHarness } from "./adapter.js";

registerAgentHarness(vercelAgentHarness);

const vercelAgentHarnessModule: KotaModule = {
  name: "vercel-agent-harness",
  description:
    "Registers the vercel agent harness — a multi-turn tool-calling loop driven by the Vercel AI SDK (streamText + tools + stopWhen=stepCountIs). Routes tool dispatch through the core tool registry and honors canUseTool, allowedTools, and disallowedTools.",
  dependencies: [],
  onLoad(ctx) {
    ctx.log.info(
      `Registered agent harness "${VERCEL_AGENT_HARNESS_NAME}" (Vercel AI SDK tool loop).`,
    );
  },
};

export {
  VERCEL_AGENT_HARNESS_NAME,
  vercelAgentHarness,
} from "./adapter.js";

export default vercelAgentHarnessModule;
